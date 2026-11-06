package main

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestOrdersListAndComposition(t *testing.T) {
	s, _ := testStore(t)
	if orders := s.GetOrders(); orders == nil || len(orders) != 0 {
		t.Fatalf("orders=%#v", orders)
	}
	first, err := s.CreateReceiving(receivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.CreateReceiving(ReceivingRequest{ProductID: 2, Quantity: "7", Responsible: "Петрова А.С.", Location: "A-01"})
	if err != nil {
		t.Fatal(err)
	}
	if age := time.Since(first.CreatedAt); first.CreatedAt.IsZero() || age < 0 || age > time.Minute {
		t.Fatalf("createdAt=%v", first.CreatedAt)
	}
	older := second.CreatedAt.Add(-time.Hour)
	stored := s.receiving[first.ID]
	stored.CreatedAt = older
	s.receiving[first.ID] = stored

	orders := s.GetOrders()
	if len(orders) != 2 || orders[0].ID != second.ID || orders[1].ID != first.ID {
		t.Fatalf("orders=%+v", orders)
	}
	want := Order{
		ID: second.ID, Number: "П-" + strings.ToUpper(second.ID[:8]), Type: "receiving", Status: "pending",
		CreatedAt: second.CreatedAt, Responsible: "Петрова А.С.", Location: "A-01",
		Items: []OrderItem{{ProductID: 2, Name: "Хлеб", Quantity: 7}},
	}
	if !reflect.DeepEqual(orders[0], want) {
		t.Fatalf("got=%+v want=%+v", orders[0], want)
	}
	if _, err := s.CompleteReceiving(first.ID); err != nil {
		t.Fatal(err)
	}
	if orders := s.GetOrders(); orders[1].Status != "completed" {
		t.Fatalf("orders=%+v", orders)
	}
}

func TestOrderJSONKeepsMissingShipmentDate(t *testing.T) {
	s, _ := testStore(t)
	if _, err := s.CreateReceiving(receivingRequest()); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(s.GetOrders())
	if err != nil {
		t.Fatal(err)
	}
	var decoded []map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	shipment, present := decoded[0]["shipmentDate"]
	if !present || shipment != nil {
		t.Fatalf("shipmentDate=%v present=%v", shipment, present)
	}
	if _, err := time.Parse(time.RFC3339, decoded[0]["createdAt"].(string)); err != nil {
		t.Fatal(err)
	}
}

func TestCancelOrderKeepsItInList(t *testing.T) {
	s, _ := testStore(t)
	beforeSchema := schema(t, s.db)
	beforeProducts, err := s.GetAllProducts()
	if err != nil {
		t.Fatal(err)
	}
	draft, err := s.CreateReceiving(receivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	cancelled, err := s.CancelOrder(draft.ID)
	if err != nil || cancelled.Status != "cancelled" || cancelled.ID != draft.ID {
		t.Fatalf("cancelled=%+v error=%v", cancelled, err)
	}
	orders := s.GetOrders()
	if len(orders) != 1 || !reflect.DeepEqual(orders[0], cancelled) {
		t.Fatalf("orders=%+v", orders)
	}
	if _, err := s.CancelOrder(draft.ID); err == nil || !strings.Contains(err.Error(), "уже отменён") {
		t.Fatalf("repeat cancel error=%v", err)
	}
	if _, err := s.GetReceiving(draft.ID); err == nil {
		t.Fatal("cancelled draft still available")
	}
	if _, err := s.CompleteReceiving(draft.ID); err == nil {
		t.Fatal("cancelled draft completed")
	}
	afterProducts, err := s.GetAllProducts()
	if err != nil || !reflect.DeepEqual(beforeProducts, afterProducts) || beforeSchema != schema(t, s.db) {
		t.Fatalf("products or schema changed: %v", err)
	}
}

func TestCancelOrderRejectsMissingAndCompleted(t *testing.T) {
	s, _ := testStore(t)
	if _, err := s.CancelOrder("missing"); err == nil {
		t.Fatal("missing order cancelled")
	}
	order, err := s.CreateReceiving(receivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteReceiving(order.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CancelOrder(order.ID); err == nil {
		t.Fatal("completed order cancelled")
	}
	checkStock(t, s, 13)
	if orders := s.GetOrders(); orders[0].Status != "completed" {
		t.Fatalf("orders=%+v", orders)
	}
}

func TestCancelReceivingAppearsInOrders(t *testing.T) {
	s, _ := testStore(t)
	order, err := s.CreateReceiving(receivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CancelReceiving(order.ID); err != nil {
		t.Fatal(err)
	}
	if orders := s.GetOrders(); len(orders) != 1 || orders[0].Status != "cancelled" {
		t.Fatalf("orders=%+v", orders)
	}
	if err := s.CancelReceiving(order.ID); err == nil {
		t.Fatal("repeat cancel accepted")
	}
}

func TestConcurrentCancelOrderSucceedsOnce(t *testing.T) {
	s, _ := testStore(t)
	order, err := s.CreateReceiving(receivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	var group sync.WaitGroup
	var mu sync.Mutex
	succeeded := 0
	for i := 0; i < 20; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			if _, err := s.CancelOrder(order.ID); err == nil {
				mu.Lock()
				succeeded++
				mu.Unlock()
			}
			s.GetOrders()
		}()
	}
	close(start)
	group.Wait()
	if succeeded != 1 {
		t.Fatalf("succeeded=%d", succeeded)
	}
	checkStock(t, s, 10)
}

func TestCancelOrderDuringCompletion(t *testing.T) {
	s, _ := testStore(t)
	order, err := s.CreateReceiving(receivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	var completeErr, cancelErr error
	start := make(chan struct{})
	var group sync.WaitGroup
	group.Add(2)
	go func() { defer group.Done(); <-start; _, completeErr = s.CompleteReceiving(order.ID) }()
	go func() { defer group.Done(); <-start; _, cancelErr = s.CancelOrder(order.ID) }()
	close(start)
	group.Wait()
	if (completeErr == nil) == (cancelErr == nil) {
		t.Fatalf("complete=%v cancel=%v", completeErr, cancelErr)
	}
	want, status := 10, "cancelled"
	if completeErr == nil {
		want, status = 13, "completed"
	}
	checkStock(t, s, want)
	if orders := s.GetOrders(); len(orders) != 1 || orders[0].Status != status {
		t.Fatalf("orders=%+v", orders)
	}
}

func TestOrdersAreNotKeptAfterRestart(t *testing.T) {
	s, path := testStore(t)
	completed, err := s.CreateReceiving(receivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteReceiving(completed.ID); err != nil {
		t.Fatal(err)
	}
	draft, err := s.CreateReceiving(receivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CancelOrder(draft.ID); err != nil {
		t.Fatal(err)
	}
	s.Close()
	t.Chdir(filepath.Dir(path))
	restarted, err := NewDBService()
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	checkStock(t, restarted, 13)
	if orders := restarted.GetOrders(); len(orders) != 0 {
		t.Fatalf("orders=%+v", orders)
	}
}
