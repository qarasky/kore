// Package reminders works out which reminders are due and delivers them
// exactly once per channel, surviving restarts.
package reminders

import (
	"context"
	"database/sql"
	"sort"
	"strconv"
	"time"

	"github.com/qarasky/korecalendar/api/internal/events"
)

const (
	maxOffset = time.Duration(events.MaxReminderMinutes) * time.Minute
	chunk     = 7 * 24 * time.Hour
)

// Due is one reminder of one occurrence that should fire.
type Due struct {
	UserID, EventID, Key, Title, Start string
	StartUTC, FireAt                   time.Time
	MinutesBefore                      int
}

// reference is the instant reminders count back from: the occurrence's start,
// or for an all-day event midnight at the start of its first day in the
// event's own zone.
func reference(o events.Occurrence) time.Time {
	if !o.AllDay {
		return o.StartUTC
	}
	loc, err := time.LoadLocation(o.TZ)
	if err != nil {
		return o.StartUTC
	}
	d, err := time.ParseInLocation("2006-01-02", o.Start, loc)
	if err != nil {
		return o.StartUTC
	}
	return d.UTC()
}

// ComputeDue returns the reminders firing in (from, to], for every user,
// sorted by fire time. Deleted events, excluded occurrences and overrides are
// already applied by events.Occurrences.
func ComputeDue(ctx context.Context, db *sql.DB, from, to time.Time) ([]Due, error) {
	rows, err := db.QueryContext(ctx, `SELECT DISTINCT e.user_id FROM events e JOIN event_reminders r ON r.event_id=e.id WHERE e.deleted_at IS NULL`)
	if err != nil {
		return nil, err
	}
	var userIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		userIDs = append(userIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// An occurrence can start up to maxOffset after the reminder fires; all-day
	// references can differ from the occurrence's UTC start by a zone offset.
	lo, hi := from.Add(-24*time.Hour), to.Add(maxOffset+24*time.Hour)
	var out []Due
	for _, uid := range userIDs {
		seen := map[string]bool{}
		for start := lo; start.Before(hi); start = start.Add(chunk) {
			end := start.Add(chunk)
			if end.After(hi) {
				end = hi
			}
			occs, err := events.Occurrences(ctx, db, uid, events.OccQuery{From: start, To: end})
			if err != nil {
				return nil, err
			}
			for _, o := range occs {
				ref := reference(o)
				for _, r := range o.Reminders {
					fire := ref.Add(-time.Duration(r.MinutesBefore) * time.Minute)
					if !fire.After(from) || fire.After(to) {
						continue
					}
					id := o.EventID + "|" + o.Key + "|" + strconv.Itoa(r.MinutesBefore)
					if seen[id] {
						continue
					}
					seen[id] = true
					out = append(out, Due{UserID: uid, EventID: o.EventID, Key: o.Key, Title: o.Title, Start: o.Start,
						StartUTC: o.StartUTC, FireAt: fire, MinutesBefore: r.MinutesBefore})
				}
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if !a.FireAt.Equal(b.FireAt) {
			return a.FireAt.Before(b.FireAt)
		}
		if a.EventID != b.EventID {
			return a.EventID < b.EventID
		}
		return a.Key < b.Key
	})
	return out, nil
}
