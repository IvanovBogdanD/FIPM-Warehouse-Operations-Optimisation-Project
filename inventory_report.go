package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"os"

	"github.com/pkg/browser"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (i *InventoryService) SaveInventoryPDF(id int, encoded string, print bool) (string, error) {
	if _, err := i.getInventory(id); err != nil {
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
