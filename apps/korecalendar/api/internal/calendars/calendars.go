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
	rows, err := db.QueryContext(ctx, `SELECT id,name,color,created_at FROM calendars WHERE user_id=? ORDER BY created_at, rowid`, userID)
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
	err := db.QueryRowContext(ctx, `SELECT id,name,color,created_at FROM calendars WHERE id=? AND user_id=?`, id, userID).
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

// Delete removes one of the user's calendars. A calendar that still has live
// events is ErrNotEmpty unless force is set, which permanently deletes the
// calendar and all its events (they cannot be restored without a calendar) and
// records a sync "delete" for each.
func Delete(ctx context.Context, db *sql.DB, userID, id string, force bool) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var owned int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM calendars WHERE id=? AND user_id=?`, id, userID).Scan(&owned); err != nil {
		return err
	}
	if owned == 0 {
		return ErrNotFound
	}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM events WHERE calendar_id=? AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var eid string
		if err := rows.Scan(&eid); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, eid)
	}
	rows.Close()
	if len(ids) > 0 && !force {
		return ErrNotEmpty
	}
	for _, eid := range ids {
		if _, err := tx.ExecContext(ctx, `INSERT INTO changes(user_id,event_id,kind,at) VALUES(?,?,'delete',?)`, userID, eid, time.Now().Unix()); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM calendars WHERE id=? AND user_id=?`, id, userID); err != nil {
		return err
	}
	return tx.Commit()
}
