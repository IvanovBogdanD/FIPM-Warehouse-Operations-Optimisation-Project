package main

import (
	"context"
	"database/sql"
	"encoding/json"
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
	// --- БЕЗОПАСНАЯ МИГРАЦИЯ СУЩЕСТВУЮЩЕЙ ТАБЛИЦЫ ---
	var tableSql string
	_ = i.db.QueryRow("SELECT COALESCE(sql, '') FROM sqlite_master WHERE type='table' AND name='inventories'").Scan(&tableSql)
	
	if tableSql != "" && !strings.Contains(tableSql, "'pending'") {
		if _, err := i.db.Exec("PRAGMA foreign_keys=OFF"); err != nil { return err }

		tx, err := i.db.Begin()
		if err != nil { return err }
		
		if _, err := tx.Exec("ALTER TABLE inventories RENAME TO inventories_old_migration"); err != nil { tx.Rollback(); return err }

		if _, err := tx.Exec(`
			CREATE TABLE inventories (
				id           INTEGER PRIMARY KEY AUTOINCREMENT,
				status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'completed')),
				created_at   TEXT NOT NULL DEFAULT (datetime('now')),
				completed_at TEXT,
				inventory_date TEXT NOT NULL DEFAULT '',
				commission_managers TEXT NOT NULL DEFAULT '[]',
				commission TEXT NOT NULL DEFAULT '',
				kind TEXT NOT NULL DEFAULT 'partial',
				by_cells INTEGER NOT NULL DEFAULT 0
			)
		`); err != nil { tx.Rollback(); return err }

		rows, err := tx.Query("SELECT name FROM pragma_table_info('inventories_old_migration')")
		if err != nil { tx.Rollback(); return err }
		oldCols := make(map[string]bool)
		for rows.Next() {
			var col string
			rows.Scan(&col)
			oldCols[col] = true
		}
		rows.Close()

		var insertCols []string
		allCols := []string{"id", "status", "created_at", "completed_at", "inventory_date", "commission_managers", "commission", "kind", "by_cells"}
		for _, col := range allCols {
			if oldCols[col] {
				insertCols = append(insertCols, col)
			}
		}

		if len(insertCols) > 0 {
			query := fmt.Sprintf("INSERT INTO inventories (%s) SELECT %s FROM inventories_old_migration", strings.Join(insertCols, ","), strings.Join(insertCols, ","))
			if _, err := tx.Exec(query); err != nil { tx.Rollback(); return err }
		}

		if _, err := tx.Exec("DROP TABLE inventories_old_migration"); err != nil { tx.Rollback(); return err }
		
		if err := tx.Commit(); err != nil { return err }
		if _, err := i.db.Exec("PRAGMA foreign_keys=ON"); err != nil { return err }
	}

	// Создание таблиц (если их нет)
	_, err := i.db.Exec(`
		CREATE TABLE IF NOT EXISTS inventories (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'completed')),
			created_at   TEXT NOT NULL DEFAULT (datetime('now')),
			completed_at TEXT
		)
	`)
	if err != nil { return fmt.Errorf("create inventories table: %w", err) }

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
	if err != nil { return fmt.Errorf("create inventory_items table: %w", err) }

	_, err = i.db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_inventory_items_inventory_id
		ON inventory_items(inventory_id)
	`)
	if err != nil { return fmt.Errorf("create inventory_items index: %w", err) }

	_, err = i.db.Exec(`
		CREATE TABLE IF NOT EXISTS inventory_approvals (
			inventory_id INTEGER NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
			manager_id   INTEGER NOT NULL REFERENCES users(id),
			approved_at  TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (inventory_id, manager_id)
		)
	`)
	if err != nil { return fmt.Errorf("create inventory_approvals table: %w", err) }

	for _, column := range []struct{ table, name, definition string }{
		{"inventories", "inventory_date", "TEXT NOT NULL DEFAULT ''"},
		{"inventories", "commission_managers", "TEXT NOT NULL DEFAULT '[]'"},
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

	if err := i.initInventoryCells(); err != nil { return err }
	return i.initInventoryReports()
}

type Inventory struct {
	ByCells             bool       `json:"byCells"`
	ID                  int        `json:"id"`
	Status              string     `json:"status"`
	CreatedAt           string     `json:"createdAt"`
	CompletedAt         string     `json:"completedAt"`
	Date                string     `json:"date"`
	CommissionManagers  []Employee `json:"commissionManagers"`
	Commission          string     `json:"commission"`
	Kind                string     `json:"kind"`
	IsApprovedByMe      bool       `json:"isApprovedByMe"`
	WaitForOtherApprove bool       `json:"waitForOtherApprove"`
	ApprovedManagerIDs  []int      `json:"approvedManagerIds"`
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

func (i *InventoryService) CreateInventory(userID int, role string) (Inventory, error) {
	if role != "Кладовщик" {
		return Inventory{}, errors.New("только кладовщик может создавать инвентаризацию")
	}
	res, err := i.db.Exec(`INSERT INTO inventories (status) VALUES ('draft')`)
	if err != nil {
		return Inventory{}, fmt.Errorf("create inventory: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Inventory{}, fmt.Errorf("get inventory id: %w", err)
	}
	return readInventory(i.db, int(id), userID)
}

const inventoryColumns = "id,status,created_at,COALESCE(completed_at,''),inventory_date,commission_managers,commission,kind,by_cells"

func scanInventory(row interface{ Scan(...any) error }) (Inventory, error) {
	var inv Inventory
	var managers []byte
	if err := row.Scan(&inv.ID, &inv.Status, &inv.CreatedAt, &inv.CompletedAt, &inv.Date, &managers, &inv.Commission, &inv.Kind, &inv.ByCells); err != nil {
		return Inventory{}, err
	}
	if err := json.Unmarshal(managers, &inv.CommissionManagers); err != nil {
		return Inventory{}, fmt.Errorf("чтение комиссии: %w", err)
	}
	return inv, nil
}

func populateApprovals(db databaseReader, inv *Inventory, userID int) {
	inv.WaitForOtherApprove = false
	inv.IsApprovedByMe = false
	if inv.Status == "pending" || inv.Status == "completed" {
		rows, err := db.Query("SELECT manager_id FROM inventory_approvals WHERE inventory_id=?", inv.ID)
		if err == nil {
			inv.ApprovedManagerIDs = make([]int, 0)
			for rows.Next() {
				var mid int
				rows.Scan(&mid)
				inv.ApprovedManagerIDs = append(inv.ApprovedManagerIDs, mid)
				if mid == userID { inv.IsApprovedByMe = true }
			}
			rows.Close()
		}
		if inv.IsApprovedByMe && len(inv.ApprovedManagerIDs) < len(inv.CommissionManagers) && inv.Status == "pending" {
			inv.WaitForOtherApprove = true
		}
	}
}

func readInventory(db databaseReader, id int, userID int) (Inventory, error) {
	inv, err := scanInventory(db.QueryRow("SELECT "+inventoryColumns+" FROM inventories WHERE id = ?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return inv, errors.New("inventory not found")
	}
	if err != nil {
		return inv, fmt.Errorf("get inventory: %w", err)
	}
	populateApprovals(db, &inv, userID)
	return inv, nil
}

func (i *InventoryService) SubmitForReview(inventoryID int, userID int, role string) error {
	if role != "Кладовщик" {
		return errors.New("только кладовщик может отправить на проверку")
	}
	tx, err := i.db.Begin()
	if err != nil { return err }
	defer tx.Rollback()

	var status string
	if err := tx.QueryRow("SELECT status FROM inventories WHERE id=?", inventoryID).Scan(&status); err != nil {
		return err
	}
	if status != "draft" {
		return errors.New("инвентаризация не в статусе черновика")
	}

	if _, err := tx.Exec("UPDATE inventories SET status='pending' WHERE id=?", inventoryID); err != nil {
		return err
	}
	if _, err := saveInventoryReport(tx, inventoryID); err != nil {
		return err
	}
	return tx.Commit()
}

func (i *InventoryService) ApproveInventory(inventoryID int, managerID int, role string) error {
	if role != "Менеджер" {
		return errors.New("только менеджер может подтверждать")
	}
	tx, err := i.db.Begin()
	if err != nil { return err }
	defer tx.Rollback()

	var commissionData []byte
	var status string
	if err := tx.QueryRow("SELECT status, commission_managers FROM inventories WHERE id=?", inventoryID).Scan(&status, &commissionData); err != nil {
		return err
	}
	if status != "pending" {
		return errors.New("инвентаризация не ожидает подтверждения")
	}

	var managers []Employee
	if err := json.Unmarshal(commissionData, &managers); err != nil { return err }

	var isMember bool
	for _, m := range managers {
		if m.ID == managerID { isMember = true; break }
	}
	if !isMember {
		return errors.New("вы не являетесь членом комиссии этой инвентаризации")
	}

	if _, err := tx.Exec("INSERT INTO inventory_approvals(inventory_id, manager_id) VALUES(?,?) ON CONFLICT DO NOTHING", inventoryID, managerID); err != nil {
		return err
	}

	var approvedCount int
	if err := tx.QueryRow("SELECT COUNT(*) FROM inventory_approvals WHERE inventory_id=?", inventoryID).Scan(&approvedCount); err != nil {
		return err
	}

	if approvedCount >= len(managers) {
		if err := applyInventory(tx, inventoryID); err != nil {
			return err
		}
		if _, err := tx.Exec("UPDATE inventories SET status='completed', completed_at=datetime('now') WHERE id=?", inventoryID); err != nil {
			return err
		}
		if _, err := saveInventoryReport(tx, inventoryID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func applyInventory(tx *sql.Tx, inventoryID int) error {
	var byCells bool
	if err := tx.QueryRow("SELECT by_cells FROM inventories WHERE id=?", inventoryID).Scan(&byCells); err != nil {
		return err
	}
	if byCells {
		if err := applyInventoryCells(tx, inventoryID); err != nil { return err }
	} else {
		if err := applyLegacyInventoryStock(tx, inventoryID); err != nil { return err }
		_, err := tx.Exec(`
		UPDATE products
		SET count = (
			SELECT ii.actual_count FROM inventory_items ii
			WHERE ii.inventory_id = ? AND ii.product_id = products.id
		)
		WHERE id IN (SELECT product_id FROM inventory_items WHERE inventory_id = ?)
	`, inventoryID, inventoryID)
		if err != nil { return fmt.Errorf("update product counts: %w", err) }
	}
	return nil
}

func (i *InventoryService) GetInventories(userID int, role string) ([]Inventory, error) {
	var query string
	args := []any{}
	if role == "Менеджер" {
		query = "SELECT " + inventoryColumns + " FROM inventories WHERE EXISTS (SELECT 1 FROM json_each(commission_managers) WHERE json_extract(value, '$.id') = ?) ORDER BY id DESC"
		args = append(args, userID)
	} else {
		query = "SELECT " + inventoryColumns + " FROM inventories ORDER BY id DESC"
	}

	rows, err := i.db.Query(query, args...)
	if err != nil { return nil, err }
	
	inventories := []Inventory{}
	for rows.Next() {
		inv, err := scanInventory(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		inventories = append(inventories, inv)
	}
	err = rows.Err()
	rows.Close()
	
	if err != nil { return nil, err }

	for idx := range inventories {
		populateApprovals(i.db, &inventories[idx], userID)
	}

	return inventories, nil
}

func (i *InventoryService) GetInventory(inventoryID int, userID int) (InventoryDetails, error) {
	return readInventoryDetails(i.db, inventoryID, userID)
}

func readInventoryDetails(db databaseReader, inventoryID int, userID int) (InventoryDetails, error) {
	inv, err := readInventory(db, inventoryID, userID)
	if err != nil { return InventoryDetails{}, err }

	rows, err := db.Query(`
		SELECT ii.product_id, p.name, ii.system_count, ii.actual_count, ii.comment, p.article, p.storage_location,
			COALESCE(ii.stock_id,0),COALESCE(ii.x,0),COALESCE(ii.y,0)
		FROM inventory_items ii
		JOIN products p ON p.id = ii.product_id
		WHERE ii.inventory_id = ?
		ORDER BY p.name,ii.y,ii.x
	`, inventoryID)
	if err != nil { return InventoryDetails{}, fmt.Errorf("get inventory items: %w", err) }
	defer rows.Close()

	details := InventoryDetails{
		Inventory: inv,
		Items:     make([]InventoryItem, 0),
	}

	for rows.Next() {
		var item InventoryItem
		var actual sql.NullInt64
		err := rows.Scan(&item.ProductID, &item.ProductName, &item.SystemCount, &actual, &item.Comment, &item.Article, &item.StorageLocation, &item.StockID, &item.X, &item.Y)
		if err != nil { return InventoryDetails{}, fmt.Errorf("scan inventory item: %w", err) }
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
	return details, rows.Err()
}

type InventoryCount struct {
	StockID     int    `json:"stockId,omitempty"`
	ProductID   int    `json:"productId"`
	ActualCount *int   `json:"actualCount"`
	Comment     string `json:"comment"`
}

func (i *InventoryService) SaveInventoryCounts(id int, counts []InventoryCount, userID int, role string) (InventoryDetails, error) {
	tx, err := i.db.Begin()
	if err != nil { return InventoryDetails{}, err }
	defer tx.Rollback()

	var status string
	if err := tx.QueryRow("SELECT status FROM inventories WHERE id=?", id).Scan(&status); err != nil {
		return InventoryDetails{}, err
	}

	if (role == "Кладовщик" && status != "draft") || (role == "Менеджер" && status != "pending") {
		return InventoryDetails{}, errors.New("у вас нет прав на редактирование этой инвентаризации в текущем статусе")
	}

	for _, item := range counts {
		if item.ActualCount != nil && (*item.ActualCount < 0 || int64(*item.ActualCount) > maxSafeCount) {
			return InventoryDetails{}, errors.New("фактическое количество должно быть целым числом от 0 до 9007199254740991")
		}
		result, err := tx.Exec(`UPDATE inventory_items SET actual_count=?,comment=? WHERE inventory_id=? AND product_id=?
			AND ((stock_id IS NULL AND ?=0) OR stock_id=?)`, item.ActualCount, strings.TrimSpace(item.Comment), id, item.ProductID, item.StockID, item.StockID)
		if err != nil { return InventoryDetails{}, err }
		changed, err := result.RowsAffected()
		if err != nil { return InventoryDetails{}, err }
		if changed == 0 { return InventoryDetails{}, errors.New("позиция не найдена") }
	}
	if err := tx.Commit(); err != nil { return InventoryDetails{}, err }
	return i.GetInventory(id, userID)
}

type InventoryParameters struct {
	ByCells        bool   `json:"byCells"`
	StockIDs       []int  `json:"stockIds"`
	Date           string `json:"date"`
	CommissionIDs  []int  `json:"commissionIds"` 
	Kind           string `json:"kind"`
	ProductIDs     []int  `json:"productIds"`
}

func (i *InventoryService) PrepareInventory(id int, request InventoryParameters, userID int) (InventoryDetails, error) {
	if len(request.CommissionIDs) == 0 {
		return InventoryDetails{}, errors.New("выберите хотя бы одного члена комиссии")
	}
	if _, err := parseOrderDate(request.Date); err != nil { return InventoryDetails{}, err }
	if request.Kind != "partial" && request.Kind != "full" {
		return InventoryDetails{}, errors.New("выберите тип инвентаризации")
	}
	if request.ByCells { return i.prepareInventoryCells(id, request, userID) }
	if request.Kind == "partial" && len(request.ProductIDs) == 0 {
		return InventoryDetails{}, errors.New("выберите товары для проверки")
	}

	tx, err := i.db.Begin()
	if err != nil { return InventoryDetails{}, err }
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

	oldItems := make(map[int]struct {
		Actual  sql.NullInt64
		Comment string
	})
	rows, err := tx.Query("SELECT product_id, actual_count, comment FROM inventory_items WHERE inventory_id=?", id)
	if err != nil { return InventoryDetails{}, err }
	for rows.Next() {
		var pid int
		var act sql.NullInt64
		var com string
		if err := rows.Scan(&pid, &act, &com); err == nil {
			oldItems[pid] = struct { Actual sql.NullInt64; Comment string }{act, com}
		}
	}
	rows.Close()

	if _, err := tx.Exec("DELETE FROM inventory_items WHERE inventory_id=?", id); err != nil {
		return InventoryDetails{}, err
	}

	if request.Kind == "full" {
		prodRows, err := tx.Query("SELECT id, count FROM products")
		if err != nil { return InventoryDetails{}, err }
		type prodData struct{ id, count int }
		var prods []prodData
		for prodRows.Next() {
			var p prodData
			prodRows.Scan(&p.id, &p.count)
			prods = append(prods, p)
		}
		prodRows.Close() 

		for _, p := range prods {
			var act interface{} = nil
			var com string = ""
			if old, exists := oldItems[p.id]; exists {
				if old.Actual.Valid { act = old.Actual.Int64 }
				com = old.Comment
			}
			_, err = tx.Exec("INSERT INTO inventory_items(inventory_id, product_id, system_count, actual_count, comment) VALUES(?,?,?,?,?)", id, p.id, p.count, act, com)
			if err != nil { return InventoryDetails{}, err }
		}
	} else {
		for _, pid := range request.ProductIDs {
			var sysCount int
			err := tx.QueryRow("SELECT count FROM products WHERE id=?", pid).Scan(&sysCount)
			if err != nil { return InventoryDetails{}, fmt.Errorf("товар %d не найден", pid) }
			var act interface{} = nil
			var com string = ""
			if old, exists := oldItems[pid]; exists {
				if old.Actual.Valid { act = old.Actual.Int64 }
				com = old.Comment
			}
			if _, err := tx.Exec("INSERT INTO inventory_items(inventory_id, product_id, system_count, actual_count, comment) VALUES(?,?,?,?,?)", id, pid, sysCount, act, com); err != nil {
				return InventoryDetails{}, err
			}
		}
	}

	if err := saveInventoryParameters(tx, id, request); err != nil { return InventoryDetails{}, err }
	if err := tx.Commit(); err != nil { return InventoryDetails{}, err }
	return i.GetInventory(id, userID)
}

func saveInventoryParameters(tx *sql.Tx, id int, request InventoryParameters) error {
	managers, err := resolveManagers(tx, request.CommissionIDs)
	if err != nil { return err }
	document, err := json.Marshal(managers)
	if err != nil { return err }
	_, err = tx.Exec(`UPDATE inventories SET inventory_date=?,commission_managers=?,commission=?,kind=?,by_cells=? WHERE id=?`,
		request.Date, string(document), managerNames(managers), request.Kind, request.ByCells, id)
	return err
}

func (i *InventoryService) GetInventoryEmployees() ([]Employee, error) {
	return getManagers(i.db)
}

func (i *InventoryService) GetDraftInventory(userID int) (*InventoryDetails, error) {
	var id int
	err := i.db.QueryRow(`SELECT id FROM inventories WHERE status = 'draft' ORDER BY id DESC LIMIT 1`).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) { return nil, nil }
	if err != nil { return nil, fmt.Errorf("get draft inventory: %w", err) }
	details, err := i.GetInventory(id, userID)
	if err != nil { return nil, err }
	return &details, nil
}