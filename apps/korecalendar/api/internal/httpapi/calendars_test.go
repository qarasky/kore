package httpapi_test

import (
	"testing"

	"github.com/qarasky/korecalendar/api/internal/testsrv"
)

type cal struct{ ID, Name, Color string }

func TestDefaultCalendarCreatedOnSetupAndAdminCreate(t *testing.T) {
	srv, _ := testsrv.New(t)
	admin := testsrv.Login(t, srv)
	var list []cal
	testsrv.Do(t, srv, admin, "GET", "/api/calendars", nil).Decode(t, &list)
	if len(list) != 1 || list[0].Name != "Personal" || list[0].Color != "#5b8def" {
		t.Fatalf("admin calendars = %+v", list)
	}
	user := testsrv.AddUser(t, srv, admin, "u@example.com")
	list = nil
	testsrv.Do(t, srv, user, "GET", "/api/calendars", nil).Decode(t, &list)
	if len(list) != 1 || list[0].Name != "Personal" {
		t.Fatalf("user calendars = %+v", list)
	}
}

func TestCalendarCRUD(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	r := testsrv.Do(t, srv, tok, "POST", "/api/calendars", map[string]string{"name": "Health", "color": "#4fb286"})
	var c cal
	r.Decode(t, &c)
	if r.Status != 201 || c.ID == "" {
		t.Fatalf("create %d %s", r.Status, r.Body)
	}
	r = testsrv.Do(t, srv, tok, "PATCH", "/api/calendars/"+c.ID, map[string]string{"name": "Body"})
	r.Decode(t, &c)
	if r.Status != 200 || c.Name != "Body" || c.Color != "#4fb286" {
		t.Fatalf("patch %d %s", r.Status, r.Body)
	}
	if r := testsrv.Do(t, srv, tok, "DELETE", "/api/calendars/"+c.ID, nil); r.Status != 204 {
		t.Fatalf("delete %d %s", r.Status, r.Body)
	}
}

func TestOtherUsersCalendarIs404(t *testing.T) {
	srv, _ := testsrv.New(t)
	admin := testsrv.Login(t, srv)
	other := testsrv.AddUser(t, srv, admin, "u@example.com")
	var c cal
	testsrv.Do(t, srv, admin, "POST", "/api/calendars", map[string]string{"name": "Mine", "color": "#112233"}).Decode(t, &c)
	for _, m := range []string{"PATCH", "DELETE"} {
		r := testsrv.Do(t, srv, other, m, "/api/calendars/"+c.ID, map[string]string{"name": "x"})
		if r.Status != 404 || r.ErrorCode() != "not_found" {
			t.Fatalf("%s: %d %s", m, r.Status, r.Body)
		}
	}
}

func TestCalendarRejectsBadColor(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	r := testsrv.Do(t, srv, tok, "POST", "/api/calendars", map[string]string{"name": "X", "color": "red"})
	if r.Status != 422 || r.ErrorCode() != "validation_error" {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
}
