package main

import "testing"

func TestOutgoingResponsibleMustBeManager(t *testing.T) {
	s, _ := testOrderStore(t)
	for _, id := range []int{3, 4, 5, 999} {
		request := outgoingRequest()
		request.ResponsibleID = id
		if _, err := s.CreateOutgoing(request); err == nil {
			t.Fatalf("accepted non-manager %d", id)
		}
	}
	request := outgoingRequest()
	request.ResponsibleID = 2
	request.Responsible = "Подменённое имя"
	created, err := s.CreateOutgoing(request)
	if err != nil || created.Order.ResponsibleID != 2 || created.Order.Responsible != "Петрова А.С." {
		t.Fatalf("order=%+v error=%v", created.Order, err)
	}
	if _, err := s.db.Exec("UPDATE users SET is_approved=0 WHERE id=2"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteOutgoing(created.Order.ID, completeRequest()); err == nil {
		t.Fatal("blocked responsible allowed to complete order")
	}
	checkProductStock(t, s, 1, 10, 4, 6)
	if _, err := s.CancelOrder(created.Order.ID); err != nil {
		t.Fatal(err)
	}
	checkProductStock(t, s, 1, 10, 0, 10)
}
