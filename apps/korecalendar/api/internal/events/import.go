package events

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/qarasky/korecalendar/api/internal/calendars"
	"github.com/qarasky/korecalendar/api/internal/users"
)

// Imported is one event read from an .ics file.
type Imported struct {
	UID       string
	Input     Input
	Exdates   []string
	Overrides []Override
}

// ImportResult says what Import did.
type ImportResult struct {
	Event            Event
	Created          bool
	SkippedOverrides []string // keys of overrides that are not occurrences of the series
}

// Import stores an event from an .ics file. An event with the same UID (or
// whose own id equals the UID, as exported by this calendar) is updated in
// place, keeping its calendar and replacing its overrides; otherwise a new
// event is created in calendarID (empty = the user's first calendar).
// Exclusions and overrides that are not occurrences of the series are dropped.
func Import(ctx context.Context, db *sql.DB, a Actor, calendarID string, im Imported) (ImportResult, error) {
	u, err := users.Get(ctx, db, a.UserID)
	if err != nil {
		return ImportResult{}, err
	}
	if calendarID == "" {
		cals, err := calendars.List(ctx, db, a.UserID)
		if err != nil {
			return ImportResult{}, err
		}
		if len(cals) == 0 {
			return ImportResult{}, invalid("create a calendar first")
		}
		calendarID = cals[0].ID
	} else if _, err := calendars.Get(ctx, db, a.UserID, calendarID); err != nil {
		if errors.Is(err, calendars.ErrNotFound) {
			return ImportResult{}, ErrNotFound
		}
		return ImportResult{}, err
	}
	in, err := normalize(im.Input, u.Timezone)
	if err != nil {
		return ImportResult{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return ImportResult{}, err
	}
	defer tx.Rollback()

	var res ImportResult
	var existingID string
	if im.UID != "" {
		err := tx.QueryRowContext(ctx, `SELECT id FROM events WHERE user_id=? AND (ics_uid=? OR id=?) ORDER BY ics_uid IS NULL LIMIT 1`,
			a.UserID, im.UID, im.UID).Scan(&existingID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return ImportResult{}, err
		}
	}
	var e Event
	if existingID != "" {
		if e, err = load(ctx, tx, a.UserID, existingID, true); err != nil {
			return ImportResult{}, err
		}
		e.Title, e.Notes, e.Location = in.Title, in.Notes, in.Location
		e.Start, e.End, e.TZ, e.AllDay, e.RRule = in.Start, in.End, in.TZ, in.AllDay, in.RRule
		e.RDates, e.Reminders, e.DeletedAt = nonNil(in.RDates), nonNilR(in.Reminders), nil
		if _, err := tx.ExecContext(ctx, `DELETE FROM event_overrides WHERE event_id=?`, e.ID); err != nil {
			return ImportResult{}, err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM event_reminders WHERE event_id=? AND override_key<>''`, e.ID); err != nil {
			return ImportResult{}, err
		}
	} else {
		now := time.Now().Unix()
		e = Event{ID: newID(), CalendarID: calendarID, Title: in.Title, Notes: in.Notes, Location: in.Location, Start: in.Start, End: in.End,
			TZ: in.TZ, AllDay: in.AllDay, RRule: in.RRule, RDates: nonNil(in.RDates), Reminders: nonNilR(in.Reminders), ICSUID: im.UID,
			Version: 0, CreatedBy: a.Label, UpdatedBy: a.Label, CreatedAt: now, UpdatedAt: now}
		res.Created = true
	}
	series := e.Series()
	e.Exdates = []string{}
	for _, k := range im.Exdates {
		if e.recurring() && series.HasOccurrence(k) {
			e.Exdates = append(e.Exdates, k)
		}
	}
	if res.Created {
		e.Version = 1
		err = insertEvent(ctx, tx, a.UserID, e)
	} else {
		err = saveEvent(ctx, tx, &e, a.Label)
	}
	if err != nil {
		return ImportResult{}, err
	}
	for _, ov := range im.Overrides {
		valid := e.recurring() && series.HasOccurrence(ov.Key)
		if valid {
			_, valid = overrideOccurrence(e, ov, time.Unix(0, 0), time.Unix(1<<40, 0))
		}
		if !valid {
			res.SkippedOverrides = append(res.SkippedOverrides, ov.Key)
			continue
		}
		if err := upsertOverride(ctx, tx, e.ID, ov); err != nil {
			return ImportResult{}, err
		}
	}
	if err := recordChange(ctx, tx, a.UserID, e.ID, "upsert"); err != nil {
		return ImportResult{}, err
	}
	res.Event = e
	return res, tx.Commit()
}

// ListForExport returns the user's live events (optionally of some calendars)
// with their overrides, oldest first.
func ListForExport(ctx context.Context, db *sql.DB, userID string, calendarIDs []string) ([]Event, map[string][]Override, error) {
	evs, err := liveEvents(ctx, db, userID, calendarIDs, "0000-01-01T00:00:00", "9999-12-31T23:59:59")
	if err != nil {
		return nil, nil, err
	}
	ids := make([]string, len(evs))
	for i, e := range evs {
		ids[i] = e.ID
	}
	ovs, err := loadOverrides(ctx, db, ids)
	return evs, ovs, err
}
