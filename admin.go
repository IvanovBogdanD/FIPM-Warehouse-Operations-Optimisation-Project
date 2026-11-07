package main

import (
	"database/sql"
	"fmt"
)

type AdminService struct {
	db *sql.DB
}

func NewAdminService(db *sql.DB) *AdminService {
	return &AdminService{db: db}
}

func (a *AdminService) GetUsers() ([]UserResponse, error) {
	rows, err := a.db.Query(`
		SELECT id, last_name, first_name, middle_name, email, role, is_approved
		FROM users
		ORDER BY is_approved ASC, last_name ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("запрос списка пользователей: %w", err)
	}
	defer rows.Close()

	users := make([]UserResponse, 0)
	for rows.Next() {
		var u UserResponse
		// Добавили &u.MiddleName в Scan
		if err := rows.Scan(&u.ID, &u.LastName, &u.FirstName, &u.MiddleName, &u.Email, &u.Role, &u.IsApproved); err != nil {
			return nil, fmt.Errorf("чтение пользователя: %w", err)
		}
		users = append(users, u)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ошибка после перебора строк: %w", err)
	}

	return users, nil
}

func (a *AdminService) ApproveUser(userID int) error {
	res, err := a.db.Exec(`
		UPDATE users
		SET is_approved = 1
		WHERE id = ?
	`, userID)
	if err != nil {
		return fmt.Errorf("одобрение пользователя: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("проверка количества обновленных строк: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("пользователь с id %d не найден", userID)
	}

	return nil
}
