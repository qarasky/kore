package dav

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/emersion/go-ical"
	"github.com/emersion/go-webdav/caldav"
	"github.com/qarasky/korecalendar/api/internal/calendars"
	"github.com/qarasky/korecalendar/api/internal/events"
	"github.com/qarasky/korecalendar/api/internal/ics"
)

func calendarPath(userID, calID string) string {
	return Prefix + "/" + userID + "/calendars/" + calID + "/"
}

func objectPath(userID, calID, uid string) string {
	return calendarPath(userID, calID) + uid + ".ics"
}

// uidOf is the UID an event has on the wire: the one it was imported with,
// else its own id (what the .ics export writes).
func uidOf(e events.Event) string {
	if e.ICSUID != "" {
		return e.ICSUID
	}
	return e.ID
}

// etagFor changes whenever the event does (every edit bumps the version,
// including a change to a single occurrence); the id keeps a re-created event
// from ever matching its predecessor.
func etagFor(e events.Event) string { return e.ID + "-" + strconv.Itoa(e.Version) }

// versionFromETag reads the version out of an If-Match value for event e.
func versionFromETag(tag string, e events.Event) (int, bool) {
	tag = strings.TrimSpace(tag)
	tag = strings.TrimPrefix(tag, "W/")
	tag = strings.Trim(tag, `"`)
	id, v, ok := strings.Cut(tag, "-")
	if !ok || id != e.ID {
		return 0, false
	}
	n, err := strconv.Atoi(v)
	return n, err == nil
}

// eventToObject renders an event series (master, exclusions, changed
// occurrences) as a calendar object, the same file GET /api/export writes.
func eventToObject(e events.Event, ovs []events.Override, userID string) (caldav.CalendarObject, error) {
	data, err := ics.Export([]events.Event{e}, map[string][]events.Override{e.ID: ovs})
	if err != nil {
		return caldav.CalendarObject{}, err
	}
	cal, err := ical.NewDecoder(bytes.NewReader(data)).Decode()
	if err != nil {
		return caldav.CalendarObject{}, err
	}
	return caldav.CalendarObject{
		Path:          objectPath(userID, e.CalendarID, uidOf(e)),
		ModTime:       time.Unix(e.UpdatedAt, 0),
		ContentLength: int64(len(data)),
		ETag:          etagFor(e),
		Data:          cal,
	}, nil
}

// target is what a request path points at inside the caller's own tree.
type target struct {
	cal  calendars.Calendar
	name string // "" for the collection itself, else "{uid}.ics"
}

// resolve parses /dav/{user}/calendars/{calendar}[/{uid}.ics] for the caller.
// Anything that is not the caller's own live calendar is a 404 (never 403).
func resolve(ctx context.Context, db *sql.DB, userID, path string) (target, error) {
	rest := strings.Trim(strings.TrimPrefix(path, Prefix), "/")
	parts := strings.Split(rest, "/")
	if len(parts) < 3 || len(parts) > 4 || parts[0] != userID || parts[1] != "calendars" || parts[2] == "" {
		return target{}, notFound()
	}
	c, err := calendars.Get(ctx, db, userID, parts[2])
	if errors.Is(err, calendars.ErrNotFound) {
		return target{}, notFound()
	}
	if err != nil {
		return target{}, err
	}
	t := target{cal: c}
	if len(parts) == 4 {
		if parts[3] == "" || !strings.HasSuffix(parts[3], ".ics") {
			return target{}, notFound()
		}
		t.name = parts[3]
	}
	return t, nil
}

// uid of a resource name "{uid}.ics".
func (t target) uid() string { return strings.TrimSuffix(t.name, ".ics") }

// objectsOf lists the live events of a calendar as calendar objects.
func objectsOf(ctx context.Context, db *sql.DB, userID, calID string, only map[string]bool) ([]caldav.CalendarObject, error) {
	evs, ovs, err := events.ListForExport(ctx, db, userID, []string{calID})
	if err != nil {
		return nil, err
	}
	out := make([]caldav.CalendarObject, 0, len(evs))
	for _, e := range evs {
		if only != nil && !only[e.ID] {
			continue
		}
		o, err := eventToObject(e, ovs[e.ID], userID)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, nil
}
