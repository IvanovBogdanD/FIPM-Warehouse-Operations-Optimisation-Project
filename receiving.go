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

type ReceivingRequest struct {
	ProductID   int    `json:"productId"`
	Quantity    string `json:"quantity"`
	Responsible string `json:"responsible"`
	Location    string `json:"location"`
}

type ReceivingOrder struct {
	ID          string    `json:"id"`
	Number      string    `json:"number"`
	Product     Product   `json:"product"`
	Quantity    int64     `json:"quantity"`
	Responsible string    `json:"responsible"`
	Location    string    `json:"location"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
}

func (s *DBService) CreateReceiving(request ReceivingRequest) (ReceivingOrder, error) {
	s.receivingMu.Lock()
	defer s.receivingMu.Unlock()
	responsible := strings.TrimSpace(request.Responsible)
	location := strings.TrimSpace(request.Location)
	if responsible == "" || location == "" {
		return ReceivingOrder{}, errors.New("укажите ФИО ответственного и место хранения")
	}
	quantity, err := strconv.ParseUint(request.Quantity, 10, 53)
	if err != nil || quantity == 0 {
		return ReceivingOrder{}, errors.New("количество должно быть целым числом от 1 до 9007199254740991")
	}
	product, err := s.GetProduct(request.ProductID)
	if err != nil {
		return ReceivingOrder{}, err
	}
	if product.Count < 0 || int64(product.Count) > maxSafeCount-int64(quantity) {
		return ReceivingOrder{}, errors.New("остаток некорректен или произойдёт переполнение количества")
	}
	var token [16]byte
	if _, err := rand.Read(token[:]); err != nil {
		return ReceivingOrder{}, fmt.Errorf("создание номера приёмки: %w", err)
	}
	id := hex.EncodeToString(token[:])
	order := ReceivingOrder{
		ID: id, Number: "П-" + strings.ToUpper(id[:8]), Product: product, Quantity: int64(quantity),
		Responsible: responsible, Location: location, Status: "pending", CreatedAt: time.Now(),
	}
	if s.receiving == nil {
		s.receiving = make(map[string]ReceivingOrder)
	}
	s.receiving[order.ID] = order
	return order, nil
}

func (s *DBService) GetReceiving(id string) (ReceivingOrder, error) {
	s.receivingMu.Lock()
	defer s.receivingMu.Unlock()
	order, ok := s.receiving[id]
	if !ok {
		return ReceivingOrder{}, errors.New("заказ приёмки не найден: после перезапуска черновики недоступны")
	}
	return order, nil
}

// Блокировка защищает черновик, а условный UPDATE проверяет остаток в момент записи.
func (s *DBService) CompleteReceiving(id string) (ReceivingOrder, error) {
	s.receivingMu.Lock()
	defer s.receivingMu.Unlock()
	order, ok := s.receiving[id]
	if !ok {
		return ReceivingOrder{}, errors.New("заказ приёмки не найден: после перезапуска черновики недоступны")
	}
	if order.Status == "completed" {
		return order, nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return ReceivingOrder{}, fmt.Errorf("начало приёмки: %w", err)
	}
	defer tx.Rollback()
	var product Product
	err = tx.QueryRow(`UPDATE products SET count = count + ?
		WHERE id = ? AND typeof(count) = 'integer' AND count >= 0 AND count <= ?
		RETURNING id, name, count`, order.Quantity, order.Product.ID, maxSafeCount-order.Quantity).Scan(&product.ID, &product.Name, &product.Count)
	if errors.Is(err, sql.ErrNoRows) {
		return ReceivingOrder{}, errors.New("товар отсутствует, остаток некорректен или произойдёт переполнение")
	}
	if err != nil {
		return ReceivingOrder{}, fmt.Errorf("сохранение остатка: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return ReceivingOrder{}, fmt.Errorf("завершение приёмки: %w", err)
	}
	order.Product = product
	order.Status = "completed"
	s.receiving[id] = order
	return order, nil
}

func (s *DBService) CancelReceiving(id string) error {
	s.receivingMu.Lock()
	defer s.receivingMu.Unlock()
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
