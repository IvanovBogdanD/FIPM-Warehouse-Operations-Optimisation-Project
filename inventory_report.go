package main

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/pkg/browser"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (i *InventoryService) initInventoryReports() error {
	tx, err := i.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		CREATE TABLE IF NOT EXISTS inventory_reports (
			inventory_id INTEGER PRIMARY KEY REFERENCES inventories(id),
			document TEXT NOT NULL
		)
	`); err != nil {
		return err
	}
	rows, err := tx.Query(`
		SELECT id FROM inventories
		WHERE status = 'completed'
		  AND id NOT IN (SELECT inventory_id FROM inventory_reports)
	`)
	if err != nil {
		return err
	}
	defer rows.Close()
	var completed []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return err
		}
		completed = append(completed, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, id := range completed {
		if _, err := saveInventoryReport(tx, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (i *InventoryService) GenerateInventoryReport(id int) (InventoryDetails, error) {
	tx, err := i.db.Begin()
	if err != nil {
		return InventoryDetails{}, err
	}
	defer tx.Rollback()

	details, err := saveInventoryReport(tx, id)
	if err != nil {
		return InventoryDetails{}, err
	}
	if err := tx.Commit(); err != nil {
		return InventoryDetails{}, err
	}
	return details, nil
}

func saveInventoryReport(tx *sql.Tx, id int) (InventoryDetails, error) {
	details, err := readInventoryDetails(tx, id)
	if err != nil {
		return InventoryDetails{}, err
	}
	if len(details.Items) == 0 {
		return InventoryDetails{}, errors.New("нет товаров для формирования акта")
	}
	for _, item := range details.Items {
		if item.ActualCount == nil {
			return InventoryDetails{}, errors.New("сначала завершите подсчёт всех товаров")
		}
	}

	document, err := json.Marshal(details)
	if err != nil {
		return InventoryDetails{}, err
	}
	result, err := tx.Exec(`
		INSERT INTO inventory_reports (inventory_id, document) VALUES (?, ?)
		ON CONFLICT(inventory_id) DO UPDATE SET document = excluded.document
		WHERE json_extract(inventory_reports.document, '$.status') = 'draft'
	`, id, string(document))
	if err != nil {
		return InventoryDetails{}, fmt.Errorf("сохранение акта инвентаризации: %w", err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return InventoryDetails{}, err
	}
	if changed == 0 {
		return readInventoryReport(tx, id)
	}
	return details, nil
}

func (i *InventoryService) GetInventoryReport(id int) (InventoryDetails, error) {
	return readInventoryReport(i.db, id)
}

func readInventoryReport(db databaseReader, id int) (InventoryDetails, error) {
	var document []byte
	if err := db.QueryRow("SELECT document FROM inventory_reports WHERE inventory_id = ?", id).Scan(&document); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return InventoryDetails{}, errors.New("акт инвентаризации не найден")
		}
		return InventoryDetails{}, err
	}
	var details InventoryDetails
	err := json.Unmarshal(document, &details)
	return details, err
}

func (i *InventoryService) GetInventoryReports() ([]Inventory, error) {
	rows, err := i.db.Query(`
		SELECT json_remove(document, '$.items')
		FROM inventory_reports
		ORDER BY inventory_id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	reports := []Inventory{}
	for rows.Next() {
		var document []byte
		if err := rows.Scan(&document); err != nil {
			return nil, err
		}
		var summary Inventory
		if err := json.Unmarshal(document, &summary); err != nil {
			return nil, err
		}
		reports = append(reports, summary)
	}
	return reports, rows.Err()
}

func (i *InventoryService) SaveInventoryPDF(id int, encoded string, print bool) (string, error) {
	if _, err := readInventory(i.db, id); err != nil {
		return "", err
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || !bytes.HasPrefix(data, []byte("%PDF-")) {
		return "", errors.New("некорректный документ PDF")
	}
	if print {
		file, err := os.CreateTemp("", fmt.Sprintf("fipm-inventory-%d-*.pdf", id))
		if err != nil {
			return "", err
		}
		_, writeErr := file.Write(data)
		closeErr := file.Close()
		if writeErr != nil {
			return "", writeErr
		}
		if closeErr != nil {
			return "", closeErr
		}
		if err := browser.OpenFile(file.Name()); err != nil {
			return "", fmt.Errorf("открытие акта для печати: %w", err)
		}
		return file.Name(), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	path, err := runtime.SaveFileDialog(i.ctx, runtime.SaveDialogOptions{
		Title:                "Сохранить акт инвентаризации",
		DefaultFilename:      fmt.Sprintf("ИНВ-%04d.pdf", id),
		DefaultDirectory:     home,
		CanCreateDirectories: true,
		Filters:              []runtime.FileFilter{{DisplayName: "Документ PDF", Pattern: "*.pdf"}},
	})
	if err != nil || path == "" {
		return "", err
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		return "", err
	}
	return path, nil
}
