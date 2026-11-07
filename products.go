package main

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

type Product struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}

func (s *DBService) GetAllProducts() ([]Product, error) {
	rows, err := s.db.Query("SELECT id, name, count FROM products ORDER BY id")
	if err != nil {
		return nil, fmt.Errorf("получение каталога: %w", err)
	}
	defer rows.Close()
	products := []Product{}
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.Name, &p.Count); err != nil {
			return nil, fmt.Errorf("чтение товара: %w", err)
		}
		products = append(products, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("чтение каталога: %w", err)
	}
	return products, nil
}

func (s *DBService) SearchProducts(query string) ([]Product, error) {
	products, err := s.GetAllProducts()
	if err != nil {
		return nil, err
	}
	query = strings.ToLower(strings.TrimSpace(query))
	found := []Product{}
	for _, p := range products {
		if strings.Contains(strings.ToLower(p.Name), query) {
			found = append(found, p)
		}
	}
	return found, nil
}

type ProductPage struct {
	Products []Product `json:"products"`
	HasMore  bool      `json:"hasMore"`
}

func (s *DBService) SearchProductsPage(query string, afterID int) (ProductPage, error) {
	page := ProductPage{Products: []Product{}}
	if afterID < 0 {
		return page, errors.New("идентификатор последнего товара не может быть отрицательным")
	}
	rows, err := s.db.Query("SELECT id, name, count FROM products WHERE id > ? ORDER BY id", afterID)
	if err != nil {
		return page, fmt.Errorf("поиск товаров: %w", err)
	}
	defer rows.Close()
	query = strings.ToLower(strings.TrimSpace(query))
	for rows.Next() {
		var product Product
		if err := rows.Scan(&product.ID, &product.Name, &product.Count); err != nil {
			return page, fmt.Errorf("чтение товара: %w", err)
		}
		if !strings.Contains(strings.ToLower(product.Name), query) {
			continue
		}
		if len(page.Products) == 10 {
			page.HasMore = true
			break
		}
		page.Products = append(page.Products, product)
	}
	if err := rows.Err(); err != nil {
		return page, fmt.Errorf("чтение товаров: %w", err)
	}
	return page, nil
}

func (s *DBService) GetProduct(id int) (Product, error) {
	var p Product
	err := s.db.QueryRow("SELECT id, name, count FROM products WHERE id = ?", id).Scan(&p.ID, &p.Name, &p.Count)
	if errors.Is(err, sql.ErrNoRows) {
		return p, errors.New("товар не найден")
	}
	if err != nil {
		return p, fmt.Errorf("получение товара: %w", err)
	}
	return p, nil
}

func (s *DBService) AddProduct(p Product) (Product, error) {
	return Product{}, errors.New("добавление товаров в фиксированный каталог запрещено")
}

func (s *DBService) DeleteProduct(id int) error {
	return errors.New("удаление товаров из фиксированного каталога запрещено")
}
