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
	Location  string `json:"location,omitempty"`
}

type Order struct {
	ResponsibleID int         `json:"responsibleId,omitempty"`
	ID            string      `json:"id"`
	Number        string      `json:"number"`
	Type          string      `json:"type"`
	Status        string      `json:"status"`
	CreatedAt     time.Time   `json:"createdAt"`
	ShipmentDate  *time.Time  `json:"shipmentDate"`
	Responsible   string      `json:"responsible"`
	Location      string      `json:"location"`
	Address       string      `json:"address"`
	Note          string      `json:"note"`
	CompletedBy   string      `json:"completedBy"`
	Items         []OrderItem `json:"items"`
}

func (o ReceivingOrder) toOrder() Order {
	items := make([]OrderItem, 0, len(o.Items))
	for _, item := range o.Items {
		items = append(items, OrderItem{ProductID: item.Product.ID, Name: item.Product.Name, Quantity: item.Quantity, Location: item.Location})
	}
	location := o.Location
	if len(items) > 1 {
		location = ""
	}
	return Order{
		ID: o.ID, Number: o.Number, Type: "receiving", Status: o.Status,
		CreatedAt: o.CreatedAt, Responsible: o.Responsible, Location: location, Items: items,
	}
}

func (s *DBService) GetOrders() []Order {
	s.ordersMu.Lock()
	defer s.ordersMu.Unlock()
	orders := make([]Order, 0, len(s.receiving)+len(s.cancelledReceiving)+len(s.outgoing))
	for _, order := range s.receiving {
		orders = append(orders, order.toOrder())
	}
	for _, order := range s.cancelledReceiving {
		orders = append(orders, order.toOrder())
	}
	for _, order := range s.outgoing {
		orders = append(orders, order)
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
	s.ordersMu.Lock()
	defer s.ordersMu.Unlock()
	if order, ok := s.outgoing[id]; ok {
		return s.cancelOutgoing(order)
	}
	if _, cancelled := s.cancelledReceiving[id]; cancelled {
		return Order{}, errors.New("заказ уже отменён")
	}
	order, err := s.cancelPendingReceiving(id)
	if err != nil {
		return Order{}, err
	}
	return order.toOrder(), nil
}
