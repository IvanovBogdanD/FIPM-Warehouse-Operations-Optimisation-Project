package main

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// Product — структура товара. Поля в json-тегах будут видны в JS.
type Product struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// DBService — сервис для работы с базой. Его методы станут доступны из JS.
type DBService struct { //указатель через который посылаются команды базе данных
	db *sql.DB
}

// NewDBService — создаёт подключение и таблицу
func NewDBService() (*DBService, error) {
	db, err := sql.Open("sqlite", "store.db") //store.db- файл где описана структура бд, db- пульт,через него посылают команды
	// sql.Open готовит «пульт» db — менеджер для работы с базой.
    // Он ещё ничего не открывает и не создаёт.
    // Файл store.db будет создан при первом запросе (CREATE TABLE ниже).
	if err != nil {
		return nil, fmt.Errorf("открытие БД: %w", err)
	}
//создаем структуру бд
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS products (
			id      INTEGER PRIMARY KEY AUTOINCREMENT,
			name   TEXT,
			count   INTEGER
		)
	`)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("создание таблицы: %w", err)
	}

	return &DBService{db: db}, nil
}

// ---- Методы, доступные из JS ----

// GetAllProducts — вернуть все товары
func (s *DBService) GetAllProducts() ([]Product, error) {
	rows, err := s.db.Query("SELECT id, name, count FROM products")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	products := []Product{}
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.Name, &p.Count); err != nil {
			return nil, err
		}
		products = append(products, p)
	}
	return products, nil
}

// AddProduct — добавить новый товар
func (s *DBService) AddProduct(p Product) (Product, error) {
	res, err := s.db.Exec(
    "INSERT INTO products (name, count) VALUES (?, ?)",
    p.Name, p.Count,
	)
	if err != nil {
		return Product{}, err
	}
	id, _ := res.LastInsertId()
	p.ID = int(id)
	return p, nil
}

// DeleteProduct — удалить товар по id
func (s *DBService) DeleteProduct(id int) error {
	_, err := s.db.Exec("DELETE FROM products WHERE id = ?", id)
	return err
}

// Close — закрыть соединение (вызывается при выходе из приложения)
func (s *DBService) Close() {
	if s.db != nil {
		s.db.Close()
	}
}
