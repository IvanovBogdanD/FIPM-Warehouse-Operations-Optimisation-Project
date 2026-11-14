package main

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

const warehouseSize = 8
const warehouseTimeLayout = "2006-01-02T15:04:05.000000000Z"

type WarehouseStock struct {
	ID              int    `json:"id"`
	ProductID       int    `json:"productId"`
	Name            string `json:"name"`
	Article         string `json:"article"`
	SKU             string `json:"sku"`
	Count           int    `json:"count"`
	X               int    `json:"x"`
	Y               int    `json:"y"`
	ReceivedAt      string `json:"receivedAt"`
	StorageLocation string `json:"storageLocation"`
}

type WarehousePage struct {
	Products []WarehouseStock `json:"products"`
	HasMore  bool             `json:"hasMore"`
}

func warehouseLocation(x, y int) string {
	return fmt.Sprintf("X%d Y%d", x, y)
}

func validateWarehouseCell(x, y int) error {
	if x < 1 || x > warehouseSize || y < 1 || y > warehouseSize {
		return errors.New("координаты ячейки должны быть от 1 до 8")
	}
	return nil
}

func (s *DBService) InitWarehouse() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists int
	if err := tx.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='warehouse_stock'").Scan(&exists); err != nil {
		return err
	}
	if exists != 0 {
		return tx.Commit()
	}
	if _, err := tx.Exec(`CREATE TABLE warehouse_stock (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_id INTEGER NOT NULL REFERENCES products(id),
		x INTEGER NOT NULL CHECK(x BETWEEN 1 AND 8),
		y INTEGER NOT NULL CHECK(y BETWEEN 1 AND 8),
		quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity > 0),
		received_at TEXT NOT NULL,
		UNIQUE(x,y,product_id)
	)`); err != nil {
		return err
	}
	rows, err := tx.Query("SELECT id,count,received_on FROM products WHERE count > 0 ORDER BY id")
	if err != nil {
		return err
	}
	type initialStock struct {
		id, count int
		date      string
	}
	initial := []initialStock{}
	for rows.Next() {
		var stock initialStock
		if err := rows.Scan(&stock.id, &stock.count, &stock.date); err != nil {
			rows.Close()
			return err
		}
		initial = append(initial, stock)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(initial) > warehouseSize*warehouseSize {
		return errors.New("для начального размещения товаров нужно больше 64 ячеек")
	}
	for index, stock := range initial {
		date := ""
		if stock.date != "" {
			date = stock.date + "T00:00:00.000000000Z"
		}
		if _, err := tx.Exec("INSERT INTO warehouse_stock(product_id,x,y,quantity,received_at) VALUES(?,?,?,?,?)",
			stock.id, index%warehouseSize+1, index/warehouseSize+1, stock.count, date); err != nil {
			return err
		}
	}
	return tx.Commit()
}

const warehouseSelect = `SELECT ws.id,ws.product_id,p.name,p.article,p.sku,ws.quantity,ws.x,ws.y,ws.received_at
	FROM warehouse_stock ws JOIN products p ON p.id=ws.product_id`

func readWarehouseStock(rows *sql.Rows) ([]WarehouseStock, error) {
	defer rows.Close()
	stocks := []WarehouseStock{}
	for rows.Next() {
		var stock WarehouseStock
		if err := rows.Scan(&stock.ID, &stock.ProductID, &stock.Name, &stock.Article, &stock.SKU, &stock.Count, &stock.X, &stock.Y, &stock.ReceivedAt); err != nil {
			return nil, err
		}
		stock.StorageLocation = warehouseLocation(stock.X, stock.Y)
		stocks = append(stocks, stock)
	}
	return stocks, rows.Err()
}

func (s *DBService) GetWarehouseStocks() ([]WarehouseStock, error) {
	rows, err := s.db.Query(warehouseSelect + " ORDER BY ws.y,ws.x,ws.product_id")
	if err != nil {
		return nil, err
	}
	return readWarehouseStock(rows)
}

func (s *DBService) GetProductLocations(productID int) ([]WarehouseStock, error) {
	rows, err := s.db.Query(warehouseSelect+" WHERE ws.product_id=? ORDER BY ws.y,ws.x", productID)
	if err != nil {
		return nil, err
	}
	return readWarehouseStock(rows)
}

func (s *DBService) SearchWarehouseStocksPage(query string, afterID int) (WarehousePage, error) {
	if afterID < 0 {
		return WarehousePage{}, errors.New("идентификатор позиции не может быть отрицательным")
	}
	rows, err := s.db.Query(warehouseSelect+" WHERE ws.id > ? ORDER BY ws.id", afterID)
	if err != nil {
		return WarehousePage{}, err
	}
	stocks, err := readWarehouseStock(rows)
	if err != nil {
		return WarehousePage{}, err
	}
	query = strings.ToLower(strings.TrimSpace(query))
	page := WarehousePage{Products: []WarehouseStock{}}
	for _, stock := range stocks {
		if !strings.Contains(strings.ToLower(stock.Name), query) && !strings.Contains(strings.ToLower(stock.Article), query) &&
			!strings.Contains(strings.ToLower(stock.SKU), query) && !strings.Contains(strings.ToLower(stock.StorageLocation), query) {
			continue
		}
		if len(page.Products) == 10 {
			page.HasMore = true
			break
		}
		page.Products = append(page.Products, stock)
	}
	return page, nil
}

func freeWarehouseCell(tx *sql.Tx) (int, int, error) {
	rows, err := tx.Query("SELECT DISTINCT x,y FROM warehouse_stock")
	if err != nil {
		return 0, 0, err
	}
	occupied := [warehouseSize][warehouseSize]bool{}
	for rows.Next() {
		var x, y int
		if err := rows.Scan(&x, &y); err != nil {
			rows.Close()
			return 0, 0, err
		}
		occupied[y-1][x-1] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, 0, err
	}
	for y := 1; y <= warehouseSize; y++ {
		for x := 1; x <= warehouseSize; x++ {
			if !occupied[y-1][x-1] {
				return x, y, nil
			}
		}
	}
	return 0, 0, errors.New("все 64 ячейки заняты, освободите место перед приёмкой")
}

func requireEmptyWarehouseCell(tx *sql.Tx, x, y int) error {
	if err := validateWarehouseCell(x, y); err != nil {
		return err
	}
	var count int
	if err := tx.QueryRow("SELECT count(*) FROM warehouse_stock WHERE x=? AND y=?", x, y).Scan(&count); err != nil {
		return err
	}
	if count != 0 {
		return fmt.Errorf("ячейка %s уже занята, выберите другую", warehouseLocation(x, y))
	}
	return nil
}

func consumeWarehouseStock(tx *sql.Tx, productID int, quantity int64) error {
	var rotation string
	if err := tx.QueryRow("SELECT rotation FROM products WHERE id=?", productID).Scan(&rotation); err != nil {
		return err
	}
	direction := "ASC"
	if rotation == "LIFO" {
		direction = "DESC"
	} else if rotation != "FIFO" && rotation != "" {
		return errors.New("для товара указан неизвестный порядок FIFO/LIFO")
	}
	rows, err := tx.Query("SELECT id,quantity FROM warehouse_stock WHERE product_id=? ORDER BY received_at "+direction+",id "+direction, productID)
	if err != nil {
		return err
	}
	type amount struct{ id, quantity int64 }
	stocks := []amount{}
	for rows.Next() {
		var stock amount
		if err := rows.Scan(&stock.id, &stock.quantity); err != nil {
			rows.Close()
			return err
		}
		stocks = append(stocks, stock)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, stock := range stocks {
		taken := min(quantity, stock.quantity)
		if taken == stock.quantity {
			_, err = tx.Exec("DELETE FROM warehouse_stock WHERE id=?", stock.id)
		} else {
			_, err = tx.Exec("UPDATE warehouse_stock SET quantity=quantity-? WHERE id=?", taken, stock.id)
		}
		if err != nil {
			return err
		}
		quantity -= taken
		if quantity == 0 {
			return nil
		}
	}
	return errors.New("остаток товара по ячейкам недостаточен, списание отменено")
}

func syncWarehouseProduct(tx *sql.Tx, productID int) error {
	var count int64
	if err := tx.QueryRow("SELECT COALESCE(sum(quantity),0) FROM warehouse_stock WHERE product_id=?", productID).Scan(&count); err != nil {
		return err
	}
	if count > maxSafeCount {
		return errors.New("общий остаток товара превышает допустимый предел")
	}
	_, err := tx.Exec("UPDATE products SET count=? WHERE id=?", count, productID)
	return err
}

func setLegacyWarehouseCount(tx *sql.Tx, productID, actual int) error {
	var total int
	if err := tx.QueryRow("SELECT COALESCE(sum(quantity),0) FROM warehouse_stock WHERE product_id=?", productID).Scan(&total); err != nil {
		return err
	}
	if actual < total {
		return consumeWarehouseStock(tx, productID, int64(total-actual))
	}
	if actual == total {
		return nil
	}
	var id int
	err := tx.QueryRow("SELECT id FROM warehouse_stock WHERE product_id=? ORDER BY received_at,id LIMIT 1", productID).Scan(&id)
	if err == nil {
		_, err = tx.Exec("UPDATE warehouse_stock SET quantity=quantity+? WHERE id=?", actual-total, id)
		return err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	x, y, err := freeWarehouseCell(tx)
	if err != nil {
		return err
	}
	_, err = tx.Exec("INSERT INTO warehouse_stock(product_id,x,y,quantity,received_at) VALUES(?,?,?,?,?)", productID, x, y, actual, time.Now().UTC().Format(warehouseTimeLayout))
	return err
}
