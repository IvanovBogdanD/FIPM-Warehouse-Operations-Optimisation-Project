package main

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

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

// Close — закрыть соединение (вызывается при выходе из приложения)
func (s *DBService) Close() {
	if s.db != nil {
		s.db.Close()
	}
}

// ИЗМЕНЕНО: методы GetAllProducts, AddProduct, DeleteProduct перенесены
// в файл products.go (имена и получатель *DBService не изменены).
// Сделано, чтобы файл db.go остался только про подключение к БД.
// Product и DBService оставлены здесь, чтобы не ломать существующий код
// и не менять сигнатуры.
