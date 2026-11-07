package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed data/products.json
var demoProductsJSON []byte

func (s *DBService) InitProducts() error {
	var products []Product
	if err := json.Unmarshal(demoProductsJSON, &products); err != nil {
		return fmt.Errorf("чтение характеристик товаров: %w", err)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, column := range []struct{ name, definition string }{
		{"article", "TEXT NOT NULL DEFAULT ''"},
		{"sku", "TEXT NOT NULL DEFAULT ''"},
		{"supplier", "TEXT NOT NULL DEFAULT ''"},
		{"manufacturer", "TEXT NOT NULL DEFAULT ''"},
		{"warehouse", "TEXT NOT NULL DEFAULT ''"},
		{"storage_location", "TEXT NOT NULL DEFAULT ''"},
		{"received_on", "TEXT NOT NULL DEFAULT ''"},
		{"expires_on", "TEXT NOT NULL DEFAULT ''"},
		{"rotation", "TEXT NOT NULL DEFAULT ''"},
		{"length_mm", "INTEGER NOT NULL DEFAULT 0 CHECK(length_mm >= 0)"},
		{"width_mm", "INTEGER NOT NULL DEFAULT 0 CHECK(width_mm >= 0)"},
		{"height_mm", "INTEGER NOT NULL DEFAULT 0 CHECK(height_mm >= 0)"},
		{"weight_kg", "REAL NOT NULL DEFAULT 0 CHECK(weight_kg >= 0)"},
		{"liquid_volume_l", "REAL NOT NULL DEFAULT 0 CHECK(liquid_volume_l >= 0)"},
		{"package_volume_l", "REAL NOT NULL DEFAULT 0 CHECK(package_volume_l >= 0)"},
		{"units_per_package", "INTEGER NOT NULL DEFAULT 0 CHECK(units_per_package >= 0)"},
		{"demo_data", "INTEGER NOT NULL DEFAULT 0 CHECK(demo_data IN (0,1))"},
	} {
		var count int
		if err := tx.QueryRow("SELECT COUNT(*) FROM pragma_table_info('products') WHERE name = ?", column.name).Scan(&count); err != nil {
			return err
		}
		if count == 0 {
			if _, err := tx.Exec("ALTER TABLE products ADD COLUMN " + column.name + " " + column.definition); err != nil {
				return fmt.Errorf("добавление поля товара %s: %w", column.name, err)
			}
		}
	}
	for _, p := range products {
		if _, err := tx.Exec(`UPDATE products SET
            article = ?, sku = ?, supplier = ?, manufacturer = ?, warehouse = ?, storage_location = ?,
            received_on = ?, expires_on = ?, rotation = ?, length_mm = ?, width_mm = ?, height_mm = ?,
            weight_kg = ?, liquid_volume_l = ?, package_volume_l = ?, units_per_package = ?, demo_data = ?
            WHERE id = ? AND name = ? AND article = ''`,
			p.Article, p.SKU, p.Supplier, p.Manufacturer, p.Warehouse, p.StorageLocation,
			p.ReceivedOn, p.ExpiresOn, p.Rotation, p.LengthMm, p.WidthMm, p.HeightMm,
			p.WeightKg, p.LiquidVolumeL, p.PackageVolumeL, p.UnitsPerPackage, p.DemoData, p.ID, p.Name); err != nil {
			return fmt.Errorf("заполнение характеристик товара %d: %w", p.ID, err)
		}
	}
	return tx.Commit()
}
