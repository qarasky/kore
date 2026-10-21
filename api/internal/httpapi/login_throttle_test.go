package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/artchsh/kore/api/internal/auth"
)

func TestLoginPerIPLimitAcrossEmails(t *testing.T) {
	h := setup(t)
	for i := 1; i <= 30; i++ {
		if rec := login(h, fmt.Sprintf("nobody%d@x.io", i), "bad", nil); rec.Code != 401 {
			t.Fatalf("attempt %d: %d %s", i, rec.Code, rec.Body)
		}
	}
	rec := login(h, "nobody31@x.io", "bad", nil)
	if rec.Code != 429 || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("31st attempt: %d %s", rec.Code, rec.Body)
	}
	if m := jsonBodyRaw(t, rec.Body.Bytes()); m["error"] != "too_many_attempts" {
		t.Fatalf("body %v", m)
	}
	// Another client IP is unaffected.
	if rec := loginFrom(h, "9.9.9.9:1", "a@b.c", "right-pw"); rec.Code != 200 {
		t.Fatalf("other ip: %d", rec.Code)
	}
}

func TestLoginSuccessDoesNotClearIPBucket(t *testing.T) {
	h := setup(t)
	for i := 1; i <= 29; i++ {
		if rec := login(h, fmt.Sprintf("nobody%d@x.io", i), "bad", nil); rec.Code != 401 {
			t.Fatalf("attempt %d: %d", i, rec.Code)
		}
	}
	if rec := login(h, "a@b.c", "right-pw", nil); rec.Code != 200 {
		t.Fatalf("login: %d", rec.Code)
	}
	// The success is forgiven, the 29 failures are not: one more failure is
	// allowed, then the IP is blocked.
	if rec := login(h, "nobody30@x.io", "bad", nil); rec.Code != 401 {
		t.Fatalf("30th: %d", rec.Code)
	}
	if rec := login(h, "nobody31@x.io", "bad", nil); rec.Code != 429 {
		t.Fatalf("31st: %d", rec.Code)
	}
}

func TestLoginBusyIs503(t *testing.T) {
	h := setup(t)
	restore := auth.SetHashConcurrencyForTest(0, 10*time.Millisecond)
	defer restore()
	rec := login(h, "a@b.c", "right-pw", nil)
	if rec.Code != 503 || rec.Header().Get("Retry-After") != "2" {
		t.Fatalf("got %d %q %s", rec.Code, rec.Header().Get("Retry-After"), rec.Body)
	}
	if m := jsonBodyRaw(t, rec.Body.Bytes()); m["error"] != "busy" {
		t.Fatalf("body %v", m)
	}
}

func TestPasswordPathsBusyIs503(t *testing.T) {
	e := newEnv(t)
	restore := auth.SetHashConcurrencyForTest(0, 10*time.Millisecond)
	defer restore()
	check := func(name string, code int, body []byte, retry string) {
		t.Helper()
		if code != 503 || retry != "2" || jsonBodyRaw(t, body)["error"] != "busy" {
			t.Fatalf("%s: %d %q %s", name, code, retry, body)
		}
	}
	rec := e.do(t, &e.admin, "POST", "/api/admin/users", `{"email":"n@x.io","password":"password-2","role":"user"}`)
	check("create", rec.Code, rec.Body.Bytes(), rec.Header().Get("Retry-After"))
	rec = e.do(t, &e.admin, "POST", "/api/admin/users/"+e.user.ID+"/password", `{"new_password":"password-2"}`)
	check("reset", rec.Code, rec.Body.Bytes(), rec.Header().Get("Retry-After"))
	rec = e.do(t, &e.user, "POST", "/api/me/password", `{"current_password":"password-1","new_password":"password-2"}`)
	check("change", rec.Code, rec.Body.Bytes(), rec.Header().Get("Retry-After"))
}

func loginFrom(h http.Handler, remote, email, pw string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"email":"`+email+`","password":"`+pw+`"}`))
	req.RemoteAddr = remote
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func jsonBodyRaw(t *testing.T, b []byte) map[string]any {
	t.Helper()
	m := map[string]any{}
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("body %q: %v", b, err)
	}
	return m
}
