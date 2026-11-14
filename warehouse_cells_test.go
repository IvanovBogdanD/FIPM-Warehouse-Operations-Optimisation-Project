package main

import (
	"path/filepath"
	"reflect"
	"testing"
)

func checkWarehouseTotals(t *testing.T, s *DBService) {
	t.Helper()
	products, err := s.GetAllProducts()
	if err != nil {
		t.Fatal(err)
	}
	stocks, err := s.GetWarehouseStocks()
	if err != nil {
		t.Fatal(err)
	}
	totals := map[int]int{}
	for _, stock := range stocks {
		if stock.X < 1 || stock.X > 8 || stock.Y < 1 || stock.Y > 8 || stock.Count <= 0 {
			t.Fatalf("invalid cell: %+v", stock)
		}
		totals[stock.ProductID] += stock.Count
	}
	for _, product := range products {
		if product.Count != totals[product.ID] {
			t.Fatalf("product %d total=%d cells=%d", product.ID, product.Count, totals[product.ID])
		}
	}
}

func TestWarehouseInitialPlacementAndRestart(t *testing.T) {
	s, path := testOrderStore(t)
	before, err := s.GetAllProducts()
	if err != nil {
		t.Fatal(err)
	}
	stocks, err := s.GetWarehouseStocks()
	if err != nil || len(stocks) != 2 || stocks[0].X != 1 || stocks[0].Y != 1 || stocks[1].X != 2 || stocks[1].Count != 5 {
		t.Fatalf("stocks=%+v error=%v", stocks, err)
	}
	if err := s.InitWarehouse(); err != nil {
		t.Fatal(err)
	}
	after, err := s.GetAllProducts()
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("initial placement changed catalog")
	}
	s.Close()
	t.Chdir(filepath.Dir(path))
	reopened, err := NewDBService()
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if err := reopened.InitWarehouse(); err != nil {
		t.Fatal(err)
	}
	again, err := reopened.GetWarehouseStocks()
	if err != nil || !reflect.DeepEqual(stocks, again) {
		t.Fatalf("restart=%+v error=%v", again, err)
	}
}

func TestWarehouseReceivingUsesOneCellForWholeDelivery(t *testing.T) {
	s, _ := testOrderStore(t)
	r := ReceivingRequest{ResponsibleID: 1, Placement: "manual", X: 8, Y: 8,
		Items: []ReceivingItemRequest{{ProductID: 1, Quantity: "3"}, {ProductID: 2, Quantity: "4"}}}
	created, err := s.CreateReceiving(r)
	if err != nil {
		t.Fatal(err)
	}
	stocks, _ := s.GetWarehouseStocks()
	if len(stocks) != 2 {
		t.Fatal("draft occupied a cell")
	}
	done, err := s.CompleteReceiving(created.ID)
	if err != nil || done.X != 8 || done.Y != 8 || done.Items[0].Location != "X8 Y8" || done.Items[1].Location != "X8 Y8" {
		t.Fatalf("receipt=%+v error=%v", done, err)
	}
	if _, err := s.CompleteReceiving(created.ID); err != nil {
		t.Fatal(err)
	}
	stocks, _ = s.GetWarehouseStocks()
	if len(stocks) != 4 {
		t.Fatal("receipt lost or duplicated cell contents")
	}
	conflict, err := s.CreateReceiving(r)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteReceiving(conflict.ID); err == nil {
		t.Fatal("occupied manual cell accepted")
	}
	r.X = 9
	if _, err := s.CreateReceiving(r); err == nil {
		t.Fatal("invalid coordinates accepted")
	}
	checkWarehouseTotals(t, s)
}

func TestWarehouseFullCapacityAndCellReuse(t *testing.T) {
	s, _ := testOrderStore(t)
	for range 62 {
		created, err := s.CreateReceiving(receivingRequest())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.CompleteReceiving(created.ID); err != nil {
			t.Fatal(err)
		}
	}
	pending, err := s.CreateReceiving(receivingRequest())
	if err != nil {
		t.Fatal(err)
	}
	before, _ := s.GetAllProducts()
	if _, err := s.CompleteReceiving(pending.ID); err == nil {
		t.Fatal("65th occupied cell accepted")
	}
	after, _ := s.GetAllProducts()
	if !reflect.DeepEqual(before, after) {
		t.Fatal("failed receiving changed counts")
	}
	r := outgoingRequest()
	r.Items = []OutgoingItemRequest{{ProductID: 2, Quantity: "5"}}
	outgoing, err := s.CreateOutgoing(r)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteOutgoing(outgoing.Order.ID, completeRequest()); err != nil {
		t.Fatal(err)
	}
	done, err := s.CompleteReceiving(pending.ID)
	if err != nil || done.X != 2 || done.Y != 1 {
		t.Fatalf("freed cell not reused: %+v %v", done, err)
	}
	checkWarehouseTotals(t, s)
}

func TestWarehouseFIFOAndLIFO(t *testing.T) {
	for _, rotation := range []string{"FIFO", "LIFO"} {
		t.Run(rotation, func(t *testing.T) {
			s, _ := testOrderStore(t)
			if _, err := s.db.Exec("UPDATE products SET rotation=? WHERE id=1", rotation); err != nil {
				t.Fatal(err)
			}
			for _, quantity := range []string{"3", "4"} {
				r := receivingRequest()
				r.Quantity = quantity
				created, err := s.CreateReceiving(r)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := s.CompleteReceiving(created.ID); err != nil {
					t.Fatal(err)
				}
			}
			created, err := s.CreateOutgoing(outgoingRequest())
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.CompleteOutgoing(created.Order.ID, completeRequest()); err != nil {
				t.Fatal(err)
			}
			locations, err := s.GetProductLocations(1)
			if err != nil {
				t.Fatal(err)
			}
			if rotation == "FIFO" && (len(locations) != 3 || locations[0].Count != 6) {
				t.Fatalf("FIFO: %+v", locations)
			}
			if rotation == "LIFO" && (len(locations) != 2 || locations[0].Count != 10) {
				t.Fatalf("LIFO: %+v", locations)
			}
			checkWarehouseTotals(t, s)
		})
	}
}

func TestInventoryCountsSameProductSeparatelyByCell(t *testing.T) {
	s, _ := testOrderStore(t)
	created, _ := s.CreateReceiving(receivingRequest())
	if _, err := s.CompleteReceiving(created.ID); err != nil {
		t.Fatal(err)
	}
	locations, _ := s.GetProductLocations(1)
	i := NewInventoryService(s.db)
	if err := i.InitSchema(); err != nil {
		t.Fatal(err)
	}
	inv, err := i.CreateInventory("Проверка")
	if err != nil {
		t.Fatal(err)
	}
	r := InventoryParameters{Date: "2026-11-14", Responsible: "Проверка", Kind: "partial", ByCells: true,
		StockIDs: []int{locations[0].ID, locations[1].ID}}
	details, err := i.PrepareInventory(inv.ID, r)
	if err != nil || len(details.Items) != 2 || !details.ByCells {
		t.Fatalf("details=%+v error=%v", details, err)
	}
	first, second := 8, 4
	counts := []InventoryCount{{ProductID: 1, StockID: locations[0].ID, ActualCount: &first, Comment: "Упаковка"},
		{ProductID: 1, StockID: locations[1].ID, ActualCount: &second}}
	if _, err := i.SaveInventoryCounts(inv.ID, counts); err != nil {
		t.Fatal(err)
	}
	details, err = i.PrepareInventory(inv.ID, r)
	if err != nil || *details.Items[0].ActualCount != 8 || details.Items[0].Comment != "Упаковка" || *details.Items[1].ActualCount != 4 {
		t.Fatalf("counts lost on re-prepare: %+v %v", details, err)
	}
	if err := i.SetActualCount(inv.ID, 1, 10); err == nil {
		t.Fatal("ambiguous product-only update accepted")
	}
	if err := i.ApplyInventory(inv.ID); err != nil {
		t.Fatal(err)
	}
	checkStock(t, s, 12)
	checkWarehouseTotals(t, s)
	if err := i.ApplyInventory(inv.ID); err == nil {
		t.Fatal("completed inventory applied twice")
	}
}

func TestInventoryRejectsChangedCellAndKeepsLegacyDocuments(t *testing.T) {
	s, _ := testOrderStore(t)
	i := NewInventoryService(s.db)
	if err := i.InitSchema(); err != nil {
		t.Fatal(err)
	}
	inv, _ := i.CreateInventory("Проверка")
	details, err := i.PrepareInventory(inv.ID, InventoryParameters{Date: "2026-11-14", Responsible: "Проверка", Kind: "full", ByCells: true})
	if err != nil {
		t.Fatal(err)
	}
	counts := []InventoryCount{}
	for _, item := range details.Items {
		actual := item.SystemCount
		counts = append(counts, InventoryCount{ProductID: item.ProductID, StockID: item.StockID, ActualCount: &actual})
	}
	if _, err := i.SaveInventoryCounts(inv.ID, counts); err != nil {
		t.Fatal(err)
	}
	created, err := s.CreateOutgoing(outgoingRequest())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteOutgoing(created.Order.ID, completeRequest()); err != nil {
		t.Fatal(err)
	}
	if err := i.ApplyInventory(inv.ID); err == nil {
		t.Fatal("changed cell overwritten by inventory")
	}
	checkStock(t, s, 6)
	checkWarehouseTotals(t, s)
	legacy, _ := i.CreateInventory("Старая проверка")
	if err := i.AddInventoryItems(legacy.ID, []int{1}); err != nil {
		t.Fatal(err)
	}
	if err := i.SetActualCount(legacy.ID, 1, 7); err != nil {
		t.Fatal(err)
	}
	if err := i.ApplyInventory(legacy.ID); err != nil {
		t.Fatal(err)
	}
	checkStock(t, s, 7)
	checkWarehouseTotals(t, s)
}

func TestInventoryCellMigrationKeepsOldAct(t *testing.T) {
	s, _ := testStore(t)
	if _, err := s.db.Exec(`CREATE TABLE inventories(id INTEGER PRIMARY KEY,status TEXT,created_at TEXT,completed_at TEXT);
        CREATE TABLE inventory_items(id INTEGER PRIMARY KEY,inventory_id INTEGER,product_id INTEGER,system_count INTEGER,actual_count INTEGER,comment TEXT,UNIQUE(inventory_id,product_id));
        INSERT INTO inventories VALUES(9,'completed','2026-11-01','2026-11-02');
        INSERT INTO inventory_items VALUES(17,9,1,10,8,'Старая проверка');`); err != nil {
		t.Fatal(err)
	}
	service := NewInventoryService(s.db)
	if err := service.InitSchema(); err != nil {
		t.Fatal(err)
	}
	details, err := service.GetInventory(9)
	if err != nil || details.ByCells || details.Status != "completed" || len(details.Items) != 1 || details.Items[0].StockID != 0 || *details.Items[0].ActualCount != 8 || details.Items[0].Comment != "Старая проверка" {
		t.Fatalf("old act lost: %+v %v", details, err)
	}
	var id int
	if err := s.db.QueryRow("SELECT id FROM inventory_items WHERE inventory_id=9").Scan(&id); err != nil || id != 17 {
		t.Fatalf("item id=%d %v", id, err)
	}
	if err := service.InitSchema(); err != nil {
		t.Fatal(err)
	}
	again, err := service.GetInventory(9)
	if err != nil || !reflect.DeepEqual(details, again) {
		t.Fatalf("migration not idempotent: %+v %v", again, err)
	}
}

func TestWarehouseReceivingFailureRollsBackWholeCell(t *testing.T) {
	s, _ := testOrderStore(t)
	beforeProducts, _ := s.GetAllProducts()
	beforeCells, _ := s.GetWarehouseStocks()
	request := ReceivingRequest{ResponsibleID: 1, Placement: "auto", Items: []ReceivingItemRequest{{ProductID: 1, Quantity: "3"}, {ProductID: 2, Quantity: "4"}}}
	pending, err := s.CreateReceiving(request)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`CREATE TRIGGER reject_second_cell BEFORE INSERT ON warehouse_stock WHEN NEW.product_id=2 BEGIN SELECT RAISE(ABORT,'cell failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteReceiving(pending.ID); err == nil {
		t.Fatal("partial cell accepted")
	}
	afterProducts, _ := s.GetAllProducts()
	afterCells, _ := s.GetWarehouseStocks()
	if !reflect.DeepEqual(beforeProducts, afterProducts) || !reflect.DeepEqual(beforeCells, afterCells) {
		t.Fatal("failed receipt changed products or cells")
	}
	stored, err := s.GetReceiving(pending.ID)
	if err != nil || stored.Status != "pending" {
		t.Fatalf("pending=%+v %v", stored, err)
	}
	if _, err := s.db.Exec("DROP TRIGGER reject_second_cell"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteReceiving(pending.ID); err != nil {
		t.Fatal(err)
	}
	checkWarehouseTotals(t, s)
}
