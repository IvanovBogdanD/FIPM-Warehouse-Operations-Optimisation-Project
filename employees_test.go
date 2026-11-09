package main

import "testing"

func testOrderStore(t *testing.T) (*DBService, string) {
	t.Helper()
	s, path := testStore(t)
	if err := NewAuthService(s.db).InitSchema(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO users(id,last_name,first_name,middle_name,email,password_hash,role,is_approved) VALUES
		(1,'Иванов','Иван','Иванович','ivanov@example.test','test','Менеджер',1),
		(2,'Петрова','А.С.','','petrova@example.test','test','Менеджер',1),
		(3,'Кузнецов','Р.Н.','','clerk@example.test','test','Кладовщик',1),
		(4,'Администратор','Системы','','admin@example.test','test','Администратор',1),
		(5,'Новый','Менеджер','','pending@example.test','test','Менеджер',0)`); err != nil {
		t.Fatal(err)
	}
	return s, path
}

func TestManagerSelection(t *testing.T) {
	s, _ := testOrderStore(t)
	managers, err := s.GetManagers()
	if err != nil || len(managers) != 2 || managers[0].ID != 1 || managers[1].ID != 2 {
		t.Fatalf("managers=%+v error=%v", managers, err)
	}
	for _, id := range []int{-1, 3, 4, 5, 999} {
		if _, err := s.findManager(id, "Иванов Иван Иванович"); err == nil {
			t.Fatalf("accepted manager %d", id)
		}
	}
	manager, err := s.findManager(1, "Подменённое имя")
	if err != nil || manager.Name != "Иванов Иван Иванович" {
		t.Fatalf("manager=%+v error=%v", manager, err)
	}
	s.Close()
	if _, err := s.GetManagers(); err == nil {
		t.Fatal("closed database ignored")
	}
}
