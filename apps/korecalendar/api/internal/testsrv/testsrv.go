// Package testsrv starts an in-process API server for tests. It lives apart
// from testutil because it imports httpapi; tests that use it must be in an
// external test package (package httpapi_test) to avoid an import cycle.
package testsrv

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/httpapi"
	"github.com/qarasky/korecalendar/api/internal/testutil"
)

const (
	AdminEmail    = "admin@example.com"
	AdminPassword = "correct horse battery"
)

// New returns a running server over a fresh migrated database.
func New(t *testing.T) (*httptest.Server, *sql.DB) {
	t.Helper()
	db := testutil.NewDB(t)
	srv := httptest.NewServer(httpapi.New(db, t.TempDir()))
	t.Cleanup(srv.Close)
	return srv, db
}

// Resp is a recorded response.
type Resp struct {
	Status int
	Header http.Header
	Body   []byte
}

// Decode unmarshals the body into v.
func (r Resp) Decode(t *testing.T, v any) {
	t.Helper()
	if err := json.Unmarshal(r.Body, v); err != nil {
		t.Fatalf("decode %q: %v", r.Body, err)
	}
}

// ErrorCode returns error.code from an API error body, or "".
func (r Resp) ErrorCode() string {
	var e struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	json.Unmarshal(r.Body, &e)
	return e.Error.Code
}

// Do sends a request. body (if non-nil) is JSON-encoded; token (if non-empty)
// is sent as a bearer token; headers are "Key", "Value" pairs.
func Do(t *testing.T, srv *httptest.Server, token, method, path string, body any, headers ...string) Resp {
	t.Helper()
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, srv.URL+path, rd)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return Resp{Status: res.StatusCode, Header: res.Header, Body: b}
}

// Login returns a bearer token for the admin account, creating it through
// first-run setup if no user exists yet.
func Login(t *testing.T, srv *httptest.Server) string {
	t.Helper()
	creds := map[string]string{"email": AdminEmail, "password": AdminPassword}
	r := Do(t, srv, "", "POST", "/api/setup", creds)
	if r.Status != 201 {
		r = Do(t, srv, "", "POST", "/api/login", creds)
	}
	var out struct{ Token string }
	r.Decode(t, &out)
	if out.Token == "" {
		t.Fatalf("no token from setup/login: %d %s", r.Status, r.Body)
	}
	return out.Token
}

// AddUser creates a regular user through the admin API and returns a token for them.
func AddUser(t *testing.T, srv *httptest.Server, adminToken, email string) string {
	t.Helper()
	r := Do(t, srv, adminToken, "POST", "/api/admin/users", map[string]string{"email": email, "password": "another long password", "role": "user"})
	if r.Status != 201 {
		t.Fatalf("add user: %d %s", r.Status, r.Body)
	}
	r = Do(t, srv, "", "POST", "/api/login", map[string]string{"email": email, "password": "another long password"})
	var out struct{ Token string }
	r.Decode(t, &out)
	return out.Token
}

// DoRaw sends a request with a raw (non-JSON) body.
func DoRaw(t *testing.T, srv *httptest.Server, token, method, path, contentType string, body []byte) Resp {
	t.Helper()
	req, err := http.NewRequest(method, srv.URL+path, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", contentType)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return Resp{Status: res.StatusCode, Header: res.Header, Body: b}
}
