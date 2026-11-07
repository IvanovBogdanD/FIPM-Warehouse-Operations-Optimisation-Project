package main

import (
	"fmt"
	"testing"
)

func TestProductSearchPages(t *testing.T) {
	s, _ := testStore(t)
	if _, err := s.db.Exec("DELETE FROM products"); err != nil {
		t.Fatal(err)
	}
	for id := 1; id <= 25; id++ {
		name := fmt.Sprintf("Гвозди %d", id)
		if id%2 == 0 {
			name = fmt.Sprintf("Краска %d", id)
		}
		if _, err := s.db.Exec("INSERT INTO products(id,name,count) VALUES(?,?,?)", id, name, id); err != nil {
			t.Fatal(err)
		}
	}
	before := schema(t, s.db)
	for _, tc := range []struct {
		query   string
		afterID int
		length  int
		firstID int
		lastID  int
		hasMore bool
	}{
		{"", 0, 10, 1, 10, true},
		{"", 10, 10, 11, 20, true},
		{"", 20, 5, 21, 25, false},
		{"", 15, 10, 16, 25, false},
		{"", 25, 0, 0, 0, false},
		{"  кРАСКА  ", 0, 10, 2, 20, true},
		{"краска", 20, 2, 22, 24, false},
		{"%", 0, 0, 0, 0, false},
		{"' OR 1=1 --", 0, 0, 0, 0, false},
	} {
		t.Run(fmt.Sprintf("%s/%d", tc.query, tc.afterID), func(t *testing.T) {
			page, err := s.SearchProductsPage(tc.query, tc.afterID)
			if err != nil || page.Products == nil || len(page.Products) != tc.length || page.HasMore != tc.hasMore {
				t.Fatalf("page=%+v error=%v", page, err)
			}
			if tc.length > 0 && (page.Products[0].ID != tc.firstID || page.Products[tc.length-1].ID != tc.lastID) {
				t.Fatalf("wrong products: %+v", page.Products)
			}
		})
	}
	if before != schema(t, s.db) {
		t.Fatal("search changed schema")
	}
	if _, err := s.SearchProductsPage("", -1); err == nil {
		t.Fatal("negative cursor accepted")
	}
	if _, err := s.db.Exec("UPDATE products SET count=NULL WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SearchProductsPage("", 0); err == nil {
		t.Fatal("invalid count accepted")
	}
	s.Close()
	if _, err := s.SearchProductsPage("", 0); err == nil {
		t.Fatal("closed database ignored")
	}
}
