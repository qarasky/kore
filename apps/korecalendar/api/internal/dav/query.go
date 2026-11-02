package dav

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/emersion/go-webdav/caldav"
	"github.com/qarasky/korecalendar/api/internal/events"
)

// maxWindows bounds how many REST-sized windows a very wide range is split
// into before the query gives up narrowing and answers with the whole calendar.
const maxWindows = 60

// stripTimeRange copies f without the time range of its VEVENT filter and
// returns that range; the range is resolved by eventsInRange instead of the
// library's own expansion.
func stripTimeRange(f caldav.CompFilter) (caldav.CompFilter, time.Time, time.Time) {
	var from, to time.Time
	out := f
	out.Comps = make([]caldav.CompFilter, len(f.Comps))
	for i, c := range f.Comps {
		if c.Name == "VEVENT" && !c.Start.IsZero() {
			from, to = c.Start, c.End
			c.Start, c.End = time.Time{}, time.Time{}
		}
		out.Comps[i] = c
	}
	return out, from, to
}

// eventsInRange is the set of event ids with at least one occurrence in
// [from, to). An open end means "from now on" (a year). A range too wide to
// expand, or a window with more occurrences than one query allows, answers nil
// ("every event"): extra resources are harmless to a client that filters.
func eventsInRange(ctx context.Context, db *sql.DB, userID, calID string, from, to time.Time) (map[string]bool, error) {
	if to.IsZero() || !to.After(from) {
		to = from.Add(365 * 24 * time.Hour)
	}
	step := time.Duration(events.MaxRangeDays) * 24 * time.Hour
	if to.Sub(from) > step*maxWindows {
		return nil, nil
	}
	ids := map[string]bool{}
	for start := from; start.Before(to); start = start.Add(step) {
		end := start.Add(step)
		if end.After(to) {
			end = to
		}
		occ, err := events.Occurrences(ctx, db, userID, events.OccQuery{From: start, To: end, CalendarIDs: []string{calID}})
		if errors.Is(err, events.ErrRangeTooLarge) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		for _, o := range occ {
			ids[o.EventID] = true
		}
	}
	return ids, nil
}
