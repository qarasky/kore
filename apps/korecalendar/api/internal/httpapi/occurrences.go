package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/qarasky/korecalendar/api/internal/events"
)

func (s *server) handleOccurrences(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, err1 := time.Parse(time.RFC3339, q.Get("from"))
	to, err2 := time.Parse(time.RFC3339, q.Get("to"))
	if err1 != nil || err2 != nil {
		errJSON(w, http.StatusUnprocessableEntity, "validation_error", "from and to are required, as RFC 3339 times such as 2026-11-04T00:00:00Z")
		return
	}
	occ, err := events.Occurrences(r.Context(), s.db, actor(r).UserID, events.OccQuery{From: from, To: to, CalendarIDs: q["calendar_id"], Text: q.Get("q")})
	if errors.Is(err, events.ErrRangeTooLarge) {
		errJSON(w, http.StatusBadRequest, "range_too_large", "ask for at most 400 days and 5000 occurrences at a time")
		return
	}
	if err != nil {
		eventError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, occ)
}
