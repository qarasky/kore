package httpapi_test

import (
	"net/http/httptest"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/testsrv"
)

type reminder struct {
	MinutesBefore int `json:"minutes_before"`
}

type event struct {
	ID         string     `json:"id"`
	CalendarID string     `json:"calendar_id"`
	Title      string     `json:"title"`
	Notes      string     `json:"notes"`
	Location   string     `json:"location"`
	Start      string     `json:"start"`
	End        string     `json:"end"`
	TZ         string     `json:"tz"`
	AllDay     bool       `json:"all_day"`
	RRule      string     `json:"rrule"`
	RDates     []string   `json:"rdates"`
	Exdates    []string   `json:"exdates"`
	Reminders  []reminder `json:"reminders"`
	Version    int        `json:"version"`
	CreatedBy  string     `json:"created_by"`
	UpdatedBy  string     `json:"updated_by"`
}

// mkEvent creates an event and fails the test unless it answers 201.
func mkEvent(t *testing.T, srv *httptest.Server, tok string, body map[string]any, hdr ...string) event {
	t.Helper()
	r := testsrv.Do(t, srv, tok, "POST", "/api/events", body, hdr...)
	if r.Status != 201 {
		t.Fatalf("create event: %d %s", r.Status, r.Body)
	}
	var e event
	r.Decode(t, &e)
	return e
}

func weekly(title string) map[string]any {
	return map[string]any{"title": title, "start": "2026-11-04T16:00:00", "end": "2026-11-04T17:00:00",
		"tz": "Europe/Berlin", "rrule": "FREQ=WEEKLY;BYDAY=WE,FR"}
}
