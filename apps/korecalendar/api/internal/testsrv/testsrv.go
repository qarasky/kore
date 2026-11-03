// Package testsrv starts an in-process API server for tests. It lives apart
// from testutil because it imports httpapi; tests that use it must be in an
// external test package (package httpapi_test) to avoid an import cycle.
package testsrv

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/qarasky/korecalendar/api/internal/auth"
	"github.com/qarasky/korecalendar/api/internal/calendars"
	"github.com/qarasky/korecalendar/api/internal/httpapi"
	"github.com/qarasky/korecalendar/api/internal/testutil"
	"github.com/qarasky/korecalendar/api/internal/users"
)

const (
	AdminEmail = "admin@example.com"
	// AdminPassword is a placeholder no account has: password sign-in is gone,
	// and tests assert that it is refused (e.g. CalDAV Basic auth).
	AdminPassword = "correct horse battery"
)

// servers maps a test server's URL to its database, so Login can seed an
// account and a session without every caller passing the handle around.
var servers sync.Map

// New returns a running server over a fresh migrated database.
func New(t *testing.T) (*httptest.Server, *sql.DB) {
	t.Helper()
	db := testutil.NewDB(t)
	srv := httptest.NewServer(httpapi.New(db, t.TempDir()))
	servers.Store(srv.URL, db)
	t.Cleanup(func() { servers.Delete(srv.URL); srv.Close() })
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

func dbFor(t *testing.T, srv *httptest.Server) *sql.DB {
	t.Helper()
	v, ok := servers.Load(srv.URL)
	if !ok {
		t.Fatalf("testsrv: unknown server %s (use testsrv.New)", srv.URL)
	}
	return v.(*sql.DB)
}

// CreateUser inserts a local account with a default calendar and returns it.
// It is how tests model an account that exists before (or without) Kore ID.
func CreateUser(t *testing.T, db *sql.DB, email, role string) users.User {
	t.Helper()
	ctx := context.Background()
	u, err := users.Create(ctx, db, email, role)
	if err != nil {
		t.Fatalf("create user %s: %v", email, err)
	}
	if _, err := calendars.CreateDefault(ctx, db, u.ID); err != nil {
		t.Fatalf("default calendar for %s: %v", email, err)
	}
	return u
}

// Session returns a bearer token for an existing user.
func Session(t *testing.T, db *sql.DB, userID string) string {
	t.Helper()
	tok, err := auth.NewSession(context.Background(), db, userID, time.Hour)
	if err != nil {
		t.Fatalf("session: %v", err)
	}
	return tok
}

// Login returns a bearer token for the admin account, creating it (and its
// default calendar) if it does not exist yet. No password is involved.
func Login(t *testing.T, srv *httptest.Server) string {
	t.Helper()
	db := dbFor(t, srv)
	u, _, err := users.GetLinkByEmail(context.Background(), db, AdminEmail)
	if err == users.ErrNotFound {
		u = CreateUser(t, db, AdminEmail, "admin")
	} else if err != nil {
		t.Fatalf("find admin: %v", err)
	}
	return Session(t, db, u.ID)
}

// AddUser creates a regular user and returns a token for them. adminToken is
// accepted for call-site compatibility; accounts no longer need an admin to
// create them (Kore ID auto-provisions on first sign-in).
func AddUser(t *testing.T, srv *httptest.Server, adminToken, email string) string {
	t.Helper()
	u := CreateUser(t, dbFor(t, srv), email, "user")
	return Session(t, dbFor(t, srv), u.ID)
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
