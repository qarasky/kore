// Package calendars manages a user's named, coloured calendars.
package calendars

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/qarasky/korecalendar/api/internal/users"
)

// Errors returned by this package.
var (
	ErrNotFound   = errors.New("calendar not found")
	ErrValidation = errors.New("invalid calendar")
	ErrNotEmpty   = errors.New("calendar still has events")
)

// DefaultName and DefaultColor describe the calendar every new account gets.
const (
	DefaultName  = "Personal"
	DefaultColor = "#5b8def"
)

// RestoreWindow is how long a deleted calendar (and the events deleted with it)
// can be restored.
const RestoreWindow = 30 * 24 * time.Hour

var colorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// Calendar is a named, coloured container of events.
type Calendar struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	CreatedAt int64  `json:"created_at"`
}

func validName(name string) (string, bool) {
	name = strings.TrimSpace(name)
	return name, name != "" && utf8.RuneCountInString(name) <= 100
}

// Create adds a calendar for userID.
func Create(ctx context.Context, db *sql.DB, userID, name, color string) (Calendar, error) {
	name, ok := validName(name)
	if !ok || !colorRe.MatchString(color) {
		return Calendar{}, ErrValidation
	}
	c := Calendar{ID: users.NewID(), Name: name, Color: color, CreatedAt: time.Now().Unix()}
	_, err := db.ExecContext(ctx, `INSERT INTO calendars(id,user_id,name,color,created_at) VALUES(?,?,?,?,?)`,
		c.ID, userID, c.Name, c.Color, c.CreatedAt)
	return c, err
}

// CreateDefault adds the "Personal" calendar for a new account.
func CreateDefault(ctx context.Context, db *sql.DB, userID string) (Calendar, error) {
	return Create(ctx, db, userID, DefaultName, DefaultColor)
}

// List returns the user's calendars in creation order.
func List(ctx context.Context, db *sql.DB, userID string) ([]Calendar, error) {
	rows, err := db.QueryContext(ctx, `SELECT id,name,color,created_at FROM calendars WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at, rowid`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Calendar{}
	for rows.Next() {
		var c Calendar
		if err := rows.Scan(&c.ID, &c.Name, &c.Color, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Get returns one of the user's calendars; someone else's is ErrNotFound.
func Get(ctx context.Context, db *sql.DB, userID, id string) (Calendar, error) {
	var c Calendar
	err := db.QueryRowContext(ctx, `SELECT id,name,color,created_at FROM calendars WHERE id=? AND user_id=? AND deleted_at IS NULL`, id, userID).
		Scan(&c.ID, &c.Name, &c.Color, &c.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Calendar{}, ErrNotFound
	}
	return c, err
}

// Update changes the non-nil fields.
func Update(ctx context.Context, db *sql.DB, userID, id string, name, color *string) (Calendar, error) {
	c, err := Get(ctx, db, userID, id)
	if err != nil {
		return Calendar{}, err
	}
	if name != nil {
		n, ok := validName(*name)
		if !ok {
			return Calendar{}, ErrValidation
		}
		c.Name = n
	}
	if color != nil {
		if !colorRe.MatchString(*color) {
			return Calendar{}, ErrValidation
		}
		c.Color = *color
	}
	_, err = db.ExecContext(ctx, `UPDATE calendars SET name=?, color=? WHERE id=? AND user_id=?`, c.Name, c.Color, id, userID)
	return c, err
}

// Delete hides one of the user's calendars. A calendar with live events is
// ErrNotEmpty unless force is set; then its events are deleted with it. Either
// way nothing is destroyed for 30 days: Restore brings the calendar and the
// events deleted with it back. label is recorded as who changed the events.
func Delete(ctx context.Context, db *sql.DB, userID, label, id string, force bool) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var owned int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM calendars WHERE id=? AND user_id=? AND deleted_at IS NULL`, id, userID).Scan(&owned); err != nil {
		return err
	}
	if owned == 0 {
		return ErrNotFound
	}
	ids, err := eventIDs(ctx, tx, `SELECT id FROM events WHERE calendar_id=? AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if len(ids) > 0 && !force {
		return ErrNotEmpty
	}
	now := time.Now().Unix()
	if _, err := tx.ExecContext(ctx, `UPDATE calendars SET deleted_at=? WHERE id=?`, now, id); err != nil {
		return err
	}
	for _, eid := range ids {
		if err := touchEvent(ctx, tx, userID, label, eid, "delete", sql.NullInt64{Int64: now, Valid: true}, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Restore brings back a calendar deleted less than 30 days ago, together with
// the events that were deleted with it (not ones deleted earlier). Restoring a
// calendar that is not deleted changes nothing.
func Restore(ctx context.Context, db *sql.DB, userID, label, id string) (Calendar, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return Calendar{}, err
	}
	defer tx.Rollback()
	var c Calendar
	var deleted sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT id,name,color,created_at,deleted_at FROM calendars WHERE id=? AND user_id=?`, id, userID).
		Scan(&c.ID, &c.Name, &c.Color, &c.CreatedAt, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return Calendar{}, ErrNotFound
	}
	if err != nil {
		return Calendar{}, err
	}
	if !deleted.Valid {
		return c, nil
	}
	if time.Since(time.Unix(deleted.Int64, 0)) > RestoreWindow {
		return Calendar{}, ErrNotFound
	}
	ids, err := eventIDs(ctx, tx, `SELECT id FROM events WHERE calendar_id=? AND deleted_with_calendar=1`, id)
	if err != nil {
		return Calendar{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE calendars SET deleted_at=NULL WHERE id=?`, id); err != nil {
		return Calendar{}, err
	}
	now := time.Now().Unix()
	for _, eid := range ids {
		if err := touchEvent(ctx, tx, userID, label, eid, "upsert", sql.NullInt64{}, now); err != nil {
			return Calendar{}, err
		}
	}
	return c, tx.Commit()
}

// PurgeDeleted permanently removes calendars deleted before olderThan (and
// with them their events) and returns how many.
func PurgeDeleted(ctx context.Context, db *sql.DB, olderThan time.Time) (int, error) {
	res, err := db.ExecContext(ctx, `DELETE FROM calendars WHERE deleted_at IS NOT NULL AND deleted_at<?`, olderThan.Unix())
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	return int(n), err
}

func eventIDs(ctx context.Context, tx *sql.Tx, query string, args ...any) ([]string, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// touchEvent deletes an event with its calendar (or brings it back), with a
// version bump, attribution and a sync change row.
func touchEvent(ctx context.Context, tx *sql.Tx, userID, label, eventID, kind string, deletedAt sql.NullInt64, now int64) error {
	if _, err := tx.ExecContext(ctx, `UPDATE events SET deleted_at=?, deleted_with_calendar=?, version=version+1, updated_by=?, updated_at=? WHERE id=?`, deletedAt, deletedAt.Valid, label, now, eventID); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO changes(user_id,event_id,kind,at) VALUES(?,?,?,?)`, userID, eventID, kind, now)
	return err
}
