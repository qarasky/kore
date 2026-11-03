package httpapi_test

import (
	"net/http"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/testsrv"
)

// KoreCalendar has no human password path: the old endpoints are gone from the
// router (404), not merely disabled.
func TestPasswordEndpointsAreGone(t *testing.T) {
	srv, _ := testsrv.New(t)
	creds := map[string]string{"email": "a@example.com", "password": "long enough pw"}
	for _, r := range []struct{ method, path string }{
		{"GET", "/api/setup"},
		{"POST", "/api/setup"},
		{"POST", "/api/login"},
		{"POST", "/api/admin/users"},
	} {
		got := testsrv.Do(t, srv, "", r.method, r.path, creds)
		if got.Status != http.StatusNotFound && got.Status != http.StatusGone {
			t.Errorf("%s %s: %d %s", r.method, r.path, got.Status, got.Body)
		}
	}
}

func TestAuthConfigOffersNoPasswordLogin(t *testing.T) {
	srv, _ := testsrv.New(t)
	var cfg map[string]any
	testsrv.Do(t, srv, "", "GET", "/api/auth/config", nil).Decode(t, &cfg)
	if _, ok := cfg["password_login"]; ok {
		t.Fatalf("password_login still advertised: %v", cfg)
	}
	if cfg["oidc"] != nil {
		t.Fatalf("oidc should be null without a provider: %v", cfg)
	}
}

func TestMeRequiresAuth(t *testing.T) {
	srv, _ := testsrv.New(t)
	r := testsrv.Do(t, srv, "", "GET", "/api/me", nil)
	if r.Status != 401 || r.ErrorCode() != "unauthorized" {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	tok := testsrv.Login(t, srv)
	r = testsrv.Do(t, srv, tok, "GET", "/api/me", nil)
	var me struct{ Email, Role, Timezone string }
	r.Decode(t, &me)
	if r.Status != 200 || me.Email != testsrv.AdminEmail || me.Role != "admin" || me.Timezone != "UTC" {
		t.Fatalf("%d %+v", r.Status, me)
	}
}

func TestPatchMeTimezoneRejectsBogusZone(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	if r := testsrv.Do(t, srv, tok, "PATCH", "/api/me", map[string]string{"timezone": "Mars/Base"}); r.Status != 422 || r.ErrorCode() != "validation_error" {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	if r := testsrv.Do(t, srv, tok, "PATCH", "/api/me", map[string]string{"timezone": "Europe/Berlin"}); r.Status != 200 {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	r := testsrv.Do(t, srv, tok, "GET", "/api/me", nil)
	var me struct{ Timezone string }
	r.Decode(t, &me)
	if me.Timezone != "Europe/Berlin" {
		t.Fatalf("timezone %q", me.Timezone)
	}
}

func TestAdminUsersListAndRolesWithoutPasswords(t *testing.T) {
	srv, _ := testsrv.New(t)
	admin := testsrv.Login(t, srv)
	user := testsrv.AddUser(t, srv, admin, "u@example.com")

	var list []struct {
		ID           string `json:"id"`
		Email        string `json:"email"`
		Role         string `json:"role"`
		KoreIDLinked bool   `json:"kore_id_linked"`
	}
	r := testsrv.Do(t, srv, admin, "GET", "/api/admin/users", nil)
	r.Decode(t, &list)
	if r.Status != 200 || len(list) != 2 {
		t.Fatalf("list: %d %s", r.Status, r.Body)
	}
	var id string
	for _, u := range list {
		if u.Email == "u@example.com" {
			id = u.ID
			if u.Role != "user" || u.KoreIDLinked {
				t.Fatalf("user row %+v", u)
			}
		}
	}
	if id == "" {
		t.Fatalf("missing user in %s", r.Body)
	}

	// Non-admins do not even see the route.
	if r := testsrv.Do(t, srv, user, "GET", "/api/admin/users", nil); r.Status != 404 || r.ErrorCode() != "not_found" {
		t.Fatalf("non-admin list: %d %s", r.Status, r.Body)
	}
	if r := testsrv.Do(t, srv, user, "PATCH", "/api/admin/users/"+id, map[string]string{"role": "admin"}); r.Status != 404 {
		t.Fatalf("non-admin patch: %d %s", r.Status, r.Body)
	}

	// A role change needs no password, just the admin's session.
	r = testsrv.Do(t, srv, admin, "PATCH", "/api/admin/users/"+id, map[string]string{"role": "admin"})
	var patched struct{ Role string }
	r.Decode(t, &patched)
	if r.Status != 200 || patched.Role != "admin" {
		t.Fatalf("patch: %d %s", r.Status, r.Body)
	}
	if r := testsrv.Do(t, srv, admin, "PATCH", "/api/admin/users/"+id, map[string]string{"role": "owner"}); r.Status != 422 {
		t.Fatalf("bad role: %d %s", r.Status, r.Body)
	}
}

func TestLogoutInvalidatesToken(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	if r := testsrv.Do(t, srv, tok, "POST", "/api/logout", nil); r.Status != 204 {
		t.Fatalf("logout %d", r.Status)
	}
	if r := testsrv.Do(t, srv, tok, "GET", "/api/me", nil); r.Status != 401 {
		t.Fatalf("after logout %d", r.Status)
	}
}

func TestSessionCookieAuthenticates(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	r := testsrv.Do(t, srv, "", "GET", "/api/me", nil, "Cookie", "korecal_session="+tok)
	if r.Status != 200 {
		t.Fatalf("cookie auth: %d %s", r.Status, r.Body)
	}
}
