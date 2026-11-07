package main

import (
	"database/sql"
	"errors"
	"fmt"
)

type InventoryService struct {
	db *sql.DB
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

	return nil
}

type Inventory struct {
	ID          int    `json:"id"`
	Status      string `json:"status"`
	CreatedAt   string `json:"createdAt"`
	CompletedAt string `json:"completedAt"`
}

type InventoryItem struct {
	ProductID   int    `json:"productId"`
	ProductName string `json:"productName"`
	SystemCount int    `json:"systemCount"`
	ActualCount *int   `json:"actualCount"`
	Difference  *int   `json:"difference"`
}

type InventoryDetails struct {
	Inventory
	Items []InventoryItem `json:"items"`
}

func (i *InventoryService) CreateInventory() (Inventory, error) {
	res, err := i.db.Exec(`INSERT INTO inventories (status) VALUES ('draft')`)
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
		SELECT id, status, created_at, COALESCE(completed_at, '')
		FROM inventories
		WHERE id = ?
	`, id).Scan(&inv.ID, &inv.Status, &inv.CreatedAt, &inv.CompletedAt)

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
	err = tx.QueryRow(`SELECT status FROM inventories WHERE id = ?`, inventoryID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("inventory not found")
	}
	if err != nil {
		return fmt.Errorf("get inventory status: %w", err)
	}
	if status != "draft" {
		return errors.New("inventory is not draft")
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
			ON CONFLICT(inventory_id, product_id) DO NOTHING
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
		SELECT ii.product_id, p.name, ii.system_count, ii.actual_count
		FROM inventory_items ii
		JOIN products p ON p.id = ii.product_id
		WHERE ii.inventory_id = ?
		ORDER BY p.name
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

		err := rows.Scan(&item.ProductID, &item.ProductName, &item.SystemCount, &actual)
		if err != nil {
			return InventoryDetails{}, fmt.Errorf("scan inventory item: %w", err)
		}

		if actual.Valid {
			value := int(actual.Int64)
			diff := value - item.SystemCount
			item.ActualCount = &value
			item.Difference = &diff
		}

		details.Items = append(details.Items, item)
	}

	if err := rows.Err(); err != nil {
		return InventoryDetails{}, fmt.Errorf("iterate inventory items: %w", err)
	}

	return details, nil
}

func (i *InventoryService) SetActualCount(inventoryID int, productID int, actualCount int) error {
	if actualCount < 0 {
		return errors.New("actual count must be non-negative")
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

func (i *InventoryService) ApplyInventory(inventoryID int) error {
	tx, err := i.db.Begin()
	if err != nil {
		return fmt.Errorf("begin apply inventory: %w", err)
	}
	defer tx.Rollback()

	var status string
	err = tx.QueryRow(`SELECT status FROM inventories WHERE id = ?`, inventoryID).Scan(&status)
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
