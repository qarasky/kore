package httpapi

import (
	"errors"
	"net/http"

	"github.com/qarasky/korecalendar/api/internal/auth"
	"github.com/qarasky/korecalendar/api/internal/calendars"
)

func calendarError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, calendars.ErrNotFound):
		errJSON(w, http.StatusNotFound, "not_found", "calendar not found")
	case errors.Is(err, calendars.ErrNotEmpty):
		errJSON(w, http.StatusConflict, "calendar_not_empty", "the calendar still has events; add ?force=1 to delete it and its events permanently")
	case errors.Is(err, calendars.ErrValidation):
		errJSON(w, http.StatusUnprocessableEntity, "validation_error", "name must be 1-100 characters and color like #5b8def")
	default:
		errJSON(w, http.StatusInternalServerError, "internal", "calendar operation failed")
	}
}

func (s *server) handleListCalendars(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	list, err := calendars.List(r.Context(), s.db, p.UserID)
	if err != nil {
		calendarError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *server) handleCreateCalendar(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var in struct{ Name, Color string }
	if !decode(w, r, &in) {
		return
	}
	c, err := calendars.Create(r.Context(), s.db, p.UserID, in.Name, in.Color)
	if err != nil {
		calendarError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (s *server) handlePatchCalendar(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var in struct{ Name, Color *string }
	if !decode(w, r, &in) {
		return
	}
	c, err := calendars.Update(r.Context(), s.db, p.UserID, r.PathValue("id"), in.Name, in.Color)
	if err != nil {
		calendarError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *server) handleDeleteCalendar(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if err := calendars.Delete(r.Context(), s.db, p.UserID, r.PathValue("id"), r.URL.Query().Get("force") == "1"); err != nil {
		calendarError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
