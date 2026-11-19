package main

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

var errManagerRequired = errors.New("выберите одного или нескольких одобренных менеджеров")

type Employee struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

func (s *DBService) GetManagers() ([]Employee, error) {
	return getManagers(s.db)
}

func getManagers(db databaseReader) ([]Employee, error) {
	rows, err := db.Query(`SELECT id, trim(last_name || ' ' || first_name || ' ' || COALESCE(middle_name, ''))
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

func resolveManagers(db databaseReader, ids []int) ([]Employee, error) {
	if len(ids) == 0 {
		return nil, errManagerRequired
	}
	managers, err := getManagers(db)
	if err != nil {
		return nil, err
	}
	available := make(map[int]Employee, len(managers))
	for _, manager := range managers {
		available[manager.ID] = manager
	}
	selected := make([]Employee, 0, len(ids))
	for _, id := range ids {
		manager, exists := available[id]
		if !exists {
			return nil, errManagerRequired
		}
		selected = append(selected, manager)
		delete(available, id)
	}
	return selected, nil
}

func managerNames(managers []Employee) string {
	names := make([]string, len(managers))
	for index, manager := range managers {
		names[index] = manager.Name
	}
	return strings.Join(names, ", ")
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
