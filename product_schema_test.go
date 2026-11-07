package main

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"
)

func TestProductUpgradePreservesCatalog(t *testing.T) {
	s, path := testStore(t)
	var demo []Product
	if err := json.Unmarshal(demoProductsJSON, &demo); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("DELETE FROM products"); err != nil {
		t.Fatal(err)
	}
	for _, p := range demo {
		if _, err := s.db.Exec("INSERT INTO products(id, name, count) VALUES(?, ?, ?)", p.ID, p.Name, p.ID); err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		if err := s.InitProducts(); err != nil {
			t.Fatal(err)
		}
	}
	products, err := s.GetAllProducts()
	if err != nil || len(products) != 20 {
		t.Fatalf("products=%+v error=%v", products, err)
	}
	for index, p := range products {
		want := demo[index]
		want.Count = want.ID
		if p != want {
			t.Fatalf("product=%+v want=%+v", p, want)
		}
	}
	var tables int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").Scan(&tables); err != nil || tables != 1 {
		t.Fatalf("extra tables: %d, error=%v", tables, err)
	}
	if _, err := s.db.Exec("UPDATE products SET manufacturer='Наш производитель', count=7 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if err := s.InitProducts(); err != nil {
		t.Fatal(err)
	}
	s.Close()
	t.Chdir(filepath.Dir(path))
	restarted, err := NewDBService()
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	p, err := restarted.GetProduct(1)
	if err != nil || p.Manufacturer != "Наш производитель" || p.Count != 7 || p.Article != demo[0].Article {
		t.Fatalf("product=%+v error=%v", p, err)
	}
	for _, tc := range []struct {
		query string
		id    int
	}{
		{" art-20 ", 20}, {"fipm-20", 20}, {"ГВОЗДИ СТРОИТЕЛЬНЫЕ", 1},
	} {
		expected, err := restarted.GetProduct(tc.id)
		if err != nil {
			t.Fatal(err)
		}
		found, err := restarted.SearchProducts(tc.query)
		if err != nil || len(found) != 1 || found[0] != expected {
			t.Fatalf("query=%q products=%+v error=%v", tc.query, found, err)
		}
		page, err := restarted.SearchProductsPage(tc.query, 0)
		if err != nil || len(page.Products) != 1 || page.Products[0] != expected || page.HasMore {
			t.Fatalf("query=%q page=%+v error=%v", tc.query, page, err)
		}
	}
}

func TestProductMetadataSurvivesReceivingAndInventory(t *testing.T) {
	s, _ := testStore(t)
	if _, err := s.db.Exec("UPDATE products SET article='TEST-1', sku='SKU-1', warehouse='MSK-01', storage_location='A-01-01-1' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	before, err := s.GetProduct(1)
	if err != nil {
		t.Fatal(err)
	}
	order, err := s.CreateReceiving(ReceivingRequest{ProductID: 1, Quantity: "2", Responsible: "Иванов И.И.", Location: "A-01-01-1"})
	if err != nil {
		t.Fatal(err)
	}
	completed, err := s.CompleteReceiving(order.ID)
	want := before
	want.Count += 2
	if err != nil || completed.Product != want {
		t.Fatalf("receiving=%+v error=%v", completed, err)
	}
	stock, err := s.GetProductStock(1)
	if err != nil || stock.Product != want || stock.Free != 12 {
		t.Fatalf("stock=%+v error=%v", stock, err)
	}
	i := NewInventoryService(s.db)
	if err := i.InitSchema(); err != nil {
		t.Fatal(err)
	}
	draft, err := i.CreateInventory()
	if err != nil {
		t.Fatal(err)
	}
	details, err := i.PrepareInventory(draft.ID, InventoryParameters{Date: "2026-11-07", Responsible: "Иванов И.И.", Kind: "partial", ProductIDs: []int{1}})
	if err != nil || len(details.Items) != 1 {
		t.Fatalf("inventory=%+v error=%v", details, err)
	}
	item := details.Items[0]
	if item.Article != want.Article || item.StorageLocation != want.StorageLocation || item.SystemCount != 12 {
		t.Fatalf("item=%+v", item)
	}
	count := 11
	if _, err := i.SaveInventoryCounts(draft.ID, []InventoryCount{{ProductID: 1, ActualCount: &count}}); err != nil {
		t.Fatal(err)
	}
	if err := i.ApplyInventory(draft.ID); err != nil {
		t.Fatal(err)
	}
	after, err := s.GetProduct(1)
	want.Count = 11
	if err != nil || !reflect.DeepEqual(want, after) {
		t.Fatalf("product=%+v error=%v", after, err)
	}
	outgoing, err := s.CreateOutgoing(outgoingRequest())
	if err != nil {
		t.Fatal(err)
	}
	shipped, err := s.CompleteOutgoing(outgoing.Order.ID, completeRequest())
	want.Count -= 4
	if err != nil || len(shipped.Stock) != 2 || shipped.Stock[0].Product != want {
		t.Fatalf("outgoing=%+v error=%v", shipped, err)
	}

}
