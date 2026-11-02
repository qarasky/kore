package events

import (
	"context"
	"database/sql"
	"sort"
)

// Override changes a single occurrence of a recurring series (the RFC's
// RECURRENCE-ID). Nil fields inherit from the series; Reminders non-nil
// (even empty) replaces the series' reminders for that occurrence.
type Override struct {
	Key       string      `json:"key"`
	Title     *string     `json:"title,omitempty"`
	Notes     *string     `json:"notes,omitempty"`
	Location  *string     `json:"location,omitempty"`
	Start     *string     `json:"start,omitempty"`
	End       *string     `json:"end,omitempty"`
	AllDay    *bool       `json:"all_day,omitempty"`
	Cancelled bool        `json:"cancelled,omitempty"`
	Reminders *[]Reminder `json:"reminders,omitempty"`
}

// upsertOverride stores o for eventID, replacing any override with the same key.
func upsertOverride(ctx context.Context, q queryer, eventID string, o Override) error {
	if _, err := q.ExecContext(ctx, `DELETE FROM event_overrides WHERE event_id=? AND key=?`, eventID, o.Key); err != nil {
		return err
	}
	if _, err := q.ExecContext(ctx, `DELETE FROM event_reminders WHERE event_id=? AND override_key=?`, eventID, o.Key); err != nil {
		return err
	}
	if _, err := q.ExecContext(ctx, `INSERT INTO event_overrides(event_id,key,cancelled,title,notes,location,start_local,end_local,all_day,reminders_set)
		VALUES(?,?,?,?,?,?,?,?,?,?)`, eventID, o.Key, o.Cancelled, o.Title, o.Notes, o.Location, o.Start, o.End, o.AllDay, o.Reminders != nil); err != nil {
		return err
	}
	if o.Reminders != nil {
		return writeReminders(ctx, q, eventID, o.Key, *o.Reminders)
	}
	return nil
}

// loadOverrides returns the overrides of the given events, keyed by event id.
func loadOverrides(ctx context.Context, q queryer, ids []string) (map[string][]Override, error) {
	out := map[string][]Override{}
	if len(ids) == 0 {
		return out, nil
	}
	in, args := inList(ids)
	rows, err := q.QueryContext(ctx, `SELECT event_id,key,cancelled,title,notes,location,start_local,end_local,all_day,reminders_set
		FROM event_overrides WHERE event_id IN (`+in+`) ORDER BY event_id,key`, args...)
	if err != nil {
		return nil, err
	}
	type row struct {
		id           string
		o            Override
		remindersSet bool
	}
	var list []row
	for rows.Next() {
		var r row
		var title, notes, loc, start, end sql.NullString
		var allDay sql.NullBool
		if err := rows.Scan(&r.id, &r.o.Key, &r.o.Cancelled, &title, &notes, &loc, &start, &end, &allDay, &r.remindersSet); err != nil {
			rows.Close()
			return nil, err
		}
		r.o.Title, r.o.Notes, r.o.Location = nullStr(title), nullStr(notes), nullStr(loc)
		r.o.Start, r.o.End = nullStr(start), nullStr(end)
		if allDay.Valid {
			r.o.AllDay = &allDay.Bool
		}
		list = append(list, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rem := map[string]map[string][]Reminder{}
	rr, err := q.QueryContext(ctx, `SELECT event_id,override_key,minutes_before FROM event_reminders
		WHERE override_key<>'' AND event_id IN (`+in+`) ORDER BY minutes_before DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rr.Close()
	for rr.Next() {
		var id, key string
		var m int
		if err := rr.Scan(&id, &key, &m); err != nil {
			return nil, err
		}
		if rem[id] == nil {
			rem[id] = map[string][]Reminder{}
		}
		rem[id][key] = append(rem[id][key], Reminder{MinutesBefore: m})
	}
	if err := rr.Err(); err != nil {
		return nil, err
	}
	for _, r := range list {
		if r.remindersSet {
			rs := rem[r.id][r.o.Key]
			if rs == nil {
				rs = []Reminder{}
			}
			r.o.Reminders = &rs
		}
		out[r.id] = append(out[r.id], r.o)
	}
	for id := range out {
		sort.Slice(out[id], func(i, j int) bool { return out[id][i].Key < out[id][j].Key })
	}
	return out, nil
}

func nullStr(n sql.NullString) *string {
	if !n.Valid {
		return nil
	}
	return &n.String
}

func inList(ids []string) (string, []any) {
	ph := make([]byte, 0, len(ids)*2)
	args := make([]any, len(ids))
	for i, id := range ids {
		if i > 0 {
			ph = append(ph, ',')
		}
		ph = append(ph, '?')
		args[i] = id
	}
	return string(ph), args
}
