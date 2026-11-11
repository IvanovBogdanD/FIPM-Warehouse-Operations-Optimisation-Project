package main

import (
	"reflect"
	"testing"
)

func batchReceivingRequest() ReceivingRequest {
	return ReceivingRequest{ResponsibleID: 1, Items: []ReceivingItemRequest{
		{ProductID: 1, Quantity: "3", Location: "A-01"},
		{ProductID: 2, Quantity: "4", Location: "B-02"},
	}}
}

func TestBatchReceivingAtomicCompletion(t *testing.T) {
	s, _ := testOrderStore(t)
	before, _ := s.GetAllProducts()
	cancelled, err := s.CreateReceiving(batchReceivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CancelReceiving(cancelled.ID); err != nil {
		t.Fatal(err)
	}
	if after, _ := s.GetAllProducts(); !reflect.DeepEqual(before, after) {
		t.Fatal("cancel changed stock")
	}
	order, err := s.CreateReceiving(batchReceivingRequest())
	if err != nil || len(order.Items) != 2 || order.ResponsibleID != 1 || order.Responsible != "Иванов Иван Иванович" {
		t.Fatalf("order=%+v error=%v", order, err)
	}
	if after, _ := s.GetAllProducts(); !reflect.DeepEqual(before, after) {
		t.Fatal("draft changed stock")
	}
	if _, err := s.db.Exec(`CREATE TRIGGER reject_second BEFORE UPDATE ON products WHEN NEW.id=2 BEGIN SELECT RAISE(ABORT,'test'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteReceiving(order.ID); err == nil {
		t.Fatal("partial receipt accepted")
	}
	if after, _ := s.GetAllProducts(); !reflect.DeepEqual(before, after) {
		t.Fatal("failed receipt changed stock")
	}
	pending, err := s.GetReceiving(order.ID)
	if err != nil || !reflect.DeepEqual(order, pending) {
		t.Fatalf("failed receipt changed draft: %+v %v", pending, err)
	}
	if _, err := s.db.Exec("DROP TRIGGER reject_second"); err != nil {
		t.Fatal(err)
	}
	completed, err := s.CompleteReceiving(order.ID)
	if err != nil || completed.Status != "completed" || completed.Items[0].Product.Count != 13 || completed.Items[1].Product.Count != 9 {
		t.Fatalf("completed=%+v error=%v", completed, err)
	}
	again, err := s.CompleteReceiving(order.ID)
	if err != nil || !reflect.DeepEqual(again, completed) {
		t.Fatalf("repeat=%+v error=%v", again, err)
	}
	orders := s.GetOrders()
	var found Order
	for _, item := range orders {
		if item.ID == order.ID {
			found = item
		}
	}
	if len(found.Items) != 2 || found.Items[1].ProductID != 2 || found.Items[1].Quantity != 4 || found.Items[1].Location != "B-02" {
		t.Fatalf("composition=%+v", found)
	}
}

func TestBatchReceivingValidationAndManagerChanges(t *testing.T) {
	s, _ := testOrderStore(t)
	for _, change := range []func(*ReceivingRequest){
		func(r *ReceivingRequest) { r.Items = nil },
		func(r *ReceivingRequest) { r.Items[1].ProductID = 1 },
		func(r *ReceivingRequest) { r.Items[1].ProductID = 999 },
		func(r *ReceivingRequest) { r.Items[1].Quantity = "0" },
		func(r *ReceivingRequest) { r.Items[1].Quantity = "1.5" },
		func(r *ReceivingRequest) { r.Items[1].Location = " " },
		func(r *ReceivingRequest) { r.ResponsibleID = 3 },
		func(r *ReceivingRequest) { r.ResponsibleID = 5 },
		func(r *ReceivingRequest) { r.ResponsibleID = 0; r.Responsible = "Придуманное имя" },
	} {
		request := batchReceivingRequest()
		change(&request)
		if _, err := s.CreateReceiving(request); err == nil {
			t.Fatalf("invalid request accepted: %+v", request)
		}
	}
	order, err := s.CreateReceiving(batchReceivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("UPDATE users SET role='Кладовщик' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteReceiving(order.ID); err == nil {
		t.Fatal("receipt completed with a clerk as responsible")
	}
	checkStock(t, s, 10)
}
