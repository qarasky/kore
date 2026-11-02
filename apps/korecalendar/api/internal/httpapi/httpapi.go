// Package httpapi builds KoreCalendar's HTTP router.
package httpapi

import (
	"database/sql"
	"net/http"
)

type server struct {
	db      *sql.DB
	dataDir string
}

// New returns the API handler. dataDir is the (already checked) volume.
func New(db *sql.DB, dataDir string) http.Handler {
	s := &server{db: db, dataDir: dataDir}
	return s.handler()
}

func (s *server) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	return mux
}
