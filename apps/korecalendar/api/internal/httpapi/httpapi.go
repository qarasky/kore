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

type access int

// Who may call a route. Anyone; any signed-in caller (session or access
// token); a signed-in session only (tokens get 403, so a leaked agent token
// cannot mint tokens); an admin (anyone else gets 404, hiding the route).
const (
	accessPublic access = iota
	accessUser
	accessSession
	accessAdmin
)

func (a access) String() string {
	return [...]string{"public", "user", "session", "admin"}[a]
}

type route struct {
	pattern string // "METHOD /path/{id}", as registered on the mux
	access  access
	h       http.HandlerFunc
}

// routes is the one list of endpoints. docs/openapi.yaml must describe each of
// them (a test enforces it).
func (s *server) routes() []route {
	return []route{
		{"GET /api/healthz", accessPublic, func(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, map[string]bool{"ok": true}) }},
		{"GET /api/openapi.json", accessPublic, s.handleOpenAPI},
		{"GET /api/setup", accessPublic, s.handleSetupStatus},
		{"POST /api/setup", accessPublic, s.handleSetup},
		{"POST /api/login", accessPublic, s.handleLogin},
		{"POST /api/logout", accessUser, s.handleLogout},
		{"GET /api/me", accessUser, s.handleMe},
		{"PATCH /api/me", accessUser, s.handlePatchMe},
		{"GET /api/tokens", accessSession, s.handleListTokens},
		{"POST /api/tokens", accessSession, s.handleCreateToken},
		{"DELETE /api/tokens/{id}", accessSession, s.handleRevokeToken},
		{"GET /api/calendars", accessUser, s.handleListCalendars},
		{"POST /api/calendars", accessUser, s.handleCreateCalendar},
		{"PATCH /api/calendars/{id}", accessUser, s.handlePatchCalendar},
		{"DELETE /api/calendars/{id}", accessUser, s.handleDeleteCalendar},
		{"POST /api/calendars/{id}/restore", accessUser, s.handleRestoreCalendar},
		{"POST /api/events", accessUser, s.idempotent(s.handleCreateEvent)},
		{"GET /api/events/{id}", accessUser, s.handleGetEvent},
		{"PATCH /api/events/{id}", accessUser, s.handlePatchEvent},
		{"DELETE /api/events/{id}", accessUser, s.handleDeleteEvent},
		{"POST /api/events/{id}/restore", accessUser, s.handleRestoreEvent},
		{"GET /api/occurrences", accessUser, s.handleOccurrences},
		{"POST /api/import", accessUser, s.handleImport},
		{"GET /api/export", accessUser, s.handleExport},
		{"GET /api/changes", accessUser, s.handleChanges},
		{"GET /api/push/key", accessUser, s.handlePushKey},
		{"POST /api/push/subscriptions", accessUser, s.handleSubscribe},
		{"DELETE /api/push/subscriptions/{id}", accessUser, s.handleUnsubscribe},
		{"POST /api/admin/users", accessAdmin, s.handleAdminCreateUser},
	}
}

// Routes lists every registered "METHOD /path" pattern.
func Routes() []string {
	var out []string
	for _, r := range (&server{}).routes() {
		out = append(out, r.pattern)
	}
	return out
}

func (s *server) handler() http.Handler {
	mux := http.NewServeMux()
	require := auth.Require(s.db)
	for _, r := range s.routes() {
		var h http.Handler = r.h
		switch r.access {
		case accessUser:
			h = require(h)
		case accessSession:
			h = require(auth.RequireSession(h))
		case accessAdmin:
			h = require(auth.RequireAdmin(h))
		}
		mux.Handle(r.pattern, h)
	}
	return mux
}
