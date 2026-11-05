package main

// ИЗМЕНЕНО: этот файл создан при разделении db.go.
// В него перенесены методы товаров без изменения имён и получателя
// (*DBService). Фронтенд (window.go.main.DBService.GetAllProducts и т.д.)
// продолжает работать как раньше.
type Product struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// GetAllProducts — вернуть все товары
func (s *DBService) GetAllProducts() ([]Product, error) {
	rows, err := s.db.Query("SELECT id, name, count FROM products")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	products := []Product{}
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.Name, &p.Count); err != nil {
			return nil, err
		}
		products = append(products, p)
	}
	return products, nil
}

// AddProduct — добавить новый товар
func (s *DBService) AddProduct(p Product) (Product, error) {
	res, err := s.db.Exec(
		"INSERT INTO products (name, count) VALUES (?, ?)",
		p.Name, p.Count,
	)
	if err != nil {
		return Product{}, err
	}
	id, _ := res.LastInsertId()
	p.ID = int(id)
	return p, nil
}

// DeleteProduct — удалить товар по id
func (s *DBService) DeleteProduct(id int) error {
	_, err := s.db.Exec("DELETE FROM products WHERE id = ?", id)
	return err
}
