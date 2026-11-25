package events

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/qarasky/korecalendar/api/internal/recur"
)

// Limits on a single occurrence query.
const (
	MaxOccurrences = 5000
	MaxRangeDays   = 400
)

// ErrRangeTooLarge means the range is longer than MaxRangeDays or produced
// more than the allowed number of occurrences.
var ErrRangeTooLarge = errors.New("range too large")

// OccQuery selects occurrences overlapping [From, To). Limit 0 means MaxOccurrences.
type OccQuery struct {
	From, To    time.Time
	CalendarIDs []string
	Text        string
	Limit       int
}

// Occurrence is one concrete instance of an event, with any override applied.
type Occurrence struct {
	EventID     string     `json:"event_id"`
	CalendarID  string     `json:"calendar_id"`
	Key         string     `json:"key"`
	Title       string     `json:"title"`
	Notes       string     `json:"notes"`
	Location    string     `json:"location"`
	Start       string     `json:"start"`
	End         string     `json:"end"`
	TZ          string     `json:"tz"`
	AllDay      bool       `json:"all_day"`
	IsRecurring bool       `json:"is_recurring"`
	IsOverride  bool       `json:"is_override"`
	StartUTC    time.Time  `json:"start_utc"`
	EndUTC      time.Time  `json:"end_utc"`
	Reminders   []Reminder `json:"reminders"`
}

func layoutFor(allDay bool) string {
	if allDay {
		return "2006-01-02"
	}
	return "2006-01-02T15:04:05"
}

// Occurrences expands the user's events over the range, applying exclusions
// and overrides, newest-start last. Series stay as rules in storage; this is
// the only place they become dates.
func Occurrences(ctx context.Context, db *sql.DB, userID string, q OccQuery) ([]Occurrence, error) {
	limit := q.Limit
	if limit <= 0 || limit > MaxOccurrences {
		limit = MaxOccurrences
	}
	from, to := q.From.UTC(), q.To.UTC()
	if !to.After(from) {
		return nil, invalid("to must be after from")
	}
	if to.Sub(from) > MaxRangeDays*24*time.Hour {
		return nil, ErrRangeTooLarge
	}
	evs, err := liveEvents(ctx, db, userID, q.CalendarIDs, from.Add(-48*time.Hour).Format(layoutFor(false)), to.Add(48*time.Hour).Format(layoutFor(false)))
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(evs))
	for i, e := range evs {
		ids[i] = e.ID
	}
	overrides, err := loadOverrides(ctx, db, ids)
	if err != nil {
		return nil, err
	}
	needle := strings.ToLower(strings.TrimSpace(q.Text))
	out := []Occurrence{}
	add := func(o Occurrence) error {
		if needle != "" && !strings.Contains(strings.ToLower(o.Title+"\n"+o.Notes+"\n"+o.Location), needle) {
			return nil
		}
		if len(out) >= limit {
			return ErrRangeTooLarge
		}
		out = append(out, o)
		return nil
	}
	for _, e := range evs {
		ovByKey := map[string]Override{}
		for _, o := range overrides[e.ID] {
			ovByKey[o.Key] = o
		}
		exdated := map[string]bool{}
		for _, k := range e.Exdates {
			exdated[k] = true
		}
		recurring := e.RRule != "" || len(e.RDates) > 0
		base, err := recur.Expand(e.Series(), from, to, limit)
		if err != nil {
			if errors.Is(err, recur.ErrTooManyOccurrences) {
				return nil, ErrRangeTooLarge
			}
			return nil, err
		}
		for _, b := range base {
			if _, has := ovByKey[b.Key]; has {
				continue // handled below, wherever it now sits
			}
			if err := add(Occurrence{EventID: e.ID, CalendarID: e.CalendarID, Key: b.Key, Title: e.Title, Notes: e.Notes, Location: e.Location,
				Start: b.Start, End: b.End, TZ: e.TZ, AllDay: e.AllDay, IsRecurring: recurring, StartUTC: b.StartUTC, EndUTC: b.EndUTC,
				Reminders: e.Reminders}); err != nil {
				return nil, err
			}
		}
		for _, ov := range ovByKey {
			if ov.Cancelled || exdated[ov.Key] {
				continue
			}
			o, ok := overrideOccurrence(e, ov, from, to)
			if !ok {
				continue
			}
			if err := add(o); err != nil {
				return nil, err
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if !a.StartUTC.Equal(b.StartUTC) {
			return a.StartUTC.Before(b.StartUTC)
		}
		if a.EventID != b.EventID {
			return a.EventID < b.EventID
		}
		return a.Key < b.Key
	})
	return out, nil
}

// overrideOccurrence applies ov to the series' occurrence and reports whether
// the result overlaps [from, to). A changed start without a changed end keeps
// the series' duration.
func overrideOccurrence(e Event, ov Override, from, to time.Time) (Occurrence, bool) {
	allDay := e.AllDay
	if ov.AllDay != nil {
		allDay = *ov.AllDay
	}
	layout := layoutFor(allDay)
	masterStart, err1 := time.Parse(layoutFor(e.AllDay), e.Start)
	masterEnd, err2 := time.Parse(layoutFor(e.AllDay), e.End)
	if err1 != nil || err2 != nil {
		return Occurrence{}, false
	}
	start := ov.Key
	if ov.Start != nil {
		start = *ov.Start
	}
	startT, err := time.Parse(layout, start)
	if err != nil {
		return Occurrence{}, false
	}
	end := startT.Add(masterEnd.Sub(masterStart)).Format(layout)
	if ov.End != nil {
		end = *ov.End
	}
	got, err := recur.Expand(recur.Series{Start: start, End: end, TZ: e.TZ, AllDay: allDay}, from, to, 2)
	if err != nil || len(got) == 0 {
		return Occurrence{}, false
	}
	o := Occurrence{EventID: e.ID, CalendarID: e.CalendarID, Key: ov.Key, Title: e.Title, Notes: e.Notes, Location: e.Location,
		Start: got[0].Start, End: got[0].End, TZ: e.TZ, AllDay: allDay, IsRecurring: true, IsOverride: true,
		StartUTC: got[0].StartUTC, EndUTC: got[0].EndUTC, Reminders: e.Reminders}
	if ov.Title != nil {
		o.Title = *ov.Title
	}
	if ov.Notes != nil {
		o.Notes = *ov.Notes
	}
	if ov.Location != nil {
		o.Location = *ov.Location
	}
	if ov.Reminders != nil {
		o.Reminders = *ov.Reminders
	}
	return o, true
}
