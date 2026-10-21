package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/store"
	"github.com/artchsh/kore/api/internal/users"
)

func setup(t *testing.T) http.Handler {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	h, _ := auth.HashPassword("right-pw")
	if _, err := users.Create(context.Background(), db, "a@b.c", h, "user", 0); err != nil {
		t.Fatal(err)
	}
	return New(db)
}

func login(h http.Handler, email, pw string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"email":"`+email+`","password":"`+pw+`"}`))
	req.RemoteAddr = "1.2.3.4:5555"
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestLoginRateLimited(t *testing.T) {
	h := setup(t)
	for i := 1; i <= 5; i++ {
		if rec := login(h, "a@b.c", "bad", nil); rec.Code != 401 {
			t.Fatalf("attempt %d: %d", i, rec.Code)
		}
	}
	if rec := login(h, "a@b.c", "right-pw", nil); rec.Code != 429 {
		t.Fatalf("6th attempt: %d", rec.Code)
	}
}

func TestLoginMeLogout(t *testing.T) {
	h := setup(t)
	rec := login(h, "a@b.c", "right-pw", map[string]string{"X-Forwarded-Proto": "https"})
	if rec.Code != 200 {
		t.Fatalf("login %d", rec.Code)
	}
	c := rec.Result().Cookies()
	if len(c) != 1 || c[0].Name != "kore_session" || !c[0].HttpOnly || !c[0].Secure || c[0].SameSite != http.SameSiteLaxMode {
		t.Fatalf("cookie %+v", c)
	}
	me := func() int {
		req := httptest.NewRequest("GET", "/api/auth/me", nil)
		req.AddCookie(c[0])
		r := httptest.NewRecorder()
		h.ServeHTTP(r, req)
		return r.Code
	}
	if me() != 200 {
		t.Fatal("me failed")
	}
	req := httptest.NewRequest("POST", "/api/auth/logout", nil)
	req.AddCookie(c[0])
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

func TestInsecureCookieOverHTTP(t *testing.T) {
	rec := login(setup(t), "a@b.c", "right-pw", nil)
	if c := rec.Result().Cookies(); len(c) != 1 || c[0].Secure {
		t.Fatalf("%+v", c)
	}
}
