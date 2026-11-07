package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func testStore(t *testing.T) (*DBService, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "store.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, count INTEGER);
 INSERT INTO products(id, name, count) VALUES (1, 'Молоко', 10), (2, 'Хлеб', 5), (3, '<script>alert(1)</script>', 0)`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	service := &DBService{db: db}
	if err := service.InitProducts(); err != nil {
		t.Fatal(err)
	}
	return service, path
}

func schema(t *testing.T, db *sql.DB) string {
	t.Helper()
	rows, err := db.Query("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	result := ""
	for rows.Next() {
		var kind, name string
		var query sql.NullString
		if err := rows.Scan(&kind, &name, &query); err != nil {
			t.Fatal(err)
		}
		result += fmt.Sprint(kind, name, query)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestCatalog(t *testing.T) {
	s, _ := testStore(t)
	before := schema(t, s.db)
	products, err := s.GetAllProducts()
	if err != nil || len(products) != 3 {
		t.Fatalf("%v %v", products, err)
	}
	for _, tc := range []struct {
		query string
		ids   []int
	}{
		{"Молоко", []int{1}}, {"мОЛ", []int{1}}, {" ХЛЕБ ", []int{2}}, {"нет", []int{}}, {"' OR 1=1 --", []int{}}, {"%", []int{}}, {"", []int{1, 2, 3}},
	} {
		t.Run(tc.query, func(t *testing.T) {
			got, err := s.SearchProducts(tc.query)
			if err != nil {
				t.Fatal(err)
			}
			ids := []int{}
			for _, p := range got {
				ids = append(ids, p.ID)
			}
			if !reflect.DeepEqual(ids, tc.ids) {
				t.Fatalf("ids=%v want=%v", ids, tc.ids)
			}
		})
	}
	product, err := s.GetProduct(1)
	if err != nil || product != (Product{ID: 1, Name: "Молоко", Count: 10}) {
		t.Fatalf("product=%+v error=%v", product, err)
	}
	if _, err := s.GetProduct(999); err == nil {
		t.Fatal("missing product accepted")
	}
	if _, err := s.AddProduct(Product{Name: "Новый"}); err == nil {
		t.Fatal("add allowed")
	}
	if err := s.DeleteProduct(1); err == nil {
		t.Fatal("delete allowed")
	}
	after, _ := s.GetAllProducts()
	if !reflect.DeepEqual(products, after) || before != schema(t, s.db) {
		t.Fatal("catalog or schema changed")
	}
}

func TestSQLiteFailures(t *testing.T) {
	s, _ := testStore(t)
	s.Close()
	if _, err := s.GetAllProducts(); err == nil {
		t.Fatal("closed database ignored")
	}
	if _, err := s.SearchProducts("Молоко"); err == nil {
		t.Fatal("search ignored closed database")
	}
	if _, err := s.GetProduct(1); err == nil {
		t.Fatal("product lookup ignored closed database")
	}
}

func TestStartupCreatesDatabaseWithoutChangingExistingSchema(t *testing.T) {
	t.Chdir(t.TempDir())
	missing, err := NewDBService()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := missing.GetAllProducts(); err == nil {
		t.Fatal("missing database ignored")
	}
	missing.Close()
	if _, err := os.Stat("store.db"); err != nil {
		t.Fatalf("database not created: %v", err)
	}
	db, err := sql.Open("sqlite", "store.db")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TABLE other (id INTEGER)"); err != nil {
		t.Fatal(err)
	}
	before := schema(t, db)
	s, err := NewDBService()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	defer db.Close()
	if _, err := s.GetAllProducts(); err == nil {
		t.Fatal("missing products table ignored")
	}
	if before != schema(t, db) {
		t.Fatal("schema changed by startup")
	}
}

func TestCatalogEmptyUnicodeAndReadErrors(t *testing.T) {
	s, _ := testStore(t)
	if _, err := s.db.Exec("UPDATE products SET name = ? WHERE id = 2", "Ёлка CAFÉ Ελληνικά"); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{"ёЛКА", "café", "ελληνικά"} {
		products, err := s.SearchProducts(query)
		if err != nil || len(products) != 1 || products[0].ID != 2 {
			t.Fatalf("query=%q products=%v error=%v", query, products, err)
		}
	}
	if _, err := s.db.Exec("UPDATE products SET count = NULL WHERE id = 1"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetAllProducts(); err == nil {
		t.Fatal("NULL count silently accepted")
	}
	if _, err := s.GetProduct(1); err == nil {
		t.Fatal("invalid product silently accepted")
	}
	if _, err := s.db.Exec("DELETE FROM products"); err != nil {
		t.Fatal(err)
	}
	products, err := s.SearchProducts("")
	if err != nil || products == nil || len(products) != 0 {
		t.Fatalf("empty catalog=%v error=%v", products, err)
	}
}
