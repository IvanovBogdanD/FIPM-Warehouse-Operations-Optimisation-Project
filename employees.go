package main

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

var errManagerRequired = errors.New("выберите ответственного из одобренных пользователей с ролью «Менеджер»")

type Employee struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

func (s *DBService) GetManagers() ([]Employee, error) {
	rows, err := s.db.Query(`SELECT id, trim(last_name || ' ' || first_name || ' ' || COALESCE(middle_name, ''))
		FROM users WHERE role = 'Менеджер' AND is_approved = 1 ORDER BY last_name, first_name, id`)
	if err != nil {
		return nil, fmt.Errorf("получение менеджеров: %w", err)
	}
	defer rows.Close()
	managers := []Employee{}
	for rows.Next() {
		var manager Employee
		if err := rows.Scan(&manager.ID, &manager.Name); err != nil {
			return nil, fmt.Errorf("чтение менеджера: %w", err)
		}
		managers = append(managers, manager)
	}
	return managers, rows.Err()
}

func (s *DBService) findManager(id int, name string) (Employee, error) {
	if id != 0 {
		var manager Employee
		err := s.db.QueryRow(`SELECT id, trim(last_name || ' ' || first_name || ' ' || COALESCE(middle_name, ''))
            FROM users WHERE id = ? AND role = 'Менеджер' AND is_approved = 1`, id).Scan(&manager.ID, &manager.Name)
		if errors.Is(err, sql.ErrNoRows) {
			return Employee{}, errManagerRequired
		}
		if err != nil {
			return Employee{}, fmt.Errorf("проверка ответственного: %w", err)
		}
		return manager, nil
	}
	managers, err := s.GetManagers()
	if err != nil {
		return Employee{}, err
	}
	var selected Employee
	for _, manager := range managers {
		if manager.Name == strings.TrimSpace(name) {
			if selected.ID != 0 {
				return Employee{}, errors.New("несколько менеджеров с одинаковым ФИО, выберите сотрудника из списка")
			}
			selected = manager
		}
	}
	if selected.ID == 0 {
		return Employee{}, errManagerRequired
	}
	return selected, nil
}
