package httpapi_test

import (
	"strings"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/testsrv"
)

func TestTokenAuthenticatesAsOwner(t *testing.T) {
	srv, _ := testsrv.New(t)
	session := testsrv.Login(t, srv)
	r := testsrv.Do(t, srv, session, "POST", "/api/tokens", map[string]string{"name": "claude"})
	var created struct{ ID, Name, Token string }
	r.Decode(t, &created)
	if r.Status != 201 || created.Token == "" || created.Name != "claude" {
		t.Fatalf("create: %d %s", r.Status, r.Body)
	}
	me := testsrv.Do(t, srv, created.Token, "GET", "/api/me", nil)
	var u struct{ Email string }
	me.Decode(t, &u)
	if me.Status != 200 || u.Email != testsrv.AdminEmail {
		t.Fatalf("me via token: %d %s", me.Status, me.Body)
	}
	list := testsrv.Do(t, srv, session, "GET", "/api/tokens", nil)
	if list.Status != 200 || string(list.Body) == "" || strings.Contains(string(list.Body), created.Token) {
		t.Fatalf("list leaks or fails: %d %s", list.Status, list.Body)
	}
}

func TestRevokedTokenRejected(t *testing.T) {
	srv, _ := testsrv.New(t)
	session := testsrv.Login(t, srv)
	var c struct{ ID, Token string }
	testsrv.Do(t, srv, session, "POST", "/api/tokens", map[string]string{"name": "x"}).Decode(t, &c)
	if r := testsrv.Do(t, srv, session, "DELETE", "/api/tokens/"+c.ID, nil); r.Status != 204 {
		t.Fatalf("revoke: %d %s", r.Status, r.Body)
	}
	if r := testsrv.Do(t, srv, c.Token, "GET", "/api/me", nil); r.Status != 401 {
		t.Fatalf("revoked token still works: %d", r.Status)
	}
}

func TestOtherUsersTokenIs404(t *testing.T) {
	srv, _ := testsrv.New(t)
	admin := testsrv.Login(t, srv)
	other := testsrv.AddUser(t, srv, admin, "u@example.com")
	var c struct{ ID string }
	testsrv.Do(t, srv, admin, "POST", "/api/tokens", map[string]string{"name": "x"}).Decode(t, &c)
	if r := testsrv.Do(t, srv, other, "DELETE", "/api/tokens/"+c.ID, nil); r.Status != 404 || r.ErrorCode() != "not_found" {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
}

func TestTokenCannotManageTokens(t *testing.T) {
	srv, _ := testsrv.New(t)
	session := testsrv.Login(t, srv)
	var c struct{ ID, Token string }
	testsrv.Do(t, srv, session, "POST", "/api/tokens", map[string]string{"name": "x"}).Decode(t, &c)
	for _, req := range [][2]string{{"POST", "/api/tokens"}, {"GET", "/api/tokens"}, {"DELETE", "/api/tokens/" + c.ID}} {
		r := testsrv.Do(t, srv, c.Token, req[0], req[1], map[string]string{"name": "y"})
		if r.Status != 403 || r.ErrorCode() != "forbidden" {
			t.Fatalf("%s %s with token: %d %s", req[0], req[1], r.Status, r.Body)
		}
	}
}

func TestTokenNameRequired(t *testing.T) {
	srv, _ := testsrv.New(t)
	session := testsrv.Login(t, srv)
	if r := testsrv.Do(t, srv, session, "POST", "/api/tokens", map[string]string{"name": "  "}); r.Status != 422 {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
}
