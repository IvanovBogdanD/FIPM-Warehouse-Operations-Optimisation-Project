package main

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

type Product struct {
	ID              int     `json:"id"`
	Name            string  `json:"name"`
	Count           int     `json:"count"`
	Article         string  `json:"article"`
	SKU             string  `json:"sku"`
	Supplier        string  `json:"supplier"`
	Manufacturer    string  `json:"manufacturer"`
	Warehouse       string  `json:"warehouse"`
	StorageLocation string  `json:"storageLocation"`
	ReceivedOn      string  `json:"receivedOn"`
	ExpiresOn       string  `json:"expiresOn"`
	Rotation        string  `json:"rotation"`
	LengthMm        int     `json:"lengthMm"`
	WidthMm         int     `json:"widthMm"`
	HeightMm        int     `json:"heightMm"`
	WeightKg        float64 `json:"weightKg"`
	LiquidVolumeL   float64 `json:"liquidVolumeL"`
	PackageVolumeL  float64 `json:"packageVolumeL"`
	UnitsPerPackage int     `json:"unitsPerPackage"`
	DemoData        bool    `json:"demoData"`
}

const productColumns = "id, name, count, article, sku, supplier, manufacturer, warehouse, " +
	"storage_location, received_on, expires_on, rotation, length_mm, width_mm, height_mm, " +
	"weight_kg, liquid_volume_l, package_volume_l, units_per_package, demo_data"

func scanProduct(row interface{ Scan(...any) error }) (Product, error) {
	var p Product
	err := row.Scan(
		&p.ID, &p.Name, &p.Count, &p.Article, &p.SKU,
		&p.Supplier, &p.Manufacturer, &p.Warehouse, &p.StorageLocation,
		&p.ReceivedOn, &p.ExpiresOn, &p.Rotation,
		&p.LengthMm, &p.WidthMm, &p.HeightMm, &p.WeightKg,
		&p.LiquidVolumeL, &p.PackageVolumeL, &p.UnitsPerPackage, &p.DemoData,
	)
	return p, err
}

func matchesProduct(p Product, query string) bool {
	return strings.Contains(strings.ToLower(p.Name), query) || strings.Contains(strings.ToLower(p.Article), query) || strings.Contains(strings.ToLower(p.SKU), query)
}

func (s *DBService) GetAllProducts() ([]Product, error) {
	rows, err := s.db.Query("SELECT " + productColumns + " FROM products ORDER BY id")
	if err != nil {
		return nil, fmt.Errorf("получение каталога: %w", err)
	}
	defer rows.Close()
	products := []Product{}
	for rows.Next() {
		p, err := scanProduct(rows)
		if err != nil {
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
		if matchesProduct(p, query) {
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
	rows, err := s.db.Query("SELECT "+productColumns+" FROM products WHERE id > ? ORDER BY id", afterID)
	if err != nil {
		return page, fmt.Errorf("поиск товаров: %w", err)
	}
	defer rows.Close()
	query = strings.ToLower(strings.TrimSpace(query))
	for rows.Next() {
		product, err := scanProduct(rows)
		if err != nil {
			return page, fmt.Errorf("чтение товара: %w", err)
		}
		if !matchesProduct(product, query) {
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
	p, err := scanProduct(s.db.QueryRow("SELECT "+productColumns+" FROM products WHERE id = ?", id))
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
