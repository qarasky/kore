package httpapi

import (
	"context"
	"strings"
	"testing"

	"github.com/qarasky/kore/api/internal/users"
)

// TestPasswordEndpointsAreGone locks in that Kore ID is the only way in: the
// password login, registration/setup and password-management handlers no
// longer exist (404, not 401/403), so nothing can accept a password.
func TestPasswordEndpointsAreGone(t *testing.T) {
	e := newEnv(t)
	cases := []struct {
		method, path, body string
	}{
		{"POST", "/api/auth/login", `{"email":"user@x.io","password":"password-1"}`},
		{"POST", "/api/auth/register", `{"email":"new@x.io","password":"password-1"}`},
		{"POST", "/api/auth/setup", `{"email":"new@x.io","password":"password-1"}`},
		{"POST", "/api/me/password", `{"current_password":"password-1","new_password":"password-2"}`},
		{"POST", "/api/admin/users/" + e.user.ID + "/password", `{"new_password":"password-2"}`},
		{"POST", "/api/admin/users/" + e.admin.ID + "/password", `{"new_password":"password-2"}`},
	}
	for _, c := range cases {
		for name, as := range map[string]*users.User{"anonymous": nil, "admin": &e.admin, "user": &e.user} {
			rec := e.do(t, as, c.method, c.path, c.body)
			if rec.Code != 404 {
				t.Errorf("%s %s %s: %d %s", name, c.method, c.path, rec.Code, rec.Body)
			}
			if strings.Contains(strings.ToLower(rec.Body.String()), "password") {
				t.Errorf("%s %s leaked a password message: %s", name, c.path, rec.Body)
			}
		}
	}

	// Nothing that still exists accepts a password either.
	rec := e.do(t, &e.admin, "POST", "/api/admin/users", `{"email":"new@x.io","password":"password-1"}`)
	if rec.Code != 404 && rec.Code != 405 {
		t.Fatalf("admin create accepted a body: %d %s", rec.Code, rec.Body)
	}
	if n, err := users.Count(context.Background(), e.db); err != nil || n != 2 {
		t.Fatalf("users=%d err=%v (an account was created)", n, err)
	}
}
