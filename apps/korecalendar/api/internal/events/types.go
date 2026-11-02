// Package events stores events and recurring series, and implements scoped
// edits, occurrence expansion and the sync change feed.
package events

import (
	"errors"

	"github.com/qarasky/korecalendar/api/internal/recur"
)

// Errors returned by this package.
var (
	ErrNotFound        = errors.New("event not found")
	ErrVersionConflict = errors.New("event was changed by someone else")
	ErrValidation      = errors.New("invalid event")
)

// ValidationError carries a human-readable reason; it matches ErrValidation.
type ValidationError struct{ Msg string }

func (e *ValidationError) Error() string        { return e.Msg }
func (e *ValidationError) Is(target error) bool { return target == ErrValidation }

func invalid(msg string) error { return &ValidationError{Msg: msg} }

// MaxReminderMinutes is the longest reminder lead time (28 days).
const MaxReminderMinutes = 40320

// maxReminders caps reminders per event.
const maxReminders = 20

// Reminder fires MinutesBefore minutes before an occurrence starts.
type Reminder struct {
	MinutesBefore int `json:"minutes_before"`
}

// Event is a single event or a recurring series (the master).
type Event struct {
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
	Reminders  []Reminder `json:"reminders"`
	Version    int        `json:"version"`
	ICSUID     string     `json:"ics_uid,omitempty"` // UID of the .ics event this was imported from
	CreatedBy  string     `json:"created_by"`
	UpdatedBy  string     `json:"updated_by"`
	CreatedAt  int64      `json:"created_at"`
	UpdatedAt  int64      `json:"updated_at"`
	DeletedAt  *int64     `json:"deleted_at,omitempty"`
}

// Series returns the recurrence view of the event.
func (e Event) Series() recur.Series {
	return recur.Series{Start: e.Start, End: e.End, TZ: e.TZ, AllDay: e.AllDay, RRule: e.RRule, RDates: e.RDates, Exdates: e.Exdates}
}

// Input is what a client supplies to create an event. Empty CalendarID means
// the user's first calendar, empty TZ the user's time zone, empty End one hour
// (timed) or one day (all-day) after Start.
type Input struct {
	CalendarID, Title, Notes, Location string
	Start, End, TZ, RRule              string
	AllDay                             bool
	RDates                             []string
	Reminders                          []Reminder
}

// Actor is who makes a change. Label is "user" for sessions and the token's
// name for access tokens.
type Actor struct{ UserID, Label string }
