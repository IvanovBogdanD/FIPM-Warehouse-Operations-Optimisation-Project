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
			role          TEXT NOT NULL DEFAULT 'Кладовщик',
			is_approved   BOOLEAN NOT NULL DEFAULT 0  -- НОВАЯ КОЛОНКА (0 = false, 1 = true)
		)
	`)
	return err
}

// UserResponse — структура, которую мы отдаем на фронтенд при успешном входе
type UserResponse struct {
	ID         int    `json:"id"`
	LastName   string `json:"lastName"`
	FirstName  string `json:"firstName"`
	Email      string `json:"email"`
	Role       string `json:"role"`
	IsApproved bool   `json:"isApproved"`
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

func (a *AuthService) Login(email, password string) (*UserResponse, error) {
	var hash string
	var user UserResponse

	// 1. Ищем пользователя по email.
	// Драйвер сам сконвертирует 1/0 в boolean для поля IsApproved.
	//Метод Scan берёт полученную из базы строку и по очереди раскладывает значения в те переменные, которые мы ему передали. При этом порядок имеет значение
	err := a.db.QueryRow(
		`SELECT id, last_name, first_name, role, password_hash, is_approved FROM users WHERE email = ?`, email,
	).Scan(&user.ID, &user.LastName, &user.FirstName, &user.Role, &hash, &user.IsApproved)

	if err == sql.ErrNoRows {
		return nil, errors.New("неверный email или пароль")
	}
	if err != nil {
		return nil, fmt.Errorf("поиск пользователя: %w", err)
	}

	// 2. Проверяем пароль
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return nil, errors.New("неверный email или пароль")
	}

	// 3. Возвращаем данные.
	return &user, nil
}
