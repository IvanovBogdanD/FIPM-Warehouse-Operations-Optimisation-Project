package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

type InventoryService struct {
	db  *sql.DB
	ctx context.Context
}

func NewInventoryService(db *sql.DB) *InventoryService {
	return &InventoryService{db: db}
}

func (i *InventoryService) InitSchema() error {
	_, err := i.db.Exec(`
		CREATE TABLE IF NOT EXISTS inventories (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
			created_at   TEXT NOT NULL DEFAULT (datetime('now')),
			completed_at TEXT
		)
	`)
	if err != nil {
		return fmt.Errorf("create inventories table: %w", err)
	}

	_, err = i.db.Exec(`
		CREATE TABLE IF NOT EXISTS inventory_items (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			inventory_id INTEGER NOT NULL,
			product_id   INTEGER NOT NULL,
			system_count INTEGER NOT NULL,
			actual_count INTEGER CHECK (actual_count IS NULL OR actual_count >= 0),
			UNIQUE (inventory_id, product_id),
			FOREIGN KEY (inventory_id) REFERENCES inventories(id) ON DELETE CASCADE,
			FOREIGN KEY (product_id) REFERENCES products(id)
		)
	`)
	if err != nil {
		return fmt.Errorf("create inventory_items table: %w", err)
	}

	_, err = i.db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_inventory_items_inventory_id
		ON inventory_items(inventory_id)
	`)
	if err != nil {
		return fmt.Errorf("create inventory_items index: %w", err)
	}
	for _, column := range []struct{ table, name, definition string }{
		{"inventories", "inventory_date", "TEXT NOT NULL DEFAULT ''"},
		{"inventories", "responsible", "TEXT NOT NULL DEFAULT ''"},
		{"inventories", "commission", "TEXT NOT NULL DEFAULT ''"},
		{"inventories", "kind", "TEXT NOT NULL DEFAULT 'partial'"},
		{"inventories", "by_cells", "INTEGER NOT NULL DEFAULT 0"},
		{"inventory_items", "comment", "TEXT NOT NULL DEFAULT ''"},
	} {
		var count int
		if err := i.db.QueryRow("SELECT COUNT(*) FROM pragma_table_info(?) WHERE name=?", column.table, column.name).Scan(&count); err != nil {
			return err
		}
		if count == 0 {
			if _, err := i.db.Exec("ALTER TABLE " + column.table + " ADD COLUMN " + column.name + " " + column.definition); err != nil {
				return fmt.Errorf("добавление поля инвентаризации %s: %w", column.name, err)
			}
		}
	}

	return i.initInventoryCells()
}

type Inventory struct {
	ByCells     bool   `json:"byCells"`
	ID          int    `json:"id"`
	Status      string `json:"status"`
	CreatedAt   string `json:"createdAt"`
	CompletedAt string `json:"completedAt"`
	Date        string `json:"date"`
	Responsible string `json:"responsible"`
	Commission  string `json:"commission"`
	Kind        string `json:"kind"`
}

type InventoryItem struct {
	StockID         int    `json:"stockId,omitempty"`
	X               int    `json:"x,omitempty"`
	Y               int    `json:"y,omitempty"`
	ProductID       int    `json:"productId"`
	ProductName     string `json:"productName"`
	Article         string `json:"article"`
	StorageLocation string `json:"storageLocation"`
	SystemCount     int    `json:"systemCount"`
	ActualCount     *int   `json:"actualCount"`
	Difference      *int   `json:"difference"`
	Comment         string `json:"comment"`
}

type InventoryDetails struct {
	Inventory
	Items []InventoryItem `json:"items"`
}

func (i *InventoryService) CreateInventory(responsible string) (Inventory, error) {
	res, err := i.db.Exec(`INSERT INTO inventories (status, responsible) VALUES ('draft', ?)`, responsible)
	if err != nil {
		return Inventory{}, fmt.Errorf("create inventory: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return Inventory{}, fmt.Errorf("get inventory id: %w", err)
	}

	return i.getInventory(int(id))
}

func (i *InventoryService) getInventory(id int) (Inventory, error) {
	var inv Inventory
	err := i.db.QueryRow(`
		SELECT id, status, created_at, COALESCE(completed_at, ''), inventory_date, responsible, commission, kind, by_cells
		FROM inventories
		WHERE id = ?
	`, id).Scan(&inv.ID, &inv.Status, &inv.CreatedAt, &inv.CompletedAt, &inv.Date, &inv.Responsible, &inv.Commission, &inv.Kind, &inv.ByCells)

	if errors.Is(err, sql.ErrNoRows) {
		return inv, errors.New("inventory not found")
	}
	if err != nil {
		return inv, fmt.Errorf("get inventory: %w", err)
	}

	return inv, nil
}

func (i *InventoryService) AddInventoryItems(inventoryID int, productIDs []int) error {
	if len(productIDs) == 0 {
		return errors.New("product ids are empty")
	}

	tx, err := i.db.Begin()
	if err != nil {
		return fmt.Errorf("begin add inventory items: %w", err)
	}
	defer tx.Rollback()

	var status string
	var byCells bool
	err = tx.QueryRow(`SELECT status,by_cells FROM inventories WHERE id = ?`, inventoryID).Scan(&status, &byCells)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("inventory not found")
	}
	if err != nil {
		return fmt.Errorf("get inventory status: %w", err)
	}
	if status != "draft" {
		return errors.New("inventory is not draft")
	}

	if byCells {
		return errors.New("для этой инвентаризации выберите позиции ячеек через PrepareInventory")
	}

	for _, productID := range productIDs {
		var systemCount int
		err = tx.QueryRow(`SELECT count FROM products WHERE id = ?`, productID).Scan(&systemCount)
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("product %d not found", productID)
		}
		if err != nil {
			return fmt.Errorf("get product count: %w", err)
		}

		_, err = tx.Exec(`
			INSERT INTO inventory_items (inventory_id, product_id, system_count)
			VALUES (?, ?, ?)
			ON CONFLICT DO NOTHING
		`, inventoryID, productID, systemCount)
		if err != nil {
			return fmt.Errorf("insert inventory item: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit add inventory items: %w", err)
	}

	return nil
}

func (i *InventoryService) GetInventory(inventoryID int) (InventoryDetails, error) {
	inv, err := i.getInventory(inventoryID)
	if err != nil {
		return InventoryDetails{}, err
	}

	rows, err := i.db.Query(`
		SELECT ii.product_id, p.name, ii.system_count, ii.actual_count, ii.comment, p.article, p.storage_location,
			COALESCE(ii.stock_id,0),COALESCE(ii.x,0),COALESCE(ii.y,0)
		FROM inventory_items ii
		JOIN products p ON p.id = ii.product_id
		WHERE ii.inventory_id = ?
		ORDER BY p.name,ii.y,ii.x
	`, inventoryID)
	if err != nil {
		return InventoryDetails{}, fmt.Errorf("get inventory items: %w", err)
	}
	defer rows.Close()

	details := InventoryDetails{
		Inventory: inv,
		Items:     make([]InventoryItem, 0),
	}

	for rows.Next() {
		var item InventoryItem
		var actual sql.NullInt64

		err := rows.Scan(&item.ProductID, &item.ProductName, &item.SystemCount, &actual, &item.Comment, &item.Article, &item.StorageLocation, &item.StockID, &item.X, &item.Y)
		if err != nil {
			return InventoryDetails{}, fmt.Errorf("scan inventory item: %w", err)
		}

		if actual.Valid {
			value := int(actual.Int64)
			diff := value - item.SystemCount
			item.ActualCount = &value
			item.Difference = &diff
		}
		if item.StockID != 0 {
			item.StorageLocation = warehouseLocation(item.X, item.Y)
		}

		details.Items = append(details.Items, item)
	}

	if err := rows.Err(); err != nil {
		return InventoryDetails{}, fmt.Errorf("iterate inventory items: %w", err)
	}

	return details, nil
}

func (i *InventoryService) DeleteInventoryItem(inventoryID int, productID int) (InventoryDetails, error) {
	var status string
	err := i.db.QueryRow(`SELECT status FROM inventories WHERE id = ?`, inventoryID).Scan(&status)
	if err != nil {
		return InventoryDetails{}, err
	}
	if status != "draft" {
		return InventoryDetails{}, errors.New("cannot modify completed inventory")
	}

	_, err = i.db.Exec(`DELETE FROM inventory_items WHERE inventory_id = ? AND product_id = ?`, inventoryID, productID)
	if err != nil {
		return InventoryDetails{}, fmt.Errorf("delete inventory item: %w", err)
	}

	return i.GetInventory(inventoryID)
}

func (i *InventoryService) SetActualCount(inventoryID int, productID int, actualCount int) error {
	if actualCount < 0 {
		return errors.New("actual count must be non-negative")
	}
	var count int
	if err := i.db.QueryRow("SELECT count(*) FROM inventory_items WHERE inventory_id=? AND product_id=?", inventoryID, productID).Scan(&count); err != nil {
		return err
	}
	if count > 1 {
		return errors.New("товар находится в нескольких ячейках, сохраните количество для каждой позиции отдельно")
	}

	res, err := i.db.Exec(`
		UPDATE inventory_items
		SET actual_count = ?
		WHERE inventory_id = ?
		  AND product_id = ?
		  AND EXISTS (
			SELECT 1 FROM inventories
			WHERE id = ? AND status = 'draft'
		  )
	`, actualCount, inventoryID, productID, inventoryID)
	if err != nil {
		return fmt.Errorf("set actual count: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("check affected rows: %w", err)
	}
	if affected == 0 {
		return errors.New("inventory item not found or inventory is not draft")
	}

	return nil
}

type InventoryParameters struct {
	ByCells     bool   `json:"byCells"`
	StockIDs    []int  `json:"stockIds"`
	Date        string `json:"date"`
	Responsible string `json:"responsible"`
	Commission  string `json:"commission"`
	Kind        string `json:"kind"`
	ProductIDs  []int  `json:"productIds"`
}

type InventoryCount struct {
	StockID     int    `json:"stockId,omitempty"`
	ProductID   int    `json:"productId"`
	ActualCount *int   `json:"actualCount"`
	Comment     string `json:"comment"`
}

func (i *InventoryService) SaveInventoryCounts(id int, counts []InventoryCount) (InventoryDetails, error) {
	tx, err := i.db.Begin()
	if err != nil {
		return InventoryDetails{}, err
	}
	defer tx.Rollback()
	for _, item := range counts {
		if item.ActualCount != nil && (*item.ActualCount < 0 || int64(*item.ActualCount) > maxSafeCount) {
			return InventoryDetails{}, errors.New("фактическое количество должно быть целым числом от 0 до 9007199254740991")
		}
		result, err := tx.Exec(`UPDATE inventory_items SET actual_count=?,comment=? WHERE inventory_id=? AND product_id=?
			AND ((stock_id IS NULL AND ?=0) OR stock_id=?)
			AND EXISTS(SELECT 1 FROM inventories WHERE id=? AND status='draft')`, item.ActualCount, strings.TrimSpace(item.Comment), id, item.ProductID, item.StockID, item.StockID, id)
		if err != nil {
			return InventoryDetails{}, err
		}
		changed, err := result.RowsAffected()
		if err != nil {
			return InventoryDetails{}, err
		}
		if changed == 0 {
			return InventoryDetails{}, errors.New("позиция не найдена или инвентаризация завершена")
		}
	}
	if err := tx.Commit(); err != nil {
		return InventoryDetails{}, err
	}
	return i.GetInventory(id)
}

func (i *InventoryService) PrepareInventory(id int, request InventoryParameters) (InventoryDetails, error) {
	if _, err := parseOrderDate(request.Date); err != nil {
		return InventoryDetails{}, err
	}
	request.Responsible = strings.TrimSpace(request.Responsible)
	if request.Responsible == "" {
		return InventoryDetails{}, errors.New("укажите ФИО сотрудника")
	}
	if request.Kind != "partial" && request.Kind != "full" {
		return InventoryDetails{}, errors.New("выберите тип инвентаризации")
	}
	if request.ByCells {
		request.Commission = strings.TrimSpace(request.Commission)
		return i.prepareInventoryCells(id, request)
	}
	if request.Kind == "partial" && len(request.ProductIDs) == 0 {
		return InventoryDetails{}, errors.New("выберите товары для проверки")
	}

	tx, err := i.db.Begin()
	if err != nil {
		return InventoryDetails{}, err
	}
	defer tx.Rollback()

	var status string
	var byCells bool
	if err := tx.QueryRow("SELECT status,by_cells FROM inventories WHERE id=?", id).Scan(&status, &byCells); err != nil {
		return InventoryDetails{}, err
	}
	if status != "draft" {
		return InventoryDetails{}, errors.New("инвентаризация уже завершена")
	}

	if byCells {
		return InventoryDetails{}, errors.New("инвентаризация создана по ячейкам, передайте список позиций ячеек")
	}

	// 1. Сохраняем в память старые данные (факт и комментарий)
	oldItems := make(map[int]struct {
		Actual  sql.NullInt64
		Comment string
	})
	rows, err := tx.Query("SELECT product_id, actual_count, comment FROM inventory_items WHERE inventory_id=?", id)
	if err != nil {
		return InventoryDetails{}, err
	}
	for rows.Next() {
		var pid int
		var act sql.NullInt64
		var com string
		if err := rows.Scan(&pid, &act, &com); err == nil {
			oldItems[pid] = struct {
				Actual  sql.NullInt64
				Comment string
			}{act, com}
		}
	}
	rows.Close()

	// 2. Удаляем старый список
	if _, err := tx.Exec("DELETE FROM inventory_items WHERE inventory_id=?", id); err != nil {
		return InventoryDetails{}, err
	}

	// 3. Вставляем новый список, перенося старые данные, если товар остался
	if request.Kind == "full" {
		prodRows, err := tx.Query("SELECT id, count FROM products")
		if err != nil {
			return InventoryDetails{}, err
		}
		for prodRows.Next() {
			var pid, sysCount int
			prodRows.Scan(&pid, &sysCount)

			var act interface{} = nil
			var com string = ""
			if old, exists := oldItems[pid]; exists {
				if old.Actual.Valid {
					act = old.Actual.Int64
				}
				com = old.Comment
			}
			tx.Exec("INSERT INTO inventory_items(inventory_id, product_id, system_count, actual_count, comment) VALUES(?,?,?,?,?)", id, pid, sysCount, act, com)
		}
		prodRows.Close()
	} else {
		for _, pid := range request.ProductIDs {
			var sysCount int
			err := tx.QueryRow("SELECT count FROM products WHERE id=?", pid).Scan(&sysCount)
			if err != nil {
				return InventoryDetails{}, fmt.Errorf("товар %d не найден", pid)
			}

			var act interface{} = nil
			var com string = ""
			if old, exists := oldItems[pid]; exists {
				if old.Actual.Valid {
					act = old.Actual.Int64
				}
				com = old.Comment
			}

			_, err = tx.Exec("INSERT INTO inventory_items(inventory_id, product_id, system_count, actual_count, comment) VALUES(?,?,?,?,?)", id, pid, sysCount, act, com)
			if err != nil {
				return InventoryDetails{}, err
			}
		}
	}

	if _, err := tx.Exec("UPDATE inventories SET inventory_date=?,responsible=?,commission=?,kind=?,by_cells=0 WHERE id=?", request.Date, request.Responsible, strings.TrimSpace(request.Commission), request.Kind, id); err != nil {
		return InventoryDetails{}, err
	}
	if err := tx.Commit(); err != nil {
		return InventoryDetails{}, err
	}
	return i.GetInventory(id)
}

type InventoryEmployee struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

func (i *InventoryService) GetInventoryEmployees() ([]InventoryEmployee, error) {
	// Жесткий фильтр: только Менеджеры
	rows, err := i.db.Query("SELECT id,trim(last_name || ' ' || first_name || ' ' || COALESCE(middle_name,'')) FROM users WHERE is_approved=1 AND role='Менеджер' ORDER BY last_name,first_name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	employees := []InventoryEmployee{}
	for rows.Next() {
		var employee InventoryEmployee
		if err := rows.Scan(&employee.ID, &employee.Name); err != nil {
			return nil, err
		}
		employees = append(employees, employee)
	}
	return employees, rows.Err()
}

func (i *InventoryService) ApplyInventory(inventoryID int) error {
	tx, err := i.db.Begin()
	if err != nil {
		return fmt.Errorf("begin apply inventory: %w", err)
	}
	defer tx.Rollback()

	var status string
	var byCells bool
	err = tx.QueryRow(`SELECT status,by_cells FROM inventories WHERE id = ?`, inventoryID).Scan(&status, &byCells)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("inventory not found")
	}
	if err != nil {
		return fmt.Errorf("get inventory status: %w", err)
	}
	if status != "draft" {
		return errors.New("inventory is not draft")
	}

	var itemCount int
	err = tx.QueryRow(`SELECT COUNT(id) FROM inventory_items WHERE inventory_id = ?`, inventoryID).Scan(&itemCount)
	if err != nil {
		return fmt.Errorf("count inventory items: %w", err)
	}
	if itemCount == 0 {
		return errors.New("inventory has no items")
	}

	var missingCount int
	err = tx.QueryRow(`
		SELECT COUNT(id)
		FROM inventory_items
		WHERE inventory_id = ? AND actual_count IS NULL
	`, inventoryID).Scan(&missingCount)
	if err != nil {
		return fmt.Errorf("count items without actual count: %w", err)
	}
	if missingCount > 0 {
		return errors.New("some inventory items have no actual count")
	}

	if byCells {
		if err := applyInventoryCells(tx, inventoryID); err != nil {
			return err
		}
	} else {
		if err := applyLegacyInventoryStock(tx, inventoryID); err != nil {
			return err
		}
		_, err = tx.Exec(`
		UPDATE products
		SET count = (
			SELECT ii.actual_count
			FROM inventory_items ii
			WHERE ii.inventory_id = ?
			  AND ii.product_id = products.id
		)
		WHERE id IN (
			SELECT product_id
			FROM inventory_items
			WHERE inventory_id = ?
		)
	`, inventoryID, inventoryID)
		if err != nil {
			return fmt.Errorf("update product counts: %w", err)
		}

	}

	_, err = tx.Exec(`
		UPDATE inventories
		SET status = 'completed',
		    completed_at = datetime('now')
		WHERE id = ? AND status = 'draft'
	`, inventoryID)
	if err != nil {
		return fmt.Errorf("complete inventory: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit apply inventory: %w", err)
	}

	return nil
}

func (i *InventoryService) GetDraftInventory() (*InventoryDetails, error) {
	var id int
	err := i.db.QueryRow(`
		SELECT id FROM inventories
		WHERE status = 'draft'
		ORDER BY id DESC
		LIMIT 1
	`).Scan(&id)

	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get draft inventory: %w", err)
	}

	details, err := i.GetInventory(id)
	if err != nil {
		return nil, err
	}
	return &details, nil
}

func (i *InventoryService) GetInventories() ([]Inventory, error) {
	rows, err := i.db.Query(`SELECT id,status,created_at,COALESCE(completed_at,''),inventory_date,responsible,commission,kind,by_cells FROM inventories ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	inventories := []Inventory{}
	for rows.Next() {
		var inventory Inventory
		if err := rows.Scan(&inventory.ID, &inventory.Status, &inventory.CreatedAt, &inventory.CompletedAt, &inventory.Date, &inventory.Responsible, &inventory.Commission, &inventory.Kind, &inventory.ByCells); err != nil {
			return nil, err
		}
		inventories = append(inventories, inventory)
	}
	return inventories, rows.Err()
}
