package reminders

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"strconv"
	"time"
)

// Channel delivers a due reminder to a user (Web Push now; Telegram and email
// later). Send must be safe to call again for the same Due: delivery is
// at-least-once and de-duplicated by the delivery log.
type Channel interface {
	Name() string
	Send(ctx context.Context, userID string, d Due) error
}

const (
	catchUp     = 10 * time.Minute   // how far back a restart still delivers
	maxAttempts = 3                  // sends per reminder per channel before giving up
	keepSent    = 7 * 24 * time.Hour // how long delivery rows are kept
	tickEvery   = 30 * time.Second
	cursorKey   = "reminders.cursor"
)

// Scheduler delivers reminders as time passes. It keeps a cursor (the last
// time it looked) and a delivery log in the database, so a restart neither
// repeats a reminder nor loses one that came due while it was down (within
// the catch-up window).
type Scheduler struct {
	db       *sql.DB
	channels []Channel
	now      func() time.Time
}

// NewScheduler returns a scheduler sending through channels, reading time from now.
func NewScheduler(db *sql.DB, channels []Channel, now func() time.Time) *Scheduler {
	return &Scheduler{db: db, channels: channels, now: now}
}

// Run ticks every 30 seconds until ctx is done.
func (s *Scheduler) Run(ctx context.Context) {
	t := time.NewTicker(tickEvery)
	defer t.Stop()
	for {
		if err := s.Tick(ctx); err != nil && ctx.Err() == nil {
			log.Printf("reminders: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// Tick retries undelivered reminders, then delivers those that came due since
// the last tick.
func (s *Scheduler) Tick(ctx context.Context) error {
	now := s.now().Truncate(time.Second)
	if _, err := s.db.ExecContext(ctx, `DELETE FROM reminder_deliveries WHERE state='sent' AND fire_at<?`, now.Add(-keepSent).Unix()); err != nil {
		return err
	}
	if err := s.retryPending(ctx); err != nil {
		return err
	}
	cursor, ok, err := s.loadCursor(ctx)
	if err != nil {
		return err
	}
	if !ok { // first run ever: nothing before now is ours to send
		return s.saveCursor(ctx, now)
	}
	from := cursor
	if floor := now.Add(-catchUp); from.Before(floor) {
		from = floor
	}
	if now.After(from) {
		due, err := ComputeDue(ctx, s.db, from, now)
		if err != nil {
			return err // the cursor stays put, so the next tick covers this window again
		}
		for _, d := range due {
			for _, ch := range s.channels {
				s.deliverNew(ctx, ch, d)
			}
		}
	}
	if now.After(cursor) {
		return s.saveCursor(ctx, now)
	}
	return nil
}

func (s *Scheduler) loadCursor(ctx context.Context) (time.Time, bool, error) {
	var v string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key=?`, cursorKey).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, false, nil
	}
	if err != nil {
		return time.Time{}, false, err
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return time.Time{}, false, nil
	}
	return time.Unix(n, 0), true, nil
}

func (s *Scheduler) saveCursor(ctx context.Context, t time.Time) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
		cursorKey, strconv.FormatInt(t.Unix(), 10))
	return err
}

// deliverNew claims the (reminder, channel) pair and sends it. If a row
// already exists, the reminder was sent or is being retried: do nothing.
func (s *Scheduler) deliverNew(ctx context.Context, ch Channel, d Due) {
	payload, err := json.Marshal(d)
	if err != nil {
		return
	}
	res, err := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO reminder_deliveries(user_id,event_id,key,minutes_before,channel,state,attempts,fire_at,payload)
		VALUES(?,?,?,?,?,'pending',0,?,?)`, d.UserID, d.EventID, d.Key, d.MinutesBefore, ch.Name(), d.FireAt.Unix(), string(payload))
	if err != nil {
		log.Printf("reminders: claim: %v", err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return
	}
	s.send(ctx, ch, d, 0)
}

// retryPending sends rows left 'pending' by a failure or a crash.
func (s *Scheduler) retryPending(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `SELECT channel,attempts,payload FROM reminder_deliveries WHERE state='pending' ORDER BY fire_at`)
	if err != nil {
		return err
	}
	type pending struct {
		channel  string
		attempts int
		d        Due
	}
	var list []pending
	for rows.Next() {
		var p pending
		var payload string
		if err := rows.Scan(&p.channel, &p.attempts, &payload); err != nil {
			rows.Close()
			return err
		}
		if json.Unmarshal([]byte(payload), &p.d) == nil {
			list = append(list, p)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, p := range list {
		for _, ch := range s.channels {
			if ch.Name() == p.channel {
				s.send(ctx, ch, p.d, p.attempts)
			}
		}
	}
	return nil
}

// send delivers d and records the outcome: sent on success, one more attempt
// on failure, and given up (marked sent, logged) after maxAttempts.
func (s *Scheduler) send(ctx context.Context, ch Channel, d Due, attempts int) {
	key := []any{d.EventID, d.Key, d.MinutesBefore, ch.Name()}
	where := ` WHERE event_id=? AND key=? AND minutes_before=? AND channel=?`
	if err := ch.Send(ctx, d.UserID, d); err == nil {
		s.db.ExecContext(ctx, `UPDATE reminder_deliveries SET state='sent'`+where, key...)
		return
	} else {
		attempts++
		log.Printf("reminders: %s send failed (%d/%d) for %q: %v", ch.Name(), attempts, maxAttempts, d.Title, err)
	}
	if attempts >= maxAttempts {
		s.db.ExecContext(ctx, `UPDATE reminder_deliveries SET state='sent', attempts=?`+where, append([]any{attempts}, key...)...)
		return
	}
	s.db.ExecContext(ctx, `UPDATE reminder_deliveries SET attempts=?`+where, append([]any{attempts}, key...)...)
}
