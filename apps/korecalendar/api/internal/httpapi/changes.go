package httpapi

import (
	"net/http"
	"strconv"

	"github.com/qarasky/korecalendar/api/internal/events"
)

func (s *server) handleChanges(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var since int64
	var limit int
	if v := q.Get("since"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			errJSON(w, http.StatusUnprocessableEntity, "validation_error", "since must be a cursor returned by an earlier call (or 0)")
			return
		}
		since = n
	}
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			errJSON(w, http.StatusUnprocessableEntity, "validation_error", "limit must be a positive number up to 1000")
			return
		}
		limit = n
	}
	cs, err := events.Changes(r.Context(), s.db, actor(r).UserID, since, limit)
	if err != nil {
		errJSON(w, http.StatusInternalServerError, "internal", "could not read changes")
		return
	}
	writeJSON(w, http.StatusOK, cs)
}
