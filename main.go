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
	authService := NewAuthService(dbService.db)
	if err := authService.InitSchema(); err != nil {
		log.Fatal("Ошибка создания таблицы users: ", err)
	}
	adminService := NewAdminService(dbService.db)
	inventoryService := NewInventoryService(dbService.db)
	if err := inventoryService.InitSchema(); err != nil {
		log.Fatal("Failed to create inventory tables: ", err)
	}
	// 2. Запускаем Wails
	err = wails.Run(&options.App{
		Title:     "ФИПМ",
		Width:     1320,
		Height:    840,
		MinWidth:  620,
		MinHeight: 480,

		AssetServer: &assetserver.Options{
			Assets: assets,
		},

		BackgroundColour: &options.RGBA{R: 248, G: 249, B: 250, A: 1},

		// Регистрация сервиса через Bind
		Bind: []interface{}{
			dbService, //передаем в js созданные экземпляры
			authService,
			adminService,
			inventoryService,
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
