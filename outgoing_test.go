package main

import (
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func outgoingRequest() OutgoingRequest {
	return OutgoingRequest{
		Type: "shipment", Date: "2026-11-20", Address: " ул. Складская, 14 ", Responsible: " Петрова А.С. ", Note: " до 12:00 ",
		Items: []OutgoingItemRequest{{ProductID: 1, Quantity: "4"}, {ProductID: 2, Quantity: "2"}},
	}
}

func checkProductStock(t *testing.T, s *DBService, id, count int, reserved, free int64) {
	t.Helper()
	stock, err := s.GetProductStock(id)
	if err != nil || stock.Count != count || stock.Reserved != reserved || stock.Free != free {
		t.Fatalf("stock=%+v error=%v, want count=%d reserved=%d free=%d", stock, err, count, reserved, free)
	}
}

func completeRequest() CompleteOutgoingRequest {
	return CompleteOutgoingRequest{Date: "2026-11-21", CompletedBy: " Кузнецов Р.Н. "}
}

func TestOutgoingValidation(t *testing.T) {
	s, _ := testStore(t)
	for name, change := range map[string]func(*OutgoingRequest){
		"type":        func(r *OutgoingRequest) { r.Type = "gift" },
		"address":     func(r *OutgoingRequest) { r.Address = " " },
		"responsible": func(r *OutgoingRequest) { r.Responsible = "\t" },
		"date":        func(r *OutgoingRequest) { r.Date = "20.11.2026" },
		"no date":     func(r *OutgoingRequest) { r.Date = "" },
		"bad date":    func(r *OutgoingRequest) { r.Date = "2026-02-30" },
		"no items":    func(r *OutgoingRequest) { r.Items = nil },
		"product":     func(r *OutgoingRequest) { r.Items[0].ProductID = 999 },
		"duplicate":   func(r *OutgoingRequest) { r.Items[1].ProductID = 1 },
		"more":        func(r *OutgoingRequest) { r.Items[0].Quantity = "11" },
		"zero stock":  func(r *OutgoingRequest) { r.Items[0] = OutgoingItemRequest{ProductID: 3, Quantity: "1"} },
	} {
		request := outgoingRequest()
		change(&request)
		if _, err := s.CreateOutgoing(request); err == nil {
			t.Errorf("%s: invalid request accepted", name)
		}
	}
	for _, quantity := range []string{"", "0", "-1", "+1", "1.5", "1e2", "NaN", " 3", "9007199254740992"} {
		request := outgoingRequest()
		request.Items[0].Quantity = quantity
		if _, err := s.CreateOutgoing(request); err == nil {
			t.Errorf("accepted quantity %q", quantity)
		}
	}
	if orders := s.GetOrders(); len(orders) != 0 {
		t.Fatalf("orders=%+v", orders)
	}
	checkProductStock(t, s, 1, 10, 0, 10)
}

func TestOutgoingReservesWithoutChangingStock(t *testing.T) {
	s, _ := testStore(t)
	beforeSchema := schema(t, s.db)
	result, err := s.CreateOutgoing(outgoingRequest())
	if err != nil {
		t.Fatal(err)
	}
	order := result.Order
	if order.Status != "reserved" || order.Type != "shipment" || !strings.HasPrefix(order.Number, "З-") || order.Number != order.ID {
		t.Fatalf("order=%+v", order)
	}
	if order.Address != "ул. Складская, 14" || order.Responsible != "Петрова А.С." || order.Note != "до 12:00" {
		t.Fatalf("order=%+v", order)
	}
	if order.ShipmentDate == nil || order.ShipmentDate.Format("2006-01-02") != "2026-11-20" || order.CreatedAt.IsZero() {
		t.Fatalf("order=%+v", order)
	}
	wantItems := []OrderItem{{ProductID: 1, Name: "Молоко", Quantity: 4}, {ProductID: 2, Name: "Хлеб", Quantity: 2}}
	if !reflect.DeepEqual(order.Items, wantItems) {
		t.Fatalf("items=%+v", order.Items)
	}
	wantStock := []ProductStock{{ID: 1, Name: "Молоко", Count: 10, Reserved: 4, Free: 6}, {ID: 2, Name: "Хлеб", Count: 5, Reserved: 2, Free: 3}}
	if !reflect.DeepEqual(result.Stock, wantStock) {
		t.Fatalf("stock=%+v", result.Stock)
	}
	checkStock(t, s, 10)
	checkProductStock(t, s, 1, 10, 4, 6)
	if orders := s.GetOrders(); len(orders) != 1 || !reflect.DeepEqual(orders[0], order) {
		t.Fatalf("orders=%+v", orders)
	}

	over := outgoingRequest()
	over.Items = []OutgoingItemRequest{{ProductID: 1, Quantity: "7"}}
	if _, err := s.CreateOutgoing(over); err == nil || !strings.Contains(err.Error(), "доступно 6") {
		t.Fatalf("over-reservation error=%v", err)
	}
	exact := outgoingRequest()
	exact.Items = []OutgoingItemRequest{{ProductID: 1, Quantity: "6"}}
	if _, err := s.CreateOutgoing(exact); err != nil {
		t.Fatal(err)
	}
	checkProductStock(t, s, 1, 10, 10, 0)
	if beforeSchema != schema(t, s.db) {
		t.Fatal("schema changed")
	}
}

func TestOutgoingShipmentWritesOffAndClearsReservation(t *testing.T) {
	s, path := testStore(t)
	created, err := s.CreateOutgoing(outgoingRequest())
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.CompleteOutgoing(created.Order.ID, completeRequest())
	if err != nil {
		t.Fatal(err)
	}
	order := result.Order
	if order.Status != "shipped" || order.CompletedBy != "Кузнецов Р.Н." || order.ShipmentDate.Format("2006-01-02") != "2026-11-21" {
		t.Fatalf("order=%+v", order)
	}
	wantStock := []ProductStock{{ID: 1, Name: "Молоко", Count: 6, Free: 6}, {ID: 2, Name: "Хлеб", Count: 3, Free: 3}}
	if !reflect.DeepEqual(result.Stock, wantStock) {
		t.Fatalf("stock=%+v", result.Stock)
	}
	if _, err := s.CompleteOutgoing(order.ID, completeRequest()); err == nil {
		t.Fatal("order shipped twice")
	}
	if _, err := s.CancelOrder(order.ID); err == nil {
		t.Fatal("shipped order cancelled")
	}
	checkProductStock(t, s, 1, 6, 0, 6)
	s.Close()
	t.Chdir(filepath.Dir(path))
	restarted, err := NewDBService()
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	checkProductStock(t, restarted, 1, 6, 0, 6)
	if orders := restarted.GetOrders(); len(orders) != 0 {
		t.Fatalf("orders=%+v", orders)
	}
}

func TestOutgoingWriteoff(t *testing.T) {
	s, _ := testStore(t)
	request := outgoingRequest()
	request.Type = "writeoff"
	request.Note = "брак"
	created, err := s.CreateOutgoing(request)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(created.Order.Number, "С-") || created.Order.Note != "брак" {
		t.Fatalf("order=%+v", created.Order)
	}
	result, err := s.CompleteOutgoing(created.Order.ID, completeRequest())
	if err != nil || result.Order.Status != "written_off" {
		t.Fatalf("result=%+v error=%v", result, err)
	}
	checkProductStock(t, s, 1, 6, 0, 6)
}

func TestOutgoingCancelReleasesReservation(t *testing.T) {
	s, _ := testStore(t)
	created, err := s.CreateOutgoing(outgoingRequest())
	if err != nil {
		t.Fatal(err)
	}
	cancelled, err := s.CancelOrder(created.Order.ID)
	if err != nil || cancelled.Status != "cancelled" {
		t.Fatalf("cancelled=%+v error=%v", cancelled, err)
	}
	checkProductStock(t, s, 1, 10, 0, 10)
	if orders := s.GetOrders(); len(orders) != 1 || orders[0].Status != "cancelled" {
		t.Fatalf("orders=%+v", orders)
	}
	if _, err := s.CancelOrder(created.Order.ID); err == nil || !strings.Contains(err.Error(), "уже отменён") {
		t.Fatalf("repeat cancel error=%v", err)
	}
	if _, err := s.CompleteOutgoing(created.Order.ID, completeRequest()); err == nil {
		t.Fatal("cancelled order shipped")
	}
	checkStock(t, s, 10)
}

func TestCompleteOutgoingValidation(t *testing.T) {
	s, _ := testStore(t)
	created, err := s.CreateOutgoing(outgoingRequest())
	if err != nil {
		t.Fatal(err)
	}
	for _, request := range []CompleteOutgoingRequest{
		{Date: "2026-11-21", CompletedBy: " "}, {Date: "", CompletedBy: "Иванов"}, {Date: "21.11.2026", CompletedBy: "Иванов"},
	} {
		if _, err := s.CompleteOutgoing(created.Order.ID, request); err == nil {
			t.Errorf("invalid request accepted: %+v", request)
		}
	}
	if _, err := s.CompleteOutgoing("missing", completeRequest()); err == nil {
		t.Fatal("missing order completed")
	}
	checkProductStock(t, s, 1, 10, 4, 6)
}

func TestCompleteOutgoingRollsBackAllItems(t *testing.T) {
	s, _ := testStore(t)
	s.db.SetMaxOpenConns(1)
	created, err := s.CreateOutgoing(outgoingRequest())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("UPDATE products SET count = 1 WHERE id = 2"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteOutgoing(created.Order.ID, completeRequest()); err == nil || !strings.Contains(err.Error(), "Хлеб") {
		t.Fatalf("error=%v", err)
	}
	checkStock(t, s, 10)
	if orders := s.GetOrders(); orders[0].Status != "reserved" {
		t.Fatalf("orders=%+v", orders)
	}
	if _, err := s.db.Exec("UPDATE products SET count = 5 WHERE id = 2"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteOutgoing(created.Order.ID, completeRequest()); err != nil {
		t.Fatal(err)
	}
	checkStock(t, s, 6)
}

func TestCompleteOutgoingSQLiteFailureAndRetry(t *testing.T) {
	s, _ := testStore(t)
	created, err := s.CreateOutgoing(outgoingRequest())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`CREATE TRIGGER reject_update BEFORE UPDATE ON products WHEN NEW.id = 2 BEGIN SELECT RAISE(ABORT, 'test failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteOutgoing(created.Order.ID, completeRequest()); err == nil {
		t.Fatal("SQLite error ignored")
	}
	checkProductStock(t, s, 1, 10, 4, 6)
	if _, err := s.db.Exec("DROP TRIGGER reject_update"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteOutgoing(created.Order.ID, completeRequest()); err != nil {
		t.Fatal(err)
	}
	checkProductStock(t, s, 1, 6, 0, 6)
	s.Close()
	if _, err := s.CreateOutgoing(outgoingRequest()); err == nil {
		t.Fatal("closed database ignored")
	}
	if _, err := s.GetProductStocks(); err == nil {
		t.Fatal("closed database ignored")
	}
}

func TestConcurrentOutgoingNeverOverReserves(t *testing.T) {
	s, _ := testStore(t)
	s.db.SetMaxOpenConns(1)
	request := outgoingRequest()
	request.Items = []OutgoingItemRequest{{ProductID: 1, Quantity: "1"}}
	start := make(chan struct{})
	var group sync.WaitGroup
	var mu sync.Mutex
	created := []string{}
	for i := 0; i < 25; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			if result, err := s.CreateOutgoing(request); err == nil {
				mu.Lock()
				created = append(created, result.Order.ID)
				mu.Unlock()
			}
			if _, err := s.GetProductStocks(); err != nil {
				t.Error(err)
			}
		}()
	}
	close(start)
	group.Wait()
	if len(created) != 10 {
		t.Fatalf("created=%d", len(created))
	}
	checkProductStock(t, s, 1, 10, 10, 0)
	seen := map[string]bool{}
	for _, id := range created {
		if seen[id] {
			t.Fatalf("duplicate id %s", id)
		}
		seen[id] = true
	}

	shipped := make(chan struct{}, 25)
	start = make(chan struct{})
	for _, id := range created {
		for attempt := 0; attempt < 2; attempt++ {
			group.Add(1)
			go func() {
				defer group.Done()
				<-start
				if _, err := s.CompleteOutgoing(id, completeRequest()); err == nil {
					shipped <- struct{}{}
				}
			}()
		}
	}
	close(start)
	group.Wait()
	if len(shipped) != 10 {
		t.Fatalf("shipped=%d", len(shipped))
	}
	checkProductStock(t, s, 1, 0, 0, 0)
}

func TestReceivingIncreasesFreeStock(t *testing.T) {
	s, _ := testStore(t)
	if _, err := s.CreateOutgoing(outgoingRequest()); err != nil {
		t.Fatal(err)
	}
	receiving, err := s.CreateReceiving(receivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteReceiving(receiving.ID); err != nil {
		t.Fatal(err)
	}
	checkProductStock(t, s, 1, 13, 4, 9)
	if orders := s.GetOrders(); len(orders) != 2 {
		t.Fatalf("orders=%+v", orders)
	}
}
