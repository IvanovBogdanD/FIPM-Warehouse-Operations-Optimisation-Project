package main

import (
	"database/sql"
	"errors"
	"fmt"
)

func (i *InventoryService) initInventoryCells() error {
	var exists int
	if err := i.db.QueryRow("SELECT count(*) FROM pragma_table_info('inventory_items') WHERE name='stock_id'").Scan(&exists); err != nil {
		return err
	}
	if exists != 0 {
		return nil
	}
	tx, err := i.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`CREATE TABLE inventory_items_cells (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		inventory_id INTEGER NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
		product_id INTEGER NOT NULL REFERENCES products(id),
		stock_id INTEGER,
		x INTEGER CHECK(x BETWEEN 1 AND 8),
		y INTEGER CHECK(y BETWEEN 1 AND 8),
		system_count INTEGER NOT NULL,
		actual_count INTEGER CHECK(actual_count IS NULL OR actual_count >= 0),
		comment TEXT NOT NULL DEFAULT '',
		UNIQUE(inventory_id,stock_id)
	);
	INSERT INTO inventory_items_cells(id,inventory_id,product_id,system_count,actual_count,comment)
		SELECT id,inventory_id,product_id,system_count,actual_count,comment FROM inventory_items;
	DROP TABLE inventory_items;
	ALTER TABLE inventory_items_cells RENAME TO inventory_items;
	CREATE INDEX idx_inventory_items_inventory_id ON inventory_items(inventory_id);
	CREATE UNIQUE INDEX idx_inventory_legacy_product ON inventory_items(inventory_id,product_id) WHERE stock_id IS NULL;`); err != nil {
		return err
	}
	return tx.Commit()
}

func (i *InventoryService) prepareInventoryCells(id int, request InventoryParameters) (InventoryDetails, error) {
	if request.Kind == "partial" && len(request.StockIDs) == 0 {
		return InventoryDetails{}, errors.New("выберите товары в ячейках для проверки")
	}
	tx, err := i.db.Begin()
	if err != nil {
		return InventoryDetails{}, err
	}
	defer tx.Rollback()
	var status string
	if err := tx.QueryRow("SELECT status FROM inventories WHERE id=?", id).Scan(&status); err != nil {
		return InventoryDetails{}, err
	}
	if status != "draft" {
		return InventoryDetails{}, errors.New("инвентаризация уже завершена")
	}
	var legacyRows int
	if err := tx.QueryRow("SELECT count(*) FROM inventory_items WHERE inventory_id=? AND stock_id IS NULL", id).Scan(&legacyRows); err != nil {
		return InventoryDetails{}, err
	}
	if legacyRows > 0 {
		return InventoryDetails{}, errors.New("в документе сохранён общий подсчёт товаров, для проверки по ячейкам создайте новую инвентаризацию")
	}
	type savedCount struct {
		system  int
		actual  sql.NullInt64
		comment string
	}
	saved := map[int]savedCount{}
	rows, err := tx.Query("SELECT stock_id,system_count,actual_count,comment FROM inventory_items WHERE inventory_id=? AND stock_id IS NOT NULL", id)
	if err != nil {
		return InventoryDetails{}, err
	}
	for rows.Next() {
		var stockID int
		var count savedCount
		if err := rows.Scan(&stockID, &count.system, &count.actual, &count.comment); err != nil {
			rows.Close()
			return InventoryDetails{}, err
		}
		saved[stockID] = count
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return InventoryDetails{}, err
	}
	rows, err = tx.Query(warehouseSelect + " ORDER BY ws.id")
	if err != nil {
		return InventoryDetails{}, err
	}
	stocks, err := readWarehouseStock(rows)
	if err != nil {
		return InventoryDetails{}, err
	}
	selected := map[int]bool{}
	for _, stockID := range request.StockIDs {
		if selected[stockID] {
			return InventoryDetails{}, errors.New("позиция ячейки указана дважды")
		}
		selected[stockID] = true
	}
	if _, err := tx.Exec("DELETE FROM inventory_items WHERE inventory_id=?", id); err != nil {
		return InventoryDetails{}, err
	}
	added := 0
	for _, stock := range stocks {
		if request.Kind == "partial" && !selected[stock.ID] {
			continue
		}
		old := saved[stock.ID]
		if old.actual.Valid && old.system != stock.Count {
			return InventoryDetails{}, fmt.Errorf("остаток в ячейке %s изменился после подсчёта, создайте новую проверку", stock.StorageLocation)
		}
		if _, err := tx.Exec(`INSERT INTO inventory_items(inventory_id,product_id,stock_id,x,y,system_count,actual_count,comment) VALUES(?,?,?,?,?,?,?,?)`,
			id, stock.ProductID, stock.ID, stock.X, stock.Y, stock.Count, old.actual, old.comment); err != nil {
			return InventoryDetails{}, err
		}
		added++
	}
	if added == 0 || (request.Kind == "partial" && added != len(selected)) {
		return InventoryDetails{}, errors.New("выбранная позиция больше не находится в ячейке, обновите выбор")
	}
	if _, err := tx.Exec("UPDATE inventories SET inventory_date=?,responsible=?,commission=?,kind=?,by_cells=1 WHERE id=?",
		request.Date, request.Responsible, request.Commission, request.Kind, id); err != nil {
		return InventoryDetails{}, err
	}
	if err := tx.Commit(); err != nil {
		return InventoryDetails{}, err
	}
	return i.GetInventory(id)
}

func (i *InventoryService) DeleteInventoryCell(inventoryID, stockID int) (InventoryDetails, error) {
	result, err := i.db.Exec(`DELETE FROM inventory_items WHERE inventory_id=? AND stock_id=?
		AND EXISTS(SELECT 1 FROM inventories WHERE id=? AND status='draft')`, inventoryID, stockID, inventoryID)
	if err != nil {
		return InventoryDetails{}, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return InventoryDetails{}, err
	}
	if count == 0 {
		return InventoryDetails{}, errors.New("позиция не найдена или инвентаризация завершена")
	}
	return i.GetInventory(inventoryID)
}

func applyInventoryCells(tx *sql.Tx, id int) error {
	rows, err := tx.Query("SELECT product_id,stock_id,x,y,system_count,actual_count FROM inventory_items WHERE inventory_id=?", id)
	if err != nil {
		return err
	}
	type correction struct{ productID, stockID, x, y, system, actual int }
	items := []correction{}
	for rows.Next() {
		var item correction
		if err := rows.Scan(&item.productID, &item.stockID, &item.x, &item.y, &item.system, &item.actual); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	products := map[int]bool{}
	for _, item := range items {
		var count int
		err := tx.QueryRow("SELECT quantity FROM warehouse_stock WHERE id=? AND product_id=? AND x=? AND y=?",
			item.stockID, item.productID, item.x, item.y).Scan(&count)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && count != item.system) {
			return fmt.Errorf("содержимое ячейки %s изменилось после начала проверки, корректировка отменена", warehouseLocation(item.x, item.y))
		}
		if err != nil {
			return err
		}
		if item.actual == 0 {
			_, err = tx.Exec("DELETE FROM warehouse_stock WHERE id=?", item.stockID)
		} else {
			_, err = tx.Exec("UPDATE warehouse_stock SET quantity=? WHERE id=?", item.actual, item.stockID)
		}
		if err != nil {
			return err
		}
		products[item.productID] = true
	}
	for productID := range products {
		if err := syncWarehouseProduct(tx, productID); err != nil {
			return err
		}
	}
	return nil
}

func applyLegacyInventoryStock(tx *sql.Tx, id int) error {
	rows, err := tx.Query("SELECT product_id,actual_count FROM inventory_items WHERE inventory_id=?", id)
	if err != nil {
		return err
	}
	counts := map[int]int{}
	for rows.Next() {
		var productID, actual int
		if err := rows.Scan(&productID, &actual); err != nil {
			rows.Close()
			return err
		}
		counts[productID] = actual
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for productID, actual := range counts {
		if err := setLegacyWarehouseCount(tx, productID, actual); err != nil {
			return err
		}
	}
	return nil
}
