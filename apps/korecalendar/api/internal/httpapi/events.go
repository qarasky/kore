package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

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
	case errors.Is(err, events.ErrOccurrenceNotFound):
		errJSON(w, http.StatusNotFound, "not_found", "that date is not an occurrence of the event")
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

// editResponse is the series after an edit, plus the new series a "following"
// edit split off and any overrides a schedule change dropped.
type editResponse struct {
	events.Event
	Created *events.Event `json:"created,omitempty"`
	Dropped []string      `json:"dropped_overrides,omitempty"`
}

// scopeParams reads ?scope= and ?occurrence=.
func scopeParams(r *http.Request) (events.Scope, string) {
	return events.Scope(r.URL.Query().Get("scope")), r.URL.Query().Get("occurrence")
}

// ifMatch parses the optional If-Match header ("3", `"3"` or W/"3").
func ifMatch(w http.ResponseWriter, r *http.Request) (*int, bool) {
	h := strings.TrimSpace(r.Header.Get("If-Match"))
	if h == "" {
		return nil, true
	}
	h = strings.Trim(strings.TrimPrefix(h, "W/"), `"`)
	v, err := strconv.Atoi(h)
	if err != nil {
		errJSON(w, http.StatusBadRequest, "validation_error", "If-Match must be the event's ETag, such as \"3\"")
		return nil, false
	}
	return &v, true
}

func (s *server) handlePatchEvent(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Title      *string            `json:"title"`
		Notes      *string            `json:"notes"`
		Location   *string            `json:"location"`
		Start      *string            `json:"start"`
		End        *string            `json:"end"`
		TZ         *string            `json:"tz"`
		AllDay     *bool              `json:"all_day"`
		RRule      *string            `json:"rrule"`
		Reminders  *[]events.Reminder `json:"reminders"`
		CalendarID *string            `json:"calendar_id"`
	}
	im, ok := ifMatch(w, r)
	if !ok || !decode(w, r, &b) {
		return
	}
	scope, key := scopeParams(r)
	res, err := events.Update(r.Context(), s.db, actor(r), r.PathValue("id"), events.Patch{Title: b.Title, Notes: b.Notes, Location: b.Location,
		Start: b.Start, End: b.End, TZ: b.TZ, AllDay: b.AllDay, RRule: b.RRule, Reminders: b.Reminders, CalendarID: b.CalendarID}, scope, key, im)
	if err != nil {
		eventError(w, err)
		return
	}
	w.Header().Set("ETag", `"`+strconv.Itoa(res.Event.Version)+`"`)
	writeJSON(w, http.StatusOK, editResponse{Event: res.Event, Created: res.Created, Dropped: res.DroppedOverrides})
}

func (s *server) handleDeleteEvent(w http.ResponseWriter, r *http.Request) {
	im, ok := ifMatch(w, r)
	if !ok {
		return
	}
	scope, key := scopeParams(r)
	e, err := events.Delete(r.Context(), s.db, actor(r), r.PathValue("id"), scope, key, im)
	if err != nil {
		eventError(w, err)
		return
	}
	writeEvent(w, http.StatusOK, e)
}

func (s *server) handleRestoreEvent(w http.ResponseWriter, r *http.Request) {
	e, err := events.Restore(r.Context(), s.db, actor(r), r.PathValue("id"))
	if err != nil {
		eventError(w, err)
		return
	}
	writeEvent(w, http.StatusOK, e)
}
