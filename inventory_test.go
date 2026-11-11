package main

import (
	"database/sql"
	"reflect"
	"testing"
)

func TestInventorySchemaUpgradePreservesData(t *testing.T) {
	s, _ := testStore(t)
	products, _ := s.GetAllProducts()
	if _, err := s.db.Exec(`CREATE TABLE inventories(id INTEGER PRIMARY KEY, status TEXT DEFAULT 'draft', created_at TEXT DEFAULT (datetime('now')), completed_at TEXT);
	CREATE TABLE inventory_items(id INTEGER PRIMARY KEY,inventory_id INTEGER,product_id INTEGER,system_count INTEGER,actual_count INTEGER,UNIQUE(inventory_id,product_id));
	INSERT INTO inventories(id) VALUES(7);
	INSERT INTO inventory_items(inventory_id,product_id,system_count,actual_count) VALUES(7,1,10,9)`); err != nil {
		t.Fatal(err)
	}
	i := NewInventoryService(s.db)
	for range 2 {
		if err := i.InitSchema(); err != nil {
			t.Fatal(err)
		}
	}
	details, err := i.GetInventory(7)
	if err != nil || len(details.Items) != 1 || *details.Items[0].ActualCount != 9 || details.Items[0].Comment != "" || details.Kind != "partial" {
		t.Fatalf("details=%+v error=%v", details, err)
	}
	after, _ := s.GetAllProducts()
	if !reflect.DeepEqual(products, after) {
		t.Fatal("schema upgrade changed products")
	}
}

func TestInventoryCountCorrectionAndPersistence(t *testing.T) {
	s, path := testStore(t)
	i := NewInventoryService(s.db)
	if err := i.InitSchema(); err != nil {
		t.Fatal(err)
	}
	draft, err := i.CreateInventory("Test User")
	if err != nil {
		t.Fatal(err)
	}
	request := InventoryParameters{Date: "2026-11-07", Responsible: " Иванов И.И. ", Commission: "Петров П.П., Сидоров С.С.", Kind: "partial", ProductIDs: []int{1, 2}}
	details, err := i.PrepareInventory(draft.ID, request)
	if err != nil || len(details.Items) != 2 || details.Responsible != "Иванов И.И." || details.Date != request.Date {
		t.Fatalf("details=%+v error=%v", details, err)
	}
	eight, seven, negative := 8, 7, -1
	counts := []InventoryCount{{ProductID: 1, ActualCount: &eight, Comment: " Повреждена упаковка "}, {ProductID: 2, ActualCount: &seven}}
	details, err = i.SaveInventoryCounts(draft.ID, counts)
	if err != nil || details.Items[0].Comment != "Повреждена упаковка" {
		t.Fatalf("details=%+v error=%v", details, err)
	}
	product, _ := s.GetProduct(1)
	if product.Count != 10 {
		t.Fatal("counting changed stock")
	}
	if _, err := i.SaveInventoryCounts(draft.ID, []InventoryCount{{ProductID: 1, ActualCount: &seven}, {ProductID: 2, ActualCount: &negative}}); err == nil {
		t.Fatal("negative count accepted")
	}
	details, _ = i.GetInventory(draft.ID)
	if *details.Items[0].ActualCount != 8 {
		t.Fatal("failed save changed another item")
	}
	if _, err := i.PrepareInventory(draft.ID, request); err == nil {
		t.Fatal("counted inventory restarted")
	}
	if err := i.ApplyInventory(draft.ID); err != nil {
		t.Fatal(err)
	}
	if err := i.ApplyInventory(draft.ID); err == nil {
		t.Fatal("correction applied twice")
	}
	product, _ = s.GetProduct(1)
	if product.Count != 8 {
		t.Fatal("stock not corrected")
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	reopened := NewInventoryService(db)
	details, err = reopened.GetInventory(draft.ID)
	if err != nil || details.Status != "completed" || details.CompletedAt == "" || details.Commission != request.Commission || details.Items[0].Comment != "Повреждена упаковка" {
		t.Fatalf("details=%+v error=%v", details, err)
	}
	list, err := reopened.GetInventories()
	if err != nil || len(list) != 1 || list[0].ID != draft.ID {
		t.Fatalf("list=%v error=%v", list, err)
	}
}

func TestInventoryFullAndValidation(t *testing.T) {
	s, _ := testStore(t)
	i := NewInventoryService(s.db)
	if err := i.InitSchema(); err != nil {
		t.Fatal(err)
	}
	draft, _ := i.CreateInventory("Test User")
	valid := InventoryParameters{Date: "2026-11-07", Responsible: "Иванов", Kind: "partial", ProductIDs: []int{1}}
	for _, change := range []func(*InventoryParameters){
		func(r *InventoryParameters) { r.Date = "2026-02-30" },
		func(r *InventoryParameters) { r.Responsible = " " },
		func(r *InventoryParameters) { r.Kind = "unknown" },
		func(r *InventoryParameters) { r.ProductIDs = nil },
		func(r *InventoryParameters) { r.ProductIDs = []int{1, 999} },
		func(r *InventoryParameters) { r.ProductIDs = []int{1, 1} },
	} {
		r := valid
		change(&r)
		if _, err := i.PrepareInventory(draft.ID, r); err == nil {
			t.Fatalf("invalid request accepted: %+v", r)
		}
		details, _ := i.GetInventory(draft.ID)
		if len(details.Items) != 0 {
			t.Fatal("failed preparation saved items")
		}
	}
	valid.Kind = "full"
	valid.ProductIDs = nil
	details, err := i.PrepareInventory(draft.ID, valid)
	if err != nil || len(details.Items) != 3 {
		t.Fatalf("details=%+v error=%v", details, err)
	}
	if err := i.ApplyInventory(draft.ID); err == nil {
		t.Fatal("inventory without counts completed")
	}
}
