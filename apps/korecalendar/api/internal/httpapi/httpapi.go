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
	sessionOnly := func(h http.HandlerFunc) http.Handler { return require(auth.RequireSession(h)) }
	admin := func(h http.HandlerFunc) http.Handler { return require(auth.RequireAdmin(h)) }

	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/setup", s.handleSetup)
	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.Handle("POST /api/logout", authed(s.handleLogout))
	mux.Handle("GET /api/me", authed(s.handleMe))
	mux.Handle("PATCH /api/me", authed(s.handlePatchMe))
	mux.Handle("GET /api/tokens", sessionOnly(s.handleListTokens))
	mux.Handle("POST /api/tokens", sessionOnly(s.handleCreateToken))
	mux.Handle("DELETE /api/tokens/{id}", sessionOnly(s.handleRevokeToken))
	mux.Handle("GET /api/calendars", authed(s.handleListCalendars))
	mux.Handle("POST /api/calendars", authed(s.handleCreateCalendar))
	mux.Handle("PATCH /api/calendars/{id}", authed(s.handlePatchCalendar))
	mux.Handle("DELETE /api/calendars/{id}", authed(s.handleDeleteCalendar))
	mux.Handle("POST /api/events", authed(s.idempotent(s.handleCreateEvent)))
	mux.Handle("GET /api/events/{id}", authed(s.handleGetEvent))
	mux.Handle("PATCH /api/events/{id}", authed(s.handlePatchEvent))
	mux.Handle("DELETE /api/events/{id}", authed(s.handleDeleteEvent))
	mux.Handle("POST /api/events/{id}/restore", authed(s.handleRestoreEvent))
	mux.Handle("GET /api/occurrences", authed(s.handleOccurrences))
	mux.Handle("GET /api/changes", authed(s.handleChanges))
	mux.Handle("GET /api/push/key", authed(s.handlePushKey))
	mux.Handle("POST /api/push/subscriptions", authed(s.handleSubscribe))
	mux.Handle("DELETE /api/push/subscriptions/{id}", authed(s.handleUnsubscribe))
	mux.Handle("POST /api/admin/users", admin(s.handleAdminCreateUser))
	return mux
}
