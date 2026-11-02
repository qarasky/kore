package events

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/qarasky/korecalendar/api/internal/calendars"
	"github.com/qarasky/korecalendar/api/internal/recur"
	"github.com/qarasky/korecalendar/api/internal/users"
)

// liveSQL is the one predicate for "this event exists": not soft-deleted.
const liveSQL = "deleted_at IS NULL"

type queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// normalize validates in and fills defaults. userTZ and firstCalendar come
// from the user's account.
func normalize(in Input, userTZ string) (Input, error) {
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" || utf8.RuneCountInString(in.Title) > 200 {
		return in, invalid("title must be 1-200 characters")
	}
	if in.TZ == "" {
		in.TZ = userTZ
	}
	if in.End == "" {
		layout, step := "2006-01-02T15:04:05", time.Hour
		if in.AllDay {
			layout, step = "2006-01-02", 24*time.Hour
		}
		start, err := time.Parse(layout, in.Start)
		if err != nil {
			return in, invalid("start must be " + layout)
		}
		in.End = start.Add(step).Format(layout)
	}
	s := recur.Series{Start: in.Start, End: in.End, TZ: in.TZ, AllDay: in.AllDay, RRule: in.RRule, RDates: in.RDates}
	if err := s.Validate(); err != nil {
		if errors.Is(err, recur.ErrUnsupportedRule) {
			return in, err
		}
		return in, invalid(strings.TrimPrefix(err.Error(), "invalid series: "))
	}
	if len(in.Reminders) > maxReminders {
		return in, invalid("at most 20 reminders per event")
	}
	seen := map[int]bool{}
	out := in.Reminders[:0:0]
	for _, r := range in.Reminders {
		if r.MinutesBefore < 0 || r.MinutesBefore > MaxReminderMinutes {
			return in, invalid("reminder minutes_before must be between 0 and 40320 (28 days)")
		}
		if !seen[r.MinutesBefore] {
			seen[r.MinutesBefore] = true
			out = append(out, r)
		}
	}
	in.Reminders = out
	sort.Strings(in.RDates)
	return in, nil
}

// Create stores a new event for a.UserID and records a sync change.
func Create(ctx context.Context, db *sql.DB, a Actor, in Input) (Event, error) {
	u, err := users.Get(ctx, db, a.UserID)
	if err != nil {
		return Event{}, err
	}
	if in.CalendarID == "" {
		cals, err := calendars.List(ctx, db, a.UserID)
		if err != nil {
			return Event{}, err
		}
		if len(cals) == 0 {
			return Event{}, invalid("create a calendar first")
		}
		in.CalendarID = cals[0].ID
	} else if _, err := calendars.Get(ctx, db, a.UserID, in.CalendarID); err != nil {
		if errors.Is(err, calendars.ErrNotFound) {
			return Event{}, ErrNotFound
		}
		return Event{}, err
	}
	in, err = normalize(in, u.Timezone)
	if err != nil {
		return Event{}, err
	}
	now := time.Now().Unix()
	e := Event{ID: users.NewID(), CalendarID: in.CalendarID, Title: in.Title, Notes: in.Notes, Location: in.Location,
		Start: in.Start, End: in.End, TZ: in.TZ, AllDay: in.AllDay, RRule: in.RRule, RDates: nonNil(in.RDates), Exdates: []string{},
		Reminders: nonNilR(in.Reminders), Version: 1, CreatedBy: a.Label, UpdatedBy: a.Label, CreatedAt: now, UpdatedAt: now}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return Event{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO events(id,user_id,calendar_id,title,notes,location,start_local,end_local,tz,all_day,rrule,
		version,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		e.ID, a.UserID, e.CalendarID, e.Title, e.Notes, e.Location, e.Start, e.End, e.TZ, e.AllDay, e.RRule,
		e.Version, e.CreatedBy, e.UpdatedBy, e.CreatedAt, e.UpdatedAt); err != nil {
		return Event{}, err
	}
	for _, d := range e.RDates {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO event_rdates(event_id,start_local) VALUES(?,?)`, e.ID, d); err != nil {
			return Event{}, err
		}
	}
	if err := writeReminders(ctx, tx, e.ID, "", e.Reminders); err != nil {
		return Event{}, err
	}
	if err := recordChange(ctx, tx, a.UserID, e.ID, "upsert"); err != nil {
		return Event{}, err
	}
	return e, tx.Commit()
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func nonNilR(r []Reminder) []Reminder {
	if r == nil {
		return []Reminder{}
	}
	return r
}

func writeReminders(ctx context.Context, q queryer, eventID, overrideKey string, rs []Reminder) error {
	for _, r := range rs {
		if _, err := q.ExecContext(ctx, `INSERT OR IGNORE INTO event_reminders(event_id,override_key,minutes_before) VALUES(?,?,?)`,
			eventID, overrideKey, r.MinutesBefore); err != nil {
			return err
		}
	}
	return nil
}

func recordChange(ctx context.Context, q queryer, userID, eventID, kind string) error {
	_, err := q.ExecContext(ctx, `INSERT INTO changes(user_id,event_id,kind,at) VALUES(?,?,?,?)`, userID, eventID, kind, time.Now().Unix())
	return err
}

// Get returns one of the user's live events; someone else's, or a deleted
// one, is ErrNotFound.
func Get(ctx context.Context, db *sql.DB, userID, id string) (Event, error) {
	return load(ctx, db, userID, id, false)
}

func load(ctx context.Context, q queryer, userID, id string, includeDeleted bool) (Event, error) {
	var e Event
	var deleted sql.NullInt64
	where := "id=? AND user_id=?"
	if !includeDeleted {
		where += " AND " + liveSQL
	}
	err := q.QueryRowContext(ctx, `SELECT id,calendar_id,title,notes,location,start_local,end_local,tz,all_day,rrule,version,
		created_by,updated_by,created_at,updated_at,deleted_at FROM events WHERE `+where, id, userID).
		Scan(&e.ID, &e.CalendarID, &e.Title, &e.Notes, &e.Location, &e.Start, &e.End, &e.TZ, &e.AllDay, &e.RRule, &e.Version,
			&e.CreatedBy, &e.UpdatedBy, &e.CreatedAt, &e.UpdatedAt, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return Event{}, ErrNotFound
	}
	if err != nil {
		return Event{}, err
	}
	if deleted.Valid {
		e.DeletedAt = &deleted.Int64
	}
	if e.Exdates, err = column(ctx, q, `SELECT key FROM event_exdates WHERE event_id=? ORDER BY key`, id); err != nil {
		return Event{}, err
	}
	if e.RDates, err = column(ctx, q, `SELECT start_local FROM event_rdates WHERE event_id=? ORDER BY start_local`, id); err != nil {
		return Event{}, err
	}
	rows, err := q.QueryContext(ctx, `SELECT minutes_before FROM event_reminders WHERE event_id=? AND override_key='' ORDER BY minutes_before DESC`, id)
	if err != nil {
		return Event{}, err
	}
	defer rows.Close()
	e.Reminders = []Reminder{}
	for rows.Next() {
		var r Reminder
		if err := rows.Scan(&r.MinutesBefore); err != nil {
			return Event{}, err
		}
		e.Reminders = append(e.Reminders, r)
	}
	return e, rows.Err()
}

func column(ctx context.Context, q queryer, query string, args ...any) ([]string, error) {
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
