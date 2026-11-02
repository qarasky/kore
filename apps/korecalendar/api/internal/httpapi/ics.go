package httpapi

import (
	"bytes"
	"errors"
	"io"
	"net/http"

	"github.com/qarasky/korecalendar/api/internal/calendars"
	"github.com/qarasky/korecalendar/api/internal/events"
	"github.com/qarasky/korecalendar/api/internal/ics"
	"github.com/qarasky/korecalendar/api/internal/recur"
	"github.com/qarasky/korecalendar/api/internal/users"
)

const maxICSBytes = 5 << 20

// calendarParam checks ?calendar_id= belongs to the caller; "" means none given.
func (s *server) calendarParam(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.URL.Query().Get("calendar_id")
	if id == "" {
		return "", true
	}
	if _, err := calendars.Get(r.Context(), s.db, actor(r).UserID, id); err != nil {
		if errors.Is(err, calendars.ErrNotFound) {
			errJSON(w, http.StatusNotFound, "not_found", "calendar not found")
		} else {
			errJSON(w, http.StatusInternalServerError, "internal", "could not read the calendar")
		}
		return "", false
	}
	return id, true
}

func (s *server) handleImport(w http.ResponseWriter, r *http.Request) {
	calID, ok := s.calendarParam(w, r)
	if !ok {
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxICSBytes))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			errJSON(w, http.StatusRequestEntityTooLarge, "payload_too_large", "the .ics file is larger than 5 MB")
		} else {
			errJSON(w, http.StatusBadRequest, "invalid_json", "the request body could not be read")
		}
		return
	}
	a := actor(r)
	u, err := users.Get(r.Context(), s.db, a.UserID)
	if err != nil {
		errJSON(w, http.StatusUnauthorized, "unauthorized", "authentication required")
		return
	}
	items, errs, warns, err := ics.Parse(bytes.NewReader(data), u.Timezone)
	if err != nil {
		errJSON(w, http.StatusUnprocessableEntity, "validation_error", "the body is not a valid iCalendar (.ics) file")
		return
	}
	created, updated := 0, 0
	for _, it := range items {
		res, err := events.Import(r.Context(), s.db, a, calID, events.Imported{UID: it.UID, Input: it.Input, Exdates: it.Exdates, Overrides: it.Overrides})
		if err != nil {
			var ve *events.ValidationError
			switch {
			case errors.Is(err, events.ErrNotFound):
				errJSON(w, http.StatusNotFound, "not_found", "calendar not found")
				return
			case errors.As(err, &ve):
				errs = append(errs, ics.Issue{Index: it.Index, UID: it.UID, Reason: ve.Msg})
			case errors.Is(err, recur.ErrUnsupportedRule):
				errs = append(errs, ics.Issue{Index: it.Index, UID: it.UID, Reason: err.Error()})
			default:
				errJSON(w, http.StatusInternalServerError, "internal", "import failed")
				return
			}
			continue
		}
		if res.Created {
			created++
		} else {
			updated++
		}
		for _, k := range res.SkippedOverrides {
			warns = append(warns, ics.Issue{Index: it.Index, UID: it.UID, Reason: "changed occurrence " + k + " is not an occurrence of the series; ignored"})
		}
	}
	if errs == nil {
		errs = []ics.Issue{}
	}
	if warns == nil {
		warns = []ics.Issue{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"imported": created + updated, "created": created, "updated": updated, "errors": errs, "warnings": warns})
}

func (s *server) handleExport(w http.ResponseWriter, r *http.Request) {
	calID, ok := s.calendarParam(w, r)
	if !ok {
		return
	}
	var ids []string
	if calID != "" {
		ids = []string{calID}
	}
	evs, ovs, err := events.ListForExport(r.Context(), s.db, actor(r).UserID, ids)
	if err != nil {
		errJSON(w, http.StatusInternalServerError, "internal", "export failed")
		return
	}
	data, err := ics.Export(evs, ovs)
	if err != nil {
		errJSON(w, http.StatusInternalServerError, "internal", "export failed")
		return
	}
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="korecalendar.ics"`)
	w.Write(data)
}
