package main

import (
	"errors"
	"sort"
	"time"
)

type OrderItem struct {
	ProductID int    `json:"productId"`
	Name      string `json:"name"`
	Quantity  int64  `json:"quantity"`
}

type Order struct {
	ID           string      `json:"id"`
	Number       string      `json:"number"`
	Type         string      `json:"type"`
	Status       string      `json:"status"`
	CreatedAt    time.Time   `json:"createdAt"`
	ShipmentDate *time.Time  `json:"shipmentDate"`
	Responsible  string      `json:"responsible"`
	Location     string      `json:"location"`
	Items        []OrderItem `json:"items"`
}

func (o ReceivingOrder) toOrder() Order {
	return Order{
		ID:          o.ID,
		Number:      o.Number,
		Type:        "receiving",
		Status:      o.Status,
		CreatedAt:   o.CreatedAt,
		Responsible: o.Responsible,
		Location:    o.Location,
		Items:       []OrderItem{{ProductID: o.Product.ID, Name: o.Product.Name, Quantity: o.Quantity}},
	}
}

func (s *DBService) GetOrders() []Order {
	s.receivingMu.Lock()
	defer s.receivingMu.Unlock()
	orders := make([]Order, 0, len(s.receiving)+len(s.cancelledReceiving))
	for _, order := range s.receiving {
		orders = append(orders, order.toOrder())
	}
	for _, order := range s.cancelledReceiving {
		orders = append(orders, order.toOrder())
	}
	sort.Slice(orders, func(i, j int) bool {
		if orders[i].CreatedAt.Equal(orders[j].CreatedAt) {
			return orders[i].ID > orders[j].ID
		}
		return orders[i].CreatedAt.After(orders[j].CreatedAt)
	})
	return orders
}

func (s *DBService) CancelOrder(id string) (Order, error) {
	s.receivingMu.Lock()
	defer s.receivingMu.Unlock()
	if _, cancelled := s.cancelledReceiving[id]; cancelled {
		return Order{}, errors.New("заказ уже отменён")
	}
	order, err := s.cancelPendingReceiving(id)
	if err != nil {
		return Order{}, err
	}
	return order.toOrder(), nil
}
