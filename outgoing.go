package main

import (
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

var outgoingCompletedStatus = map[string]string{"shipment": "shipped", "writeoff": "written_off"}

type OutgoingItemRequest struct {
	ProductID int    `json:"productId"`
	Quantity  string `json:"quantity"`
}

type OutgoingRequest struct {
	ResponsibleID int                   `json:"responsibleId"`
	Type          string                `json:"type"`
	Date          string                `json:"date"`
	Address       string                `json:"address"`
	Responsible   string                `json:"responsible"`
	Note          string                `json:"note"`
	Items         []OutgoingItemRequest `json:"items"`
}

type CompleteOutgoingRequest struct {
	Date        string `json:"date"`
	CompletedBy string `json:"completedBy"`
}

type ProductStock struct {
	Product
	Reserved int64 `json:"reserved"`
	Free     int64 `json:"free"`
}

type OutgoingResult struct {
	Order Order          `json:"order"`
	Stock []ProductStock `json:"stock"`
}

func parseOrderDate(value string) (time.Time, error) {
	date, err := time.ParseInLocation("2006-01-02", value, time.Local)
	if err != nil {
		return time.Time{}, errors.New("укажите дату в формате ГГГГ-ММ-ДД")
	}
	return date, nil
}

func (s *DBService) reservedByProduct() map[int]int64 {
	reserved := make(map[int]int64)
	for _, order := range s.outgoing {
		if order.Status != "reserved" {
			continue
		}
		for _, item := range order.Items {
			reserved[item.ProductID] += item.Quantity
		}
	}
	return reserved
}

func (s *DBService) stocksOf(products []Product) []ProductStock {
	reserved := s.reservedByProduct()
	stocks := make([]ProductStock, 0, len(products))
	for _, product := range products {
		stocks = append(stocks, ProductStock{
			Product:  product,
			Reserved: reserved[product.ID], Free: int64(product.Count) - reserved[product.ID],
		})
	}
	return stocks
}

func (s *DBService) GetProductStocks() ([]ProductStock, error) {
	s.ordersMu.Lock()
	defer s.ordersMu.Unlock()
	products, err := s.GetAllProducts()
	if err != nil {
		return nil, err
	}
	return s.stocksOf(products), nil
}

func (s *DBService) GetProductStock(id int) (ProductStock, error) {
	s.ordersMu.Lock()
	defer s.ordersMu.Unlock()
	product, err := s.GetProduct(id)
	if err != nil {
		return ProductStock{}, err
	}
	return s.stocksOf([]Product{product})[0], nil
}

func (s *DBService) CreateOutgoing(request OutgoingRequest) (OutgoingResult, error) {
	s.ordersMu.Lock()
	defer s.ordersMu.Unlock()
	if _, known := outgoingCompletedStatus[request.Type]; !known {
		return OutgoingResult{}, errors.New("выберите отгрузку или списание")
	}
	address := strings.TrimSpace(request.Address)
	if address == "" {
		return OutgoingResult{}, errors.New("укажите адрес доставки или объекта")
	}
	manager, err := s.findManager(request.ResponsibleID, request.Responsible)
	if err != nil {
		return OutgoingResult{}, err
	}
	date, err := parseOrderDate(request.Date)
	if err != nil {
		return OutgoingResult{}, err
	}
	if len(request.Items) == 0 {
		return OutgoingResult{}, errors.New("добавьте хотя бы один товар")
	}
	reserved := s.reservedByProduct()
	products := make([]Product, 0, len(request.Items))
	items := make([]OrderItem, 0, len(request.Items))
	seen := make(map[int]bool)
	for _, requested := range request.Items {
		if seen[requested.ProductID] {
			return OutgoingResult{}, errors.New("один товар указан в заказе дважды")
		}
		seen[requested.ProductID] = true
		quantity, err := strconv.ParseUint(requested.Quantity, 10, 53)
		if err != nil || quantity == 0 {
			return OutgoingResult{}, errors.New("количество должно быть целым числом от 1 до 9007199254740991")
		}
		product, err := s.GetProduct(requested.ProductID)
		if err != nil {
			return OutgoingResult{}, err
		}
		free := int64(product.Count) - reserved[product.ID]
		if int64(quantity) > free {
			return OutgoingResult{}, fmt.Errorf("недостаточно свободного остатка «%s»: доступно %d", product.Name, free)
		}
		products = append(products, product)
		items = append(items, OrderItem{ProductID: product.ID, Name: product.Name, Quantity: int64(quantity)})
	}
	prefix := "З"
	if request.Type == "writeoff" {
		prefix = "С"
	}
	now := time.Now()
	s.orderSequence++
	id := fmt.Sprintf("%s-%d-%04d", prefix, now.Year(), s.orderSequence)
	order := Order{
		ID: id, Number: id, Type: request.Type, Status: "reserved", CreatedAt: now, ShipmentDate: &date,
		Responsible: manager.Name, ResponsibleID: manager.ID, Address: address, Note: strings.TrimSpace(request.Note), Items: items,
	}
	if s.outgoing == nil {
		s.outgoing = make(map[string]Order)
	}
	s.outgoing[id] = order
	return OutgoingResult{Order: order, Stock: s.stocksOf(products)}, nil
}

// Остаток всех позиций списывается в одной транзакции: если хотя бы одного товара не хватает, не меняется ничего.
func (s *DBService) CompleteOutgoing(id string, request CompleteOutgoingRequest) (OutgoingResult, error) {
	s.ordersMu.Lock()
	defer s.ordersMu.Unlock()
	order, ok := s.outgoing[id]
	if !ok {
		return OutgoingResult{}, errors.New("заказ не найден")
	}
	if order.Status != "reserved" {
		return OutgoingResult{}, errors.New("заказ уже завершён или отменён")
	}
	if _, err := s.findManager(order.ResponsibleID, ""); err != nil {
		return OutgoingResult{}, err
	}
	completedBy := strings.TrimSpace(request.CompletedBy)
	if completedBy == "" {
		return OutgoingResult{}, errors.New("укажите ФИО сотрудника")
	}
	date, err := parseOrderDate(request.Date)
	if err != nil {
		return OutgoingResult{}, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return OutgoingResult{}, fmt.Errorf("начало списания: %w", err)
	}
	defer tx.Rollback()
	products := make([]Product, 0, len(order.Items))
	for _, item := range order.Items {
		product, err := scanProduct(tx.QueryRow(`UPDATE products SET count = count - ?
			WHERE id = ? AND typeof(count) = 'integer' AND count >= ?
			RETURNING `+productColumns, item.Quantity, item.ProductID, item.Quantity))
		if errors.Is(err, sql.ErrNoRows) {
			return OutgoingResult{}, fmt.Errorf("на складе не хватает товара «%s»", item.Name)
		}
		if err != nil {
			return OutgoingResult{}, fmt.Errorf("сохранение остатка: %w", err)
		}
		products = append(products, product)
	}
	if err := tx.Commit(); err != nil {
		return OutgoingResult{}, fmt.Errorf("завершение заказа: %w", err)
	}
	order.Status = outgoingCompletedStatus[order.Type]
	order.ShipmentDate = &date
	order.CompletedBy = completedBy
	s.outgoing[id] = order
	return OutgoingResult{Order: order, Stock: s.stocksOf(products)}, nil
}

func (s *DBService) cancelOutgoing(order Order) (Order, error) {
	if order.Status == "cancelled" {
		return Order{}, errors.New("заказ уже отменён")
	}
	if order.Status != "reserved" {
		return Order{}, errors.New("завершённый заказ отменить нельзя")
	}
	order.Status = "cancelled"
	s.outgoing[order.ID] = order
	return order, nil
}
