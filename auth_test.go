package main

import "testing"

func TestSeedDefaultUsers(t *testing.T) {
	store, _ := testStore(t)
	auth := NewAuthService(store.db)
	if err := auth.InitSchema(); err != nil {
		t.Fatal(err)
	}
	if err := auth.seedDefaultUsers(); err != nil {
		t.Fatal(err)
	}
	for email, role := range map[string]string{
		"admin@mail.ru":   "Администратор",
		"clad@mail.ru":    "Кладовщик",
		"manager@mail.ru": "Менеджер",
	} {
		user, err := auth.Login(email, "a")
		if err != nil || user.Role != role || !user.IsApproved {
			t.Fatalf("%s: user=%+v err=%v", email, user, err)
		}
	}
	var count int
	if err := store.db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count); err != nil || count != 3 {
		t.Fatalf("users=%d err=%v", count, err)
	}
	manager, err := auth.Login("manager@mail.ru", "a")
	if err != nil {
		t.Fatal(err)
	}
	if err := NewAdminService(store.db).BlockUser(manager.ID); err != nil {
		t.Fatal(err)
	}
	if err := auth.seedDefaultUsers(); err != nil {
		t.Fatal(err)
	}
	blocked, err := auth.Login("manager@mail.ru", "a")
	if err != nil || blocked.ID != manager.ID || blocked.IsApproved {
		t.Fatalf("existing user changed: user=%+v err=%v", blocked, err)
	}
}
