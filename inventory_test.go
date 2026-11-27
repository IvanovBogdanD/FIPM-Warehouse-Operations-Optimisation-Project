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
	details, err := i.GetInventory(7, 0)
	if err != nil || len(details.Items) != 1 || *details.Items[0].ActualCount != 9 || details.Items[0].Comment != "" || details.Kind != "partial" {
		t.Fatalf("details=%+v error=%v", details, err)
	}
	after, _ := s.GetAllProducts()
	if !reflect.DeepEqual(products, after) {
		t.Fatal("schema upgrade changed products")
	}
}

func TestInventoryCountCorrectionAndPersistence(t *testing.T) {
	s, path := testOrderStore(t)
	i := NewInventoryService(s.db)
	if err := i.InitSchema(); err != nil {
		t.Fatal(err)
	}
	draft, err := i.CreateInventory(1, "Кладовщик")
	if err != nil {
		t.Fatal(err)
	}
	request := InventoryParameters{Date: "2026-11-07", CommissionIDs: []int{1, 2}, Kind: "partial", ProductIDs: []int{1, 2}}
	details, err := i.PrepareInventory(draft.ID, request, 1)
	if err != nil || len(details.Items) != 2 || details.Commission != "Иванов Иван Иванович, Петрова А.С." || len(details.CommissionManagers) != 2 || details.Date != request.Date {
		t.Fatalf("details=%+v error=%v", details, err)
	}
	if _, err := i.GenerateInventoryReport(draft.ID, 1); err == nil {
		t.Fatal("report generated before counting")
	}
	eight, seven, negative := 8, 7, -1
	counts := []InventoryCount{{ProductID: 1, ActualCount: &eight, Comment: " Повреждена упаковка "}, {ProductID: 2, ActualCount: &seven}}
	details, err = i.SaveInventoryCounts(draft.ID, counts, 1, "Кладовщик")
	if err != nil || details.Items[0].Comment != "Повреждена упаковка" {
		t.Fatalf("details=%+v error=%v", details, err)
	}
	
	if err := i.SubmitForReview(draft.ID, 1, "Кладовщик"); err != nil {
		t.Fatal(err)
	}

	reports, err := i.GetInventoryReports(0, "Кладовщик")
	if err != nil || len(reports) != 1 || reports[0].ID != draft.ID || reports[0].Status != "pending" {
		t.Fatalf("draft reports=%v error=%v", reports, err)
	}

	// Кладовщик не может править после отправки
	if _, err := i.SaveInventoryCounts(draft.ID, counts, 1, "Кладовщик"); err == nil {
		t.Fatal("storekeeper edited after submission")
	}

	// Менеджер 1 подтверждает
	if err := i.ApproveInventory(draft.ID, 1, "Менеджер"); err != nil {
		t.Fatal(err)
	}
	details, _ = i.GetInventory(draft.ID, 1)
	if details.Status != "pending" || !details.IsApprovedByMe || !details.WaitForOtherApprove {
		t.Fatalf("manager1 approve status wrong: %+v", details)
	}

	// Менеджер 2 подтверждает -> Авто-завершение
	if err := i.ApproveInventory(draft.ID, 2, "Менеджер"); err != nil {
		t.Fatal(err)
	}
	details, _ = i.GetInventory(draft.ID, 2)
	if details.Status != "completed" {
		t.Fatalf("inventory not completed: %+v", details)
	}

	product, _ := s.GetProduct(1)
	if product.Count != 8 {
		t.Fatal("stock not corrected")
	}
	
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	reopened := NewInventoryService(db)
	details, err = reopened.GetInventory(draft.ID, 0)
	if err != nil || details.Status != "completed" || details.CompletedAt == "" || details.Commission != request.Commission || details.Items[0].Comment != "Повреждена упаковка" {
		t.Fatalf("details=%+v error=%v", details, err)
	}
	list, err := reopened.GetInventories(0, "Кладовщик")
	if err != nil || len(list) != 1 || list[0].ID != draft.ID {
		t.Fatalf("list=%v error=%v", list, err)
	}
	reports, err = reopened.GetInventoryReports(0, "Кладовщик")
	if err != nil || len(reports) != 1 || reports[0].ID != draft.ID || reports[0].Status != "completed" {
		t.Fatalf("completed reports=%v error=%v", reports, err)
	}
	archived, err := reopened.GetInventoryReport(draft.ID, 0)
	if err != nil || !reflect.DeepEqual(archived, details) {
		t.Fatalf("archived=%+v error=%v", archived, err)
	}
}

func TestInventoryFullAndValidation(t *testing.T) {
	s, _ := testOrderStore(t)
	i := NewInventoryService(s.db)
	if err := i.InitSchema(); err != nil {
		t.Fatal(err)
	}
	draft, _ := i.CreateInventory(1, "Кладовщик")
	valid := InventoryParameters{Date: "2026-11-07", CommissionIDs: []int{1}, Kind: "partial", ProductIDs: []int{1}}
	for _, change := range []func(*InventoryParameters){
		func(r *InventoryParameters) { r.Date = "2026-02-30" },
		func(r *InventoryParameters) { r.CommissionIDs = nil },
		func(r *InventoryParameters) { r.CommissionIDs = []int{1, 3} },
		func(r *InventoryParameters) { r.Kind = "unknown" },
		func(r *InventoryParameters) { r.ProductIDs = nil },
		func(r *InventoryParameters) { r.ProductIDs = []int{1, 999} },
		func(r *InventoryParameters) { r.ProductIDs = []int{1, 1} },
	} {
		r := valid
		change(&r)
		if _, err := i.PrepareInventory(draft.ID, r, 1); err == nil {
			t.Fatalf("invalid request accepted: %+v", r)
		}
		details, _ := i.GetInventory(draft.ID, 0)
		if len(details.Items) != 0 {
			t.Fatal("failed preparation saved items")
		}
	}
	valid.Kind = "full"
	valid.ProductIDs = nil
	details, err := i.PrepareInventory(draft.ID, valid, 1)
	if err != nil || len(details.Items) != 3 {
		t.Fatalf("details=%+v error=%v", details, err)
	}
	if err := i.SubmitForReview(draft.ID, 1, "Кладовщик"); err == nil {
		t.Fatal("inventory without counts submitted")
	}
}