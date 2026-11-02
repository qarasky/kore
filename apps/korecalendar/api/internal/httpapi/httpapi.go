// Package httpapi builds KoreCalendar's HTTP router.
package httpapi

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/qarasky/korecalendar/api/internal/auth"
)

type server struct {
	db      *sql.DB
	dataDir string
	limiter *auth.Limiter // login attempts per email|IP
	ipLimit *auth.Limiter // login attempts per client IP across all emails
}

// New returns the API handler. dataDir is the (already checked) volume.
func New(db *sql.DB, dataDir string) http.Handler {
	s := &server{db: db, dataDir: dataDir,
		limiter: auth.NewLimiter(5, 15*time.Minute),
		ipLimit: auth.NewLimiter(30, 15*time.Minute)}
	return s.handler()
}

func (s *server) handler() http.Handler {
	mux := http.NewServeMux()
	require := auth.Require(s.db)
	authed := func(h http.HandlerFunc) http.Handler { return require(h) }
	admin := func(h http.HandlerFunc) http.Handler { return require(auth.RequireAdmin(h)) }

	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/setup", s.handleSetup)
	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.Handle("POST /api/logout", authed(s.handleLogout))
	mux.Handle("GET /api/me", authed(s.handleMe))
	mux.Handle("PATCH /api/me", authed(s.handlePatchMe))
	mux.Handle("POST /api/admin/users", admin(s.handleAdminCreateUser))
	return mux
}
