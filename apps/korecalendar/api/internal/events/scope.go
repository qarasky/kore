package events

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/qarasky/korecalendar/api/internal/calendars"
	"github.com/qarasky/korecalendar/api/internal/recur"
)

// Scope says how much of a recurring series an edit or delete touches.
type Scope string

// The three scopes of the recurring edit/delete prompt.
const (
	ScopeThis      Scope = "this"      // one occurrence
	ScopeFollowing Scope = "following" // this occurrence and every later one
	ScopeAll       Scope = "all"       // the whole series
)

// RestoreWindow is how long a deleted event can be restored.
const RestoreWindow = calendars.RestoreWindow

// ErrOccurrenceNotFound means the occurrence key is not an occurrence of the series.
var ErrOccurrenceNotFound = errors.New("occurrence not found")

// Patch is a partial update; nil fields are left alone. Reminders non-nil
// (even empty) replaces them. Changing Start without End keeps the duration.
type Patch struct {
	Title, Notes, Location, Start, End, TZ, RRule *string
	AllDay                                        *bool
	Reminders                                     *[]Reminder
}

// EditResult is the series after an edit. Created is the new series when a
// "following" edit split one off; DroppedOverrides lists occurrence keys whose
// override or exclusion no longer exists after a schedule change.
type EditResult struct {
	Event            Event
	Created          *Event
	DroppedOverrides []string
}

func (e Event) recurring() bool { return e.RRule != "" || len(e.RDates) > 0 }

func (e Event) scheduleDiffers(o Event) bool {
	return e.Start != o.Start || e.TZ != o.TZ || e.RRule != o.RRule || e.AllDay != o.AllDay
}

// applyPatch applies p to e in memory and validates the result.
func applyPatch(e *Event, p Patch) error {
	if p.Title != nil {
		t := strings.TrimSpace(*p.Title)
		if t == "" || utf8.RuneCountInString(t) > 200 {
			return invalid("title must be 1-200 characters")
		}
		e.Title = t
	}
	if p.Notes != nil {
		e.Notes = *p.Notes
	}
	if p.Location != nil {
		e.Location = *p.Location
	}
	if p.TZ != nil {
		e.TZ = *p.TZ
	}
	if p.RRule != nil {
		e.RRule = *p.RRule
	}
	oldAllDay := e.AllDay
	if p.AllDay != nil {
		e.AllDay = *p.AllDay
	}
	if p.Start != nil {
		dur := time.Hour
		if s, err1 := time.Parse(layoutFor(oldAllDay), e.Start); err1 == nil {
			if en, err2 := time.Parse(layoutFor(oldAllDay), e.End); err2 == nil {
				dur = en.Sub(s)
			}
		}
		e.Start = *p.Start
		if p.End == nil {
			if s, err := time.Parse(layoutFor(e.AllDay), e.Start); err == nil {
				e.End = s.Add(dur).Format(layoutFor(e.AllDay))
			}
		}
	}
	if p.End != nil {
		e.End = *p.End
	}
	if err := validateSeries(e.Series()); err != nil {
		return err
	}
	if p.Reminders != nil {
		rs, err := cleanReminders(*p.Reminders)
		if err != nil {
			return err
		}
		e.Reminders = rs
	}
	return nil
}

// saveEvent writes e over its row, bumping the version and attribution.
func saveEvent(ctx context.Context, q queryer, e *Event, label string) error {
	e.Version++
	e.UpdatedBy = label
	e.UpdatedAt = time.Now().Unix()
	if _, err := q.ExecContext(ctx, `UPDATE events SET calendar_id=?,title=?,notes=?,location=?,start_local=?,end_local=?,tz=?,all_day=?,rrule=?,
		version=?,updated_by=?,updated_at=?,deleted_at=? WHERE id=?`,
		e.CalendarID, e.Title, e.Notes, e.Location, e.Start, e.End, e.TZ, e.AllDay, e.RRule, e.Version, e.UpdatedBy, e.UpdatedAt, e.DeletedAt, e.ID); err != nil {
		return err
	}
	return writeCollections(ctx, q, *e)
}

func nonNilStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// prune removes overrides and exclusions of e whose occurrence key no longer
// exists (after a schedule change), and returns the dropped override keys.
func prune(ctx context.Context, q queryer, e *Event) ([]string, error) {
	var dropped []string
	ovs, err := loadOverrides(ctx, q, []string{e.ID})
	if err != nil {
		return nil, err
	}
	s := e.Series()
	for _, o := range ovs[e.ID] {
		if e.recurring() && s.HasOccurrence(o.Key) {
			continue
		}
		dropped = append(dropped, o.Key)
		if err := deleteOverride(ctx, q, e.ID, o.Key); err != nil {
			return nil, err
		}
	}
	kept := []string{}
	for _, k := range e.Exdates {
		if e.recurring() && s.HasOccurrence(k) {
			kept = append(kept, k)
		}
	}
	e.Exdates = kept
	if err := writeCollections(ctx, q, *e); err != nil {
		return nil, err
	}
	return dropped, nil
}

func deleteOverride(ctx context.Context, q queryer, eventID, key string) error {
	if _, err := q.ExecContext(ctx, `DELETE FROM event_overrides WHERE event_id=? AND key=?`, eventID, key); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, `DELETE FROM event_reminders WHERE event_id=? AND override_key=?`, eventID, key)
	return err
}

// begin loads the event inside a transaction and applies the If-Match check.
func begin(ctx context.Context, db *sql.DB, a Actor, id string, scope Scope, key string, ifMatch *int) (*sql.Tx, Event, Scope, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, Event{}, "", err
	}
	e, err := load(ctx, tx, a.UserID, id, false)
	if err != nil {
		tx.Rollback()
		return nil, Event{}, "", err
	}
	if ifMatch != nil && *ifMatch != e.Version {
		tx.Rollback()
		return nil, Event{}, "", ErrVersionConflict
	}
	if scope == "" {
		scope = ScopeAll
	}
	switch {
	case scope != ScopeAll && scope != ScopeThis && scope != ScopeFollowing:
		err = invalid("scope must be this, following or all")
	case scope != ScopeAll && !e.recurring():
		err = invalid("scope " + string(scope) + " needs a recurring event")
	case scope != ScopeAll && key == "":
		err = invalid("occurrence is required when scope is " + string(scope))
	case scope != ScopeAll && !e.Series().HasOccurrence(key):
		err = ErrOccurrenceNotFound
	}
	if err != nil {
		tx.Rollback()
		return nil, Event{}, "", err
	}
	return tx, e, scope, nil
}

// Update applies p to the whole series, one occurrence, or this occurrence and
// the rest. key is the occurrence's original start for the narrower scopes.
// ifMatch, when non-nil, must equal the current version.
func Update(ctx context.Context, db *sql.DB, a Actor, id string, p Patch, scope Scope, key string, ifMatch *int) (EditResult, error) {
	tx, e, scope, err := begin(ctx, db, a, id, scope, key, ifMatch)
	if err != nil {
		return EditResult{}, err
	}
	defer tx.Rollback()
	var res EditResult
	switch scope {
	case ScopeThis:
		res, err = updateThis(ctx, tx, a, e, p, key)
	case ScopeFollowing:
		res, err = updateFollowing(ctx, tx, a, e, p, key)
	default:
		res, err = updateAll(ctx, tx, a, e, p)
	}
	if err != nil {
		return EditResult{}, err
	}
	return res, tx.Commit()
}

func updateAll(ctx context.Context, tx *sql.Tx, a Actor, e Event, p Patch) (EditResult, error) {
	before := e
	if err := applyPatch(&e, p); err != nil {
		return EditResult{}, err
	}
	if err := saveEvent(ctx, tx, &e, a.Label); err != nil {
		return EditResult{}, err
	}
	var dropped []string
	if e.scheduleDiffers(before) {
		var err error
		if dropped, err = prune(ctx, tx, &e); err != nil {
			return EditResult{}, err
		}
	}
	return EditResult{Event: e, DroppedOverrides: dropped}, recordChange(ctx, tx, a.UserID, e.ID, "upsert")
}

func updateThis(ctx context.Context, tx *sql.Tx, a Actor, e Event, p Patch, key string) (EditResult, error) {
	if p.TZ != nil || p.RRule != nil {
		return EditResult{}, invalid("tz and rrule can only change for the whole series or from an occurrence on")
	}
	ovs, err := loadOverrides(ctx, tx, []string{e.ID})
	if err != nil {
		return EditResult{}, err
	}
	ov := Override{Key: key}
	for _, o := range ovs[e.ID] {
		if o.Key == key {
			ov = o
		}
	}
	if p.Title != nil {
		t := strings.TrimSpace(*p.Title)
		if t == "" || utf8.RuneCountInString(t) > 200 {
			return EditResult{}, invalid("title must be 1-200 characters")
		}
		ov.Title = &t
	}
	if p.Notes != nil {
		ov.Notes = p.Notes
	}
	if p.Location != nil {
		ov.Location = p.Location
	}
	if p.AllDay != nil {
		ov.AllDay = p.AllDay
	}
	if p.Start != nil {
		// Moving the start without an end keeps the duration the occurrence already has.
		if p.End == nil && ov.End != nil {
			ov.End = shiftedEnd(e, ov, key, *p.Start)
		}
		ov.Start = p.Start
	}
	if p.End != nil {
		ov.End = p.End
	}
	if p.Reminders != nil {
		rs, err := cleanReminders(*p.Reminders)
		if err != nil {
			return EditResult{}, err
		}
		ov.Reminders = &rs
	}
	if o, ok := overrideOccurrence(e, ov, time.Unix(0, 0), time.Unix(1<<40, 0)); !ok || o.EndUTC.Before(o.StartUTC) {
		return EditResult{}, invalid("the changed occurrence needs a valid start and an end after it")
	}
	if err := upsertOverride(ctx, tx, e.ID, ov); err != nil {
		return EditResult{}, err
	}
	// the master changes too (its version is what clients check)
	if err := saveEvent(ctx, tx, &e, a.Label); err != nil {
		return EditResult{}, err
	}
	return EditResult{Event: e}, recordChange(ctx, tx, a.UserID, e.ID, "upsert")
}

// shiftedEnd returns the end that keeps ov's current duration after its start
// moves to newStart, or nil (fall back to the series' duration) if the values
// do not parse.
func shiftedEnd(e Event, ov Override, key, newStart string) *string {
	allDay := e.AllDay
	if ov.AllDay != nil {
		allDay = *ov.AllDay
	}
	layout := layoutFor(allDay)
	oldStart := key
	if ov.Start != nil {
		oldStart = *ov.Start
	}
	os, err1 := time.Parse(layout, oldStart)
	oe, err2 := time.Parse(layout, *ov.End)
	ns, err3 := time.Parse(layout, newStart)
	if err1 != nil || err2 != nil || err3 != nil {
		return nil
	}
	end := ns.Add(oe.Sub(os)).Format(layout)
	return &end
}

func updateFollowing(ctx context.Context, tx *sql.Tx, a Actor, e Event, p Patch, key string) (EditResult, error) {
	before, after, err := recur.SplitAt(e.Series(), key)
	if err != nil {
		return EditResult{}, err
	}
	if before.Start == "" { // the first occurrence: nothing earlier to keep
		return updateAll(ctx, tx, a, e, p)
	}
	now := time.Now().Unix()
	next := e
	next.ID = newID()
	next.ICSUID = "" // the .ics UID identifies the original series; a unique index forbids reusing it
	next.Start, next.End, next.RRule = after.Start, after.End, after.RRule
	next.RDates, next.Exdates = nonNilStrings(after.RDates), nonNilStrings(after.Exdates)
	next.Version, next.CreatedBy, next.UpdatedBy, next.CreatedAt, next.UpdatedAt = 1, a.Label, a.Label, now, now
	scheduled := next
	if err := applyPatch(&next, p); err != nil {
		return EditResult{}, err
	}
	if err := insertEvent(ctx, tx, a.UserID, next); err != nil {
		return EditResult{}, err
	}
	// overrides from this occurrence on belong to the new series
	if _, err := tx.ExecContext(ctx, `UPDATE event_overrides SET event_id=? WHERE event_id=? AND key>=?`, next.ID, e.ID, key); err != nil {
		return EditResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE event_reminders SET event_id=? WHERE event_id=? AND override_key<>'' AND override_key>=?`, next.ID, e.ID, key); err != nil {
		return EditResult{}, err
	}
	var dropped []string
	if next.scheduleDiffers(scheduled) {
		if dropped, err = prune(ctx, tx, &next); err != nil {
			return EditResult{}, err
		}
	}
	old := e
	old.RRule, old.RDates, old.Exdates = before.RRule, nonNilStrings(before.RDates), nonNilStrings(before.Exdates)
	if err := saveEvent(ctx, tx, &old, a.Label); err != nil {
		return EditResult{}, err
	}
	for _, id := range []string{old.ID, next.ID} {
		if err := recordChange(ctx, tx, a.UserID, id, "upsert"); err != nil {
			return EditResult{}, err
		}
	}
	return EditResult{Event: old, Created: &next, DroppedOverrides: dropped}, nil
}

// Delete removes the whole series (soft delete, restorable for 30 days), one
// occurrence (an exclusion), or this occurrence and the rest (the series ends
// before it). It returns the event as it is afterwards.
func Delete(ctx context.Context, db *sql.DB, a Actor, id string, scope Scope, key string, ifMatch *int) (Event, error) {
	tx, e, scope, err := begin(ctx, db, a, id, scope, key, ifMatch)
	if err != nil {
		return Event{}, err
	}
	defer tx.Rollback()
	kind := "upsert"
	switch scope {
	case ScopeThis:
		e.Exdates = append(e.Exdates, key)
		if err := deleteOverride(ctx, tx, e.ID, key); err != nil {
			return Event{}, err
		}
		if err := saveEvent(ctx, tx, &e, a.Label); err != nil {
			return Event{}, err
		}
	case ScopeFollowing:
		before, _, err := recur.SplitAt(e.Series(), key)
		if err != nil {
			return Event{}, err
		}
		if before.Start == "" {
			e, kind, err = softDelete(ctx, tx, a, e)
			if err != nil {
				return Event{}, err
			}
			break
		}
		e.RRule, e.RDates, e.Exdates = before.RRule, nonNilStrings(before.RDates), nonNilStrings(before.Exdates)
		if _, err := tx.ExecContext(ctx, `DELETE FROM event_overrides WHERE event_id=? AND key>=?`, e.ID, key); err != nil {
			return Event{}, err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM event_reminders WHERE event_id=? AND override_key<>'' AND override_key>=?`, e.ID, key); err != nil {
			return Event{}, err
		}
		if err := saveEvent(ctx, tx, &e, a.Label); err != nil {
			return Event{}, err
		}
	default:
		e, kind, err = softDelete(ctx, tx, a, e)
		if err != nil {
			return Event{}, err
		}
	}
	if err := recordChange(ctx, tx, a.UserID, e.ID, kind); err != nil {
		return Event{}, err
	}
	return e, tx.Commit()
}

func softDelete(ctx context.Context, tx *sql.Tx, a Actor, e Event) (Event, string, error) {
	now := time.Now().Unix()
	e.DeletedAt = &now
	return e, "delete", saveEvent(ctx, tx, &e, a.Label)
}

// Restore brings back an event deleted less than 30 days ago. Restoring a
// live event changes nothing.
func Restore(ctx context.Context, db *sql.DB, a Actor, id string) (Event, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return Event{}, err
	}
	defer tx.Rollback()
	e, err := load(ctx, tx, a.UserID, id, true)
	if err != nil {
		return Event{}, err
	}
	if e.DeletedAt == nil {
		return e, nil
	}
	if time.Since(time.Unix(*e.DeletedAt, 0)) > RestoreWindow {
		return Event{}, ErrNotFound
	}
	var liveCalendar int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM calendars WHERE id=? AND deleted_at IS NULL`, e.CalendarID).Scan(&liveCalendar); err != nil {
		return Event{}, err
	}
	if liveCalendar == 0 {
		return Event{}, invalid("the event's calendar is deleted; restore the calendar first")
	}
	e.DeletedAt = nil
	if err := saveEvent(ctx, tx, &e, a.Label); err != nil {
		return Event{}, err
	}
	if err := recordChange(ctx, tx, a.UserID, e.ID, "upsert"); err != nil {
		return Event{}, err
	}
	return e, tx.Commit()
}

// PurgeDeleted permanently removes events deleted before olderThan and
// returns how many.
func PurgeDeleted(ctx context.Context, db *sql.DB, olderThan time.Time) (int, error) {
	res, err := db.ExecContext(ctx, `DELETE FROM events WHERE deleted_at IS NOT NULL AND deleted_at<?`, olderThan.Unix())
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	return int(n), err
}
