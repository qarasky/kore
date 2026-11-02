package httpapi_test

import (
	"net/http"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/testsrv"
)

func TestSetupOnlyOnce(t *testing.T) {
	srv, _ := testsrv.New(t)
	creds := map[string]string{"email": "a@example.com", "password": "long enough pw"}
	if r := testsrv.Do(t, srv, "", "POST", "/api/setup", creds); r.Status != 201 {
		t.Fatalf("first setup: %d %s", r.Status, r.Body)
	}
	r := testsrv.Do(t, srv, "", "POST", "/api/setup", creds)
	if r.Status != 409 || r.ErrorCode() != "setup_closed" {
		t.Fatalf("second setup: %d %s", r.Status, r.Body)
	}
}

func TestSetupRejectsShortPassword(t *testing.T) {
	srv, _ := testsrv.New(t)
	r := testsrv.Do(t, srv, "", "POST", "/api/setup", map[string]string{"email": "a@example.com", "password": "short"})
	if r.Status != 422 || r.ErrorCode() != "validation_error" {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
}

func TestLoginWrongPasswordAndUnknownEmailSameResponse(t *testing.T) {
	srv, _ := testsrv.New(t)
	testsrv.Login(t, srv)
	a := testsrv.Do(t, srv, "", "POST", "/api/login", map[string]string{"email": testsrv.AdminEmail, "password": "wrong password!"})
	b := testsrv.Do(t, srv, "", "POST", "/api/login", map[string]string{"email": "nobody@example.com", "password": "wrong password!"})
	if a.Status != 401 || b.Status != 401 || a.ErrorCode() != "bad_credentials" || string(a.Body) != string(b.Body) {
		t.Fatalf("a=%d %s b=%d %s", a.Status, a.Body, b.Status, b.Body)
	}
}

func TestLoginRateLimited(t *testing.T) {
	srv, _ := testsrv.New(t)
	testsrv.Login(t, srv)
	creds := map[string]string{"email": testsrv.AdminEmail, "password": "wrong password!"}
	for i := 0; i < 5; i++ {
		if r := testsrv.Do(t, srv, "", "POST", "/api/login", creds); r.Status != 401 {
			t.Fatalf("attempt %d: %d", i+1, r.Status)
		}
	}
	r := testsrv.Do(t, srv, "", "POST", "/api/login", creds)
	if r.Status != 429 || r.ErrorCode() != "rate_limited" {
		t.Fatalf("6th attempt: %d %s", r.Status, r.Body)
	}
	var e struct {
		Error struct {
			RetryAfterSec int `json:"retryAfterSec"`
		} `json:"error"`
	}
	r.Decode(t, &e)
	if e.Error.RetryAfterSec <= 0 || r.Header.Get("Retry-After") == "" {
		t.Fatalf("missing retry info: %s %v", r.Body, r.Header)
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

func TestAdminUsersHiddenFromNonAdmin(t *testing.T) {
	srv, _ := testsrv.New(t)
	admin := testsrv.Login(t, srv)
	user := testsrv.AddUser(t, srv, admin, "u@example.com")
	r := testsrv.Do(t, srv, user, "POST", "/api/admin/users", map[string]string{"email": "x@example.com", "password": "long enough pw", "role": "user"})
	if r.Status != 404 || r.ErrorCode() != "not_found" {
		t.Fatalf("non-admin: %d %s", r.Status, r.Body)
	}
	dup := testsrv.Do(t, srv, admin, "POST", "/api/admin/users", map[string]string{"email": "u@example.com", "password": "long enough pw", "role": "user"})
	if dup.Status != 409 || dup.ErrorCode() != "email_taken" {
		t.Fatalf("duplicate: %d %s", dup.Status, dup.Body)
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

func TestSessionCookieSecureOnlyWhenForwardedHTTPS(t *testing.T) {
	srv, _ := testsrv.New(t)
	creds := map[string]string{"email": testsrv.AdminEmail, "password": testsrv.AdminPassword}
	r := testsrv.Do(t, srv, "", "POST", "/api/setup", creds)
	plain := (&http.Response{Header: r.Header}).Cookies()
	if len(plain) != 1 || plain[0].Name != "korecal_session" || !plain[0].HttpOnly || plain[0].Secure || plain[0].SameSite != http.SameSiteLaxMode {
		t.Fatalf("plain cookie: %+v", plain)
	}
	r = testsrv.Do(t, srv, "", "POST", "/api/login", creds, "X-Forwarded-Proto", "https")
	secure := (&http.Response{Header: r.Header}).Cookies()
	if len(secure) != 1 || !secure[0].Secure {
		t.Fatalf("https cookie: %+v", secure)
	}
	// the cookie alone authenticates
	req, _ := http.NewRequest("GET", srv.URL+"/api/me", nil)
	req.AddCookie(plain[0])
	res, err := http.DefaultClient.Do(req)
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("cookie auth: %v %v", err, res)
	}
	res.Body.Close()
}
