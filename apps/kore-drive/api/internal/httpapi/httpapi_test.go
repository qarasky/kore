package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/qarasky/kore/api/internal/auth"
	"github.com/qarasky/kore/api/internal/store"
	"github.com/qarasky/kore/api/internal/users"
)

func setup(t *testing.T) http.Handler {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := users.Create(context.Background(), db, "a@b.c", "user", 0); err != nil {
		t.Fatal(err)
	}
	return New(db, t.TempDir())
}

func TestMeAndLogout(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	u, err := users.Create(context.Background(), db, "a@b.c", "user", 0)
	if err != nil {
		t.Fatal(err)
	}
	tok, err := auth.NewSession(context.Background(), db, u.ID, 3600e9)
	if err != nil {
		t.Fatal(err)
	}
	h := New(db, t.TempDir())

	me := func() int {
		req := httptest.NewRequest("GET", "/api/auth/me", nil)
		req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: tok})
		r := httptest.NewRecorder()
		h.ServeHTTP(r, req)
		return r.Code
	}
	if me() != 200 {
		t.Fatal("me failed")
	}
	req := httptest.NewRequest("POST", "/api/auth/logout", nil)
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: tok})
	h.ServeHTTP(httptest.NewRecorder(), req)
	if me() != 401 {
		t.Fatal("session survived logout")
	}
	noCookie := httptest.NewRecorder()
	h.ServeHTTP(noCookie, httptest.NewRequest("GET", "/api/auth/me", nil))
	if noCookie.Code != 401 {
		t.Fatal("anonymous me ok")
	}
}

func TestClientIP(t *testing.T) {
	cases := []struct {
		name, remote string
		hdr          map[string]string
		want         string
	}{
		{"public ignores spoofed XFF", "8.8.8.8:1", map[string]string{"X-Forwarded-For": "1.1.1.1", "CF-Connecting-IP": "2.2.2.2"}, "8.8.8.8"},
		{"loopback honours CF", "127.0.0.1:1", map[string]string{"CF-Connecting-IP": "2.2.2.2", "X-Forwarded-For": "1.1.1.1"}, "2.2.2.2"},
		{"private honours rightmost XFF", "10.0.0.5:1", map[string]string{"X-Forwarded-For": "6.6.6.6, 1.1.1.1"}, "1.1.1.1"},
		{"docker bridge", "172.17.0.2:1", map[string]string{"X-Forwarded-For": "3.3.3.3"}, "3.3.3.3"},
		{"ipv6 ULA", "[fd00::1]:1", map[string]string{"X-Forwarded-For": "3.3.3.3"}, "3.3.3.3"},
		{"link-local", "169.254.1.1:1", map[string]string{"X-Forwarded-For": "3.3.3.3"}, "3.3.3.3"},
		{"garbage falls back", "127.0.0.1:1", map[string]string{"CF-Connecting-IP": "nope", "X-Forwarded-For": "junk, also junk"}, "127.0.0.1"},
		{"garbage CF uses XFF", "127.0.0.1:1", map[string]string{"CF-Connecting-IP": "nope", "X-Forwarded-For": "4.4.4.4"}, "4.4.4.4"},
		{"rightmost valid skips trailing garbage", "127.0.0.1:1", map[string]string{"X-Forwarded-For": "4.4.4.4, junk"}, "4.4.4.4"},
		{"no headers", "192.168.1.2:1", nil, "192.168.1.2"},
	}
	for _, c := range cases {
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = c.remote
		for k, v := range c.hdr {
			req.Header.Set(k, v)
		}
		if got := ClientIP(req); got != c.want {
			t.Errorf("%s: got %s want %s", c.name, got, c.want)
		}
	}
}
