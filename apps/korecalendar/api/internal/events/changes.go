package events

import (
	"context"
	"database/sql"
	"errors"
)

// Page sizes for the change feed.
const (
	DefaultChangeLimit = 200
	MaxChangeLimit     = 1000
)

// ChangeSet is one page of the sync feed. Each event appears once, in its
// latest state: Upserted holds live events (new, edited or restored), Deleted
// the ids of events that no longer exist for the client. Follow Cursor while
// More is true; keep the final Cursor for the next sync.
type ChangeSet struct {
	Cursor   int64    `json:"cursor"`
	Upserted []Event  `json:"upserted"`
	Deleted  []string `json:"deleted"`
	More     bool     `json:"more"`
}

// Changes returns the user's changes after the cursor since (0 = everything),
// at most limit events per page, oldest change first.
func Changes(ctx context.Context, db *sql.DB, userID string, since int64, limit int) (ChangeSet, error) {
	if limit <= 0 {
		limit = DefaultChangeLimit
	}
	if limit > MaxChangeLimit {
		limit = MaxChangeLimit
	}
	rows, err := db.QueryContext(ctx, `SELECT c.event_id, c.seq, c.kind FROM changes c
		JOIN (SELECT event_id, MAX(seq) AS s FROM changes WHERE user_id=? AND seq>? GROUP BY event_id) m
		  ON m.event_id=c.event_id AND m.s=c.seq
		WHERE c.user_id=? ORDER BY c.seq LIMIT ?`, userID, since, userID, limit+1)
	if err != nil {
		return ChangeSet{}, err
	}
	type change struct {
		id   string
		seq  int64
		kind string
	}
	var list []change
	for rows.Next() {
		var c change
		if err := rows.Scan(&c.id, &c.seq, &c.kind); err != nil {
			rows.Close()
			return ChangeSet{}, err
		}
		list = append(list, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return ChangeSet{}, err
	}
	cs := ChangeSet{Cursor: since, Upserted: []Event{}, Deleted: []string{}}
	if len(list) > limit {
		cs.More = true
		list = list[:limit]
	}
	for _, c := range list {
		cs.Cursor = c.seq
		if c.kind == "delete" {
			cs.Deleted = append(cs.Deleted, c.id)
			continue
		}
		e, err := Get(ctx, db, userID, c.id)
		if errors.Is(err, ErrNotFound) { // gone since: report it as deleted
			cs.Deleted = append(cs.Deleted, c.id)
			continue
		}
		if err != nil {
			return ChangeSet{}, err
		}
		cs.Upserted = append(cs.Upserted, e)
	}
	return cs, nil
}
