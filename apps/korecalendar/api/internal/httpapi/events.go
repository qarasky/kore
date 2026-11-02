package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/qarasky/korecalendar/api/internal/auth"
	"github.com/qarasky/korecalendar/api/internal/events"
	"github.com/qarasky/korecalendar/api/internal/recur"
)

func actor(r *http.Request) events.Actor {
	p, _ := auth.FromContext(r.Context())
	return events.Actor{UserID: p.UserID, Label: p.Label()}
}

// eventError maps an events/recur error to the API's error response.
func eventError(w http.ResponseWriter, err error) {
	var ve *events.ValidationError
	switch {
	case errors.Is(err, events.ErrNotFound):
		errJSON(w, http.StatusNotFound, "not_found", "event not found")
	case errors.Is(err, recur.ErrUnsupportedRule):
		errJSON(w, http.StatusUnprocessableEntity, "unsupported_rrule", err.Error())
	case errors.As(err, &ve):
		errJSON(w, http.StatusUnprocessableEntity, "validation_error", ve.Msg)
	case errors.Is(err, events.ErrVersionConflict):
		errJSON(w, http.StatusPreconditionFailed, "version_conflict", "the event was changed since you read it; fetch it again")
	default:
		errJSON(w, http.StatusInternalServerError, "internal", "event operation failed")
	}
}

func writeEvent(w http.ResponseWriter, status int, e events.Event) {
	w.Header().Set("ETag", `"`+strconv.Itoa(e.Version)+`"`)
	writeJSON(w, status, e)
}

type eventBody struct {
	CalendarID string            `json:"calendar_id"`
	Title      string            `json:"title"`
	Notes      string            `json:"notes"`
	Location   string            `json:"location"`
	Start      string            `json:"start"`
	End        string            `json:"end"`
	TZ         string            `json:"tz"`
	AllDay     bool              `json:"all_day"`
	RRule      string            `json:"rrule"`
	RDates     []string          `json:"rdates"`
	Reminders  []events.Reminder `json:"reminders"`
}

func (s *server) handleCreateEvent(w http.ResponseWriter, r *http.Request) {
	var b eventBody
	if !decode(w, r, &b) {
		return
	}
	e, err := events.Create(r.Context(), s.db, actor(r), events.Input{CalendarID: b.CalendarID, Title: b.Title, Notes: b.Notes,
		Location: b.Location, Start: b.Start, End: b.End, TZ: b.TZ, RRule: b.RRule, AllDay: b.AllDay, RDates: b.RDates, Reminders: b.Reminders})
	if err != nil {
		eventError(w, err)
		return
	}
	writeEvent(w, http.StatusCreated, e)
}

func (s *server) handleGetEvent(w http.ResponseWriter, r *http.Request) {
	e, err := events.Get(r.Context(), s.db, actor(r).UserID, r.PathValue("id"))
	if err != nil {
		eventError(w, err)
		return
	}
	writeEvent(w, http.StatusOK, e)
}
