package main

import (
	"database/sql"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
)

func receivingRequest() ReceivingRequest {
	return ReceivingRequest{ProductID: 1, Quantity: "3", Responsible: " Иванов Иван Иванович ", Location: " Стеллаж 1 "}
}

func checkStock(t *testing.T, s *DBService, want int) {
	t.Helper()
	product, err := s.GetProduct(1)
	if err != nil || product.Count != want {
		t.Fatalf("product=%+v error=%v, want count=%d", product, err, want)
	}
}

func TestReceivingValidation(t *testing.T) {
	s, _ := testOrderStore(t)
	for _, quantity := range []string{"", "0", "-1", "+1", "1.5", "1e2", "NaN", " 3", "9007199254740992", "18446744073709551616"} {
		request := receivingRequest()
		request.Quantity = quantity
		if _, err := s.CreateReceiving(request); err == nil {
			t.Errorf("accepted quantity %q", quantity)
		}
	}
	for _, change := range []func(*ReceivingRequest){
		func(r *ReceivingRequest) { r.Responsible = " \t" },
		func(r *ReceivingRequest) { r.Location = "\n" },
		func(r *ReceivingRequest) { r.ProductID = 999 },
		func(r *ReceivingRequest) { r.ProductID = 0 },
	} {
		request := receivingRequest()
		change(&request)
		if _, err := s.CreateReceiving(request); err == nil {
			t.Error("invalid request accepted")
		}
	}
	checkStock(t, s, 10)
}

func TestReceivingDraftCancelAndPersistence(t *testing.T) {
	s, path := testOrderStore(t)
	beforeSchema := schema(t, s.db)
	beforeProducts, err := s.GetAllProducts()
	if err != nil {
		t.Fatal(err)
	}
	order, err := s.CreateReceiving(receivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	if order.Status != "pending" || order.Responsible != "Иванов Иван Иванович" || order.Location != "Стеллаж 1" {
		t.Fatalf("order=%+v", order)
	}
	stored, err := s.GetReceiving(order.ID)
	if err != nil || !reflect.DeepEqual(stored, order) {
		t.Fatalf("stored=%+v error=%v", stored, err)
	}
	checkStock(t, s, 10)
	if err := s.CancelReceiving(order.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetReceiving(order.ID); err == nil {
		t.Fatal("cancelled draft found")
	}
	if _, err := s.CompleteReceiving(order.ID); err == nil {
		t.Fatal("cancelled draft completed")
	}
	checkStock(t, s, 10)
	order, err = s.CreateReceiving(receivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	completed, err := s.CompleteReceiving(order.ID)
	if err != nil || completed.Status != "completed" || completed.Product.Count != 13 {
		t.Fatalf("completed=%+v error=%v", completed, err)
	}
	if again, err := s.CompleteReceiving(order.ID); err != nil || !reflect.DeepEqual(again, completed) {
		t.Fatalf("repeat=%+v error=%v", again, err)
	}
	if err := s.CancelReceiving(order.ID); err == nil {
		t.Fatal("completed order cancelled")
	}
	checkStock(t, s, 13)
	beforeProducts[0].Count = 13
	afterProducts, err := s.GetAllProducts()
	if err != nil || !reflect.DeepEqual(beforeProducts, afterProducts) || beforeSchema != schema(t, s.db) {
		t.Fatal("unexpected product or schema changes")
	}
	s.Close()
	t.Chdir(filepath.Dir(path))
	restarted, err := NewDBService()
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	checkStock(t, restarted, 13)
	if _, err := restarted.GetReceiving(order.ID); err == nil {
		t.Fatal("order unexpectedly survived restart")
	}
	if _, err := restarted.CompleteReceiving(order.ID); err == nil {
		t.Fatal("old order replayed after restart")
	}
}

func TestReceivingConcurrentCompletionAndCatalog(t *testing.T) {
	s, _ := testOrderStore(t)
	s.db.SetMaxOpenConns(1)
	const orders = 20
	shared, err := s.CreateReceiving(receivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	for i := 0; i < orders; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			order, err := s.CreateReceiving(receivingRequest())
			if err != nil {
				t.Error(err)
				return
			}
			if _, err := s.SearchProducts("мол"); err != nil {
				t.Error(err)
			}
			for attempt := 0; attempt < 2; attempt++ {
				if _, err := s.CompleteReceiving(order.ID); err != nil {
					t.Error(err)
				}
				if _, err := s.CompleteReceiving(shared.ID); err != nil {
					t.Error(err)
				}
			}
		}()
	}
	group.Wait()
	checkStock(t, s, 10+(orders+1)*3)
}

func TestReceivingCancelDuringCompletion(t *testing.T) {
	s, _ := testOrderStore(t)
	order, err := s.CreateReceiving(receivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	var completeErr, cancelErr error
	var group sync.WaitGroup
	group.Add(2)
	go func() { defer group.Done(); _, completeErr = s.CompleteReceiving(order.ID) }()
	go func() { defer group.Done(); cancelErr = s.CancelReceiving(order.ID) }()
	group.Wait()
	if (completeErr == nil) == (cancelErr == nil) {
		t.Fatalf("complete=%v cancel=%v", completeErr, cancelErr)
	}
	if completeErr == nil {
		checkStock(t, s, 13)
	} else {
		checkStock(t, s, 10)
	}
}

func TestReceivingInvalidStoredCounts(t *testing.T) {
	for _, stored := range []any{nil, -1, 1.5, "invalid", int64(1<<63 - 1), maxSafeCount - 1} {
		s, _ := testOrderStore(t)
		order, err := s.CreateReceiving(receivingRequest())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.db.Exec("UPDATE products SET count = ? WHERE id = 1", stored); err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateReceiving(receivingRequest()); err == nil {
			t.Errorf("invalid stored count accepted: %v", stored)
		}
		if _, err := s.CompleteReceiving(order.ID); err == nil {
			t.Errorf("invalid stored count updated: %v", stored)
		}
		pending, err := s.GetReceiving(order.ID)
		if err != nil || pending.Status != "pending" {
			t.Fatalf("pending=%+v error=%v", pending, err)
		}
	}
}

func TestReceivingSQLiteFailureAndRetry(t *testing.T) {
	s, _ := testOrderStore(t)
	order, err := s.CreateReceiving(receivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`CREATE TRIGGER reject_update BEFORE UPDATE ON products BEGIN SELECT RAISE(ABORT, 'test failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteReceiving(order.ID); err == nil {
		t.Fatal("SQLite error ignored")
	}
	checkStock(t, s, 10)
	if pending, err := s.GetReceiving(order.ID); err != nil || pending.Status != "pending" {
		t.Fatalf("pending=%+v error=%v", pending, err)
	}
	if _, err := s.db.Exec("DROP TRIGGER reject_update"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteReceiving(order.ID); err != nil {
		t.Fatal(err)
	}
	checkStock(t, s, 13)
	s.Close()
	if _, err := s.CreateReceiving(receivingRequest()); err == nil {
		t.Fatal("closed database ignored")
	}
}

func TestReceivingCommitFailure(t *testing.T) {
	s, path := testOrderStore(t)
	order, err := s.CreateReceiving(receivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	reader, err := sql.Open("sqlite", "file:"+path+"?mode=rw")
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	transaction, err := reader.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer transaction.Rollback()
	var stock int
	if err := transaction.QueryRow("SELECT count FROM products WHERE id = 1").Scan(&stock); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteReceiving(order.ID); err == nil {
		t.Fatal("locked commit succeeded")
	}
	if pending, err := s.GetReceiving(order.ID); err != nil || pending.Status != "pending" {
		t.Fatalf("pending=%+v error=%v", pending, err)
	}
	if err := transaction.Rollback(); err != nil {
		t.Fatal(err)
	}
	checkStock(t, s, 10)
	if _, err := s.CompleteReceiving(order.ID); err != nil {
		t.Fatal(err)
	}
	checkStock(t, s, 13)
}
