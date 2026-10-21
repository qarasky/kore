package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
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

func TestConcurrentBadLoginsLimited(t *testing.T) {
	h := setup(t)
	var mu sync.Mutex
	counts := map[int]int{}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c := login(h, "a@b.c", "bad", nil).Code
			mu.Lock()
			counts[c]++
			mu.Unlock()
		}()
	}
	wg.Wait()
	if counts[401] != 5 || counts[429] != 15 {
		t.Fatalf("got %v", counts)
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
