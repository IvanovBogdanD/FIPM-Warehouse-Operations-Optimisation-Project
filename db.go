package main

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

type DBService struct {
	db *sql.DB
}

func NewDBService() (*DBService, error) {
	db, err := sql.Open("sqlite", "file:store.db?mode=rw")
	if err != nil {
		return nil, fmt.Errorf("открытие БД: %w", err)
	}
	db.SetMaxOpenConns(1)
	return &DBService{db: db}, nil
}

func (s *DBService) Close() {
	if s.db != nil {
		s.db.Close()
	}
}
