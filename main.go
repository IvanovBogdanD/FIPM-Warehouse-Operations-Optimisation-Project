package main

import (
	"context"
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// 1. Создаём сервис (он сам подключится к store.db)
	dbService, err := NewDBService()
	if err != nil {
		log.Fatal("Не удалось открыть БД:", err)
	}

	// 2. Запускаем Wails
	err = wails.Run(&options.App{
		Title:     "Wails + SQLite",
		Width:     760,
		Height:    560,
		MinWidth:  620,
		MinHeight: 480,

		AssetServer: &assetserver.Options{
			Assets: assets,
		},

		BackgroundColour: &options.RGBA{R: 18, G: 18, B: 22, A: 1},

		//  Регистрация сервиса в v2 — через Bind
		Bind: []interface{}{
			dbService,
		},

		// Закрываем БД при выходе
		OnShutdown: func(ctx context.Context) {
			dbService.Close()
		},
	})

	if err != nil {
		log.Fatal(err)
	}
}