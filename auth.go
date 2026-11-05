package main

import (
	"database/sql"
	"errors"
	"fmt"

	"golang.org/x/crypto/bcrypt"
	/*errors — чтобы создать простую ошибку (например, если пароль пустой).
	  fmt — чтобы добавлять контекст к ошибкам (например, «ошибка базы: ...»).
	  bcrypt — библиотека для шифрования паролей.*/)

// AuthService — сервис авторизации.
type AuthService struct { // это обертка через которую будут выполняться авторизация и регистрация
	db *sql.DB
}

// NewAuthService — создаёт сервис авторизации на готовом подключении.
func NewAuthService(db *sql.DB) *AuthService {
	return &AuthService{db: db}
}

// InitSchema — создаёт таблицу users, если её ещё нет.
func (a *AuthService) InitSchema() error {
	_, err := a.db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			last_name     TEXT NOT NULL,
			first_name    TEXT NOT NULL,
			middle_name   TEXT,
			email         TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			role          TEXT NOT NULL DEFAULT 'Кладовщик'
		)
	`)
	return err
}

type RegisterRequest struct {
	LastName   string `json:"lastName"`
	FirstName  string `json:"firstName"`
	MiddleName string `json:"middleName"`
	Email      string `json:"email"`
	Password   string `json:"password"`
	Role       string `json:"role"`
}

// Register — регистрирует пользователя. Пароль хэшируется bcrypt.
func (a *AuthService) Register(req RegisterRequest) error {
	if req.Email == "" || req.Password == "" || req.FirstName == "" || req.LastName == "" {
		return errors.New("заполните все обязательные поля")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("хэширование пароля: %w", err)
	}

	_, err = a.db.Exec(
		`INSERT INTO users (last_name, first_name, middle_name, email, password_hash, role) 
		 VALUES (?, ?, ?, ?, ?, ?)`,
		req.LastName, req.FirstName, req.MiddleName, req.Email, string(hash), req.Role,
	)
	if err != nil {
		return fmt.Errorf("регистрация: %w", err)
	}

	return nil
}

// Login — проверяет имя и пароль. Возвращает true, если вход успешен.
func (a *AuthService) Login(username, password string) (bool, error) {
	var passwordHash string

	err := a.db.QueryRow(
		`SELECT password_hash FROM users WHERE username = ?`, username,
	).Scan(&passwordHash)

	if err == sql.ErrNoRows {
		// Пользователь не найден — это не ошибка, просто неудачный вход.
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("поиск пользователя: %w", err)
	}

	if bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)) != nil {
		// Пароль не совпал.
		return false, nil
	}

	return true, nil
}
