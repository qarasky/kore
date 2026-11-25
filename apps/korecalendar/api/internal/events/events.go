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

func newID() string { return users.NewID() }

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
	if err := validateSeries(recur.Series{Start: in.Start, End: in.End, TZ: in.TZ, AllDay: in.AllDay, RRule: in.RRule, RDates: in.RDates}); err != nil {
		return in, err
	}
	rs, err := cleanReminders(in.Reminders)
	if err != nil {
		return in, err
	}
	in.Reminders = rs
	sort.Strings(in.RDates)
	return in, nil
}

// validateSeries maps recur's errors to this package's: an unsupported rule
// stays itself (so the API can name it), everything else is a ValidationError.
func validateSeries(s recur.Series) error {
	if err := s.Validate(); err != nil {
		if errors.Is(err, recur.ErrUnsupportedRule) {
			return err
		}
		return invalid(strings.TrimPrefix(err.Error(), "invalid series: "))
	}
	return nil
}

// cleanReminders checks bounds and removes duplicates.
func cleanReminders(in []Reminder) ([]Reminder, error) {
	if len(in) > maxReminders {
		return nil, invalid("at most 20 reminders per event")
	}
	seen := map[int]bool{}
	out := []Reminder{}
	for _, r := range in {
		if r.MinutesBefore < 0 || r.MinutesBefore > MaxReminderMinutes {
			return nil, invalid("reminder minutes_before must be between 0 and 40320 (28 days)")
		}
		if !seen[r.MinutesBefore] {
			seen[r.MinutesBefore] = true
			out = append(out, r)
		}
	}
	return out, nil
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
	e := Event{ID: newID(), CalendarID: in.CalendarID, Title: in.Title, Notes: in.Notes, Location: in.Location,
		Start: in.Start, End: in.End, TZ: in.TZ, AllDay: in.AllDay, RRule: in.RRule, RDates: nonNil(in.RDates), Exdates: []string{},
		Reminders: nonNilR(in.Reminders), Version: 1, CreatedBy: a.Label, UpdatedBy: a.Label, CreatedAt: now, UpdatedAt: now}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return Event{}, err
	}
	defer tx.Rollback()
	if err := insertEvent(ctx, tx, a.UserID, e); err != nil {
		return Event{}, err
	}
	if err := recordChange(ctx, tx, a.UserID, e.ID, "upsert"); err != nil {
		return Event{}, err
	}
	return e, tx.Commit()
}

// insertEvent writes a new event row with its exclusions, extra dates and reminders.
func insertEvent(ctx context.Context, q queryer, userID string, e Event) error {
	var uid any
	if e.ICSUID != "" {
		uid = e.ICSUID
	}
	if _, err := q.ExecContext(ctx, `INSERT INTO events(id,user_id,calendar_id,title,notes,location,start_local,end_local,tz,all_day,rrule,
		version,created_by,updated_by,created_at,updated_at,ics_uid) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		e.ID, userID, e.CalendarID, e.Title, e.Notes, e.Location, e.Start, e.End, e.TZ, e.AllDay, e.RRule,
		e.Version, e.CreatedBy, e.UpdatedBy, e.CreatedAt, e.UpdatedAt, uid); err != nil {
		return err
	}
	return writeCollections(ctx, q, e)
}

// writeCollections replaces the event's exclusions, extra dates and series reminders.
func writeCollections(ctx context.Context, q queryer, e Event) error {
	for _, del := range []string{`DELETE FROM event_exdates WHERE event_id=?`, `DELETE FROM event_rdates WHERE event_id=?`,
		`DELETE FROM event_reminders WHERE event_id=? AND override_key=''`} {
		if _, err := q.ExecContext(ctx, del, e.ID); err != nil {
			return err
		}
	}
	for _, k := range e.Exdates {
		if _, err := q.ExecContext(ctx, `INSERT OR IGNORE INTO event_exdates(event_id,key) VALUES(?,?)`, e.ID, k); err != nil {
			return err
		}
	}
	for _, d := range e.RDates {
		if _, err := q.ExecContext(ctx, `INSERT OR IGNORE INTO event_rdates(event_id,start_local) VALUES(?,?)`, e.ID, d); err != nil {
			return err
		}
	}
	return writeReminders(ctx, q, e.ID, "", e.Reminders)
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

const eventCols = `id,calendar_id,title,notes,location,start_local,end_local,tz,all_day,rrule,version,
	created_by,updated_by,created_at,updated_at,deleted_at,ics_uid`

type scanner interface{ Scan(dest ...any) error }

// scanEvent reads one row of eventCols; collections are attached separately.
func scanEvent(sc scanner) (Event, error) {
	var e Event
	var deleted sql.NullInt64
	var uid sql.NullString
	err := sc.Scan(&e.ID, &e.CalendarID, &e.Title, &e.Notes, &e.Location, &e.Start, &e.End, &e.TZ, &e.AllDay, &e.RRule, &e.Version,
		&e.CreatedBy, &e.UpdatedBy, &e.CreatedAt, &e.UpdatedAt, &deleted, &uid)
	if deleted.Valid {
		e.DeletedAt = &deleted.Int64
	}
	e.ICSUID = uid.String
	e.RDates, e.Exdates, e.Reminders = []string{}, []string{}, []Reminder{}
	return e, err
}

func load(ctx context.Context, q queryer, userID, id string, includeDeleted bool) (Event, error) {
	where := "id=? AND user_id=?"
	if !includeDeleted {
		where += " AND " + liveSQL
	}
	e, err := scanEvent(q.QueryRowContext(ctx, `SELECT `+eventCols+` FROM events WHERE `+where, id, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return Event{}, ErrNotFound
	}
	if err != nil {
		return Event{}, err
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
	for rows.Next() {
		var r Reminder
		if err := rows.Scan(&r.MinutesBefore); err != nil {
			return Event{}, err
		}
		e.Reminders = append(e.Reminders, r)
	}
	return e, rows.Err()
}

// liveEvents returns the user's live events that could have an occurrence
// near [fromWall, toWall] (wall-time strings, already padded for zone
// offsets), optionally limited to calendarIDs, with collections attached.
func liveEvents(ctx context.Context, q queryer, userID string, calendarIDs []string, fromWall, toWall string) ([]Event, error) {
	query := `SELECT ` + eventCols + ` FROM events WHERE user_id=? AND ` + liveSQL + ` AND start_local<=?
		AND (rrule<>'' OR end_local>=? OR EXISTS (SELECT 1 FROM event_rdates r WHERE r.event_id=events.id))`
	args := []any{userID, toWall, fromWall}
	if len(calendarIDs) > 0 {
		in, a := inList(calendarIDs)
		query += ` AND calendar_id IN (` + in + `)`
		args = append(args, a...)
	}
	query += ` ORDER BY created_at, rowid`
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	var list []Event
	for rows.Next() {
		e, err := scanEvent(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		list = append(list, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return list, nil
	}
	idx := map[string]*Event{}
	ids := make([]string, len(list))
	for i := range list {
		idx[list[i].ID] = &list[i]
		ids[i] = list[i].ID
	}
	in, a := inList(ids)
	for _, spec := range []struct {
		query string
		add   func(e *Event, v string, n int)
	}{
		{`SELECT event_id,key,0 FROM event_exdates WHERE event_id IN (` + in + `) ORDER BY key`, func(e *Event, v string, _ int) { e.Exdates = append(e.Exdates, v) }},
		{`SELECT event_id,start_local,0 FROM event_rdates WHERE event_id IN (` + in + `) ORDER BY start_local`, func(e *Event, v string, _ int) { e.RDates = append(e.RDates, v) }},
		{`SELECT event_id,'',minutes_before FROM event_reminders WHERE override_key='' AND event_id IN (` + in + `) ORDER BY minutes_before DESC`,
			func(e *Event, _ string, n int) { e.Reminders = append(e.Reminders, Reminder{MinutesBefore: n}) }},
	} {
		rs, err := q.QueryContext(ctx, spec.query, a...)
		if err != nil {
			return nil, err
		}
		for rs.Next() {
			var id, v string
			var n int
			if err := rs.Scan(&id, &v, &n); err != nil {
				rs.Close()
				return nil, err
			}
			spec.add(idx[id], v, n)
		}
		rs.Close()
		if err := rs.Err(); err != nil {
			return nil, err
		}
	}
	return list, nil
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
