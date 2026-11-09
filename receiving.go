package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const maxSafeCount int64 = 1<<53 - 1

type ReceivingItemRequest struct {
	ProductID int    `json:"productId"`
	Quantity  string `json:"quantity"`
	Location  string `json:"location"`
}

type ReceivingRequest struct {
	ProductID     int                    `json:"productId"`
	Quantity      string                 `json:"quantity"`
	Responsible   string                 `json:"responsible"`
	Location      string                 `json:"location"`
	ResponsibleID int                    `json:"responsibleId"`
	Items         []ReceivingItemRequest `json:"items"`
}

type ReceivingItem struct {
	Product  Product `json:"product"`
	Quantity int64   `json:"quantity"`
	Location string  `json:"location"`
}

type ReceivingOrder struct {
	ID            string          `json:"id"`
	Number        string          `json:"number"`
	Product       Product         `json:"product"`
	Quantity      int64           `json:"quantity"`
	Responsible   string          `json:"responsible"`
	Location      string          `json:"location"`
	Status        string          `json:"status"`
	CreatedAt     time.Time       `json:"createdAt"`
	ResponsibleID int             `json:"responsibleId"`
	Items         []ReceivingItem `json:"items"`
}

func (s *DBService) CreateReceiving(request ReceivingRequest) (ReceivingOrder, error) {
	s.ordersMu.Lock()
	defer s.ordersMu.Unlock()
	manager, err := s.findManager(request.ResponsibleID, request.Responsible)
	if err != nil {
		return ReceivingOrder{}, err
	}
	requests := request.Items
	if len(requests) == 0 && request.ProductID > 0 {
		requests = []ReceivingItemRequest{{ProductID: request.ProductID, Quantity: request.Quantity, Location: request.Location}}
	}
	if len(requests) == 0 {
		return ReceivingOrder{}, errors.New("добавьте хотя бы один товар")
	}
	items := make([]ReceivingItem, 0, len(requests))
	selected := make(map[int]bool)
	var total int64
	for _, item := range requests {
		if selected[item.ProductID] {
			return ReceivingOrder{}, errors.New("товар уже есть в заказе, измените количество в его строке")
		}
		selected[item.ProductID] = true
		location := strings.TrimSpace(item.Location)
		if location == "" {
			return ReceivingOrder{}, errors.New("укажите место хранения для каждого товара")
		}
		quantity, err := strconv.ParseUint(item.Quantity, 10, 53)
		if err != nil || quantity == 0 {
			return ReceivingOrder{}, errors.New("количество должно быть целым числом от 1 до 9007199254740991")
		}
		product, err := s.GetProduct(item.ProductID)
		if err != nil {
			return ReceivingOrder{}, err
		}
		if product.Count < 0 || int64(product.Count) > maxSafeCount-int64(quantity) {
			return ReceivingOrder{}, fmt.Errorf("остаток «%s» некорректен или произойдёт переполнение количества", product.Name)
		}
		if total > maxSafeCount-int64(quantity) {
			return ReceivingOrder{}, errors.New("общее количество в заказе превышает допустимый предел")
		}
		total += int64(quantity)
		items = append(items, ReceivingItem{Product: product, Quantity: int64(quantity), Location: location})
	}
	var token [16]byte
	if _, err := rand.Read(token[:]); err != nil {
		return ReceivingOrder{}, fmt.Errorf("создание номера приёмки: %w", err)
	}
	id := hex.EncodeToString(token[:])
	first := items[0]
	order := ReceivingOrder{
		ID: id, Number: "П-" + strings.ToUpper(id[:8]), Product: first.Product, Quantity: first.Quantity,
		Responsible: manager.Name, ResponsibleID: manager.ID, Location: first.Location,
		Status: "pending", CreatedAt: time.Now(), Items: items,
	}
	if s.receiving == nil {
		s.receiving = make(map[string]ReceivingOrder)
	}
	s.receiving[order.ID] = order
	return order, nil
}

func (s *DBService) GetReceiving(id string) (ReceivingOrder, error) {
	s.ordersMu.Lock()
	defer s.ordersMu.Unlock()
	order, ok := s.receiving[id]
	if !ok {
		return ReceivingOrder{}, errors.New("заказ приёмки не найден: после перезапуска черновики недоступны")
	}
	return order, nil
}

func (s *DBService) CompleteReceiving(id string) (ReceivingOrder, error) {
	s.ordersMu.Lock()
	defer s.ordersMu.Unlock()
	order, ok := s.receiving[id]
	if !ok {
		return ReceivingOrder{}, errors.New("заказ приёмки не найден: после перезапуска черновики недоступны")
	}
	if order.Status == "completed" {
		return order, nil
	}
	if _, err := s.findManager(order.ResponsibleID, ""); err != nil {
		return ReceivingOrder{}, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return ReceivingOrder{}, fmt.Errorf("начало приёмки: %w", err)
	}
	defer tx.Rollback()
	items := append([]ReceivingItem(nil), order.Items...)
	for index, item := range items {
		product, err := scanProduct(tx.QueryRow(`UPDATE products SET count = count + ?
            WHERE id = ? AND typeof(count) = 'integer' AND count >= 0 AND count <= ?
            RETURNING `+productColumns, item.Quantity, item.Product.ID, maxSafeCount-item.Quantity))
		if errors.Is(err, sql.ErrNoRows) {
			return ReceivingOrder{}, fmt.Errorf("товар «%s» отсутствует, остаток некорректен или произойдёт переполнение", item.Product.Name)
		}
		if err != nil {
			return ReceivingOrder{}, fmt.Errorf("сохранение остатка: %w", err)
		}
		items[index].Product = product
	}
	if err := tx.Commit(); err != nil {
		return ReceivingOrder{}, fmt.Errorf("завершение приёмки: %w", err)
	}
	order.Items = items
	order.Product = items[0].Product
	order.Status = "completed"
	s.receiving[id] = order
	return order, nil
}

func (s *DBService) CancelReceiving(id string) error {
	s.ordersMu.Lock()
	defer s.ordersMu.Unlock()
	_, err := s.cancelPendingReceiving(id)
	return err
}

func (s *DBService) cancelPendingReceiving(id string) (ReceivingOrder, error) {
	order, ok := s.receiving[id]
	if !ok {
		return ReceivingOrder{}, errors.New("заказ приёмки не найден")
	}
	if order.Status != "pending" {
		return ReceivingOrder{}, errors.New("завершённую приёмку отменить нельзя")
	}
	order.Status = "cancelled"
	if s.cancelledReceiving == nil {
		s.cancelledReceiving = make(map[string]ReceivingOrder)
	}
	s.cancelledReceiving[id] = order
	delete(s.receiving, id)
	return order, nil
}
