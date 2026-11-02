package dav

import (
	"context"
	"database/sql"
	"errors"

	"github.com/emersion/go-ical"
	"github.com/emersion/go-webdav"
	"github.com/emersion/go-webdav/caldav"
	"github.com/qarasky/korecalendar/api/internal/auth"
	"github.com/qarasky/korecalendar/api/internal/calendars"
	"github.com/qarasky/korecalendar/api/internal/events"
)

// Backend serves the caller's calendars to the CalDAV library.
type Backend struct{ db *sql.DB }

func principal(ctx context.Context) (auth.Principal, error) {
	p, ok := auth.FromContext(ctx)
	if !ok {
		return auth.Principal{}, webdav.NewHTTPError(401, errors.New("authentication required"))
	}
	return p, nil
}

func notFound() error { return webdav.NewHTTPError(404, errors.New("not found")) }

// CurrentUserPrincipal is /dav/{user_id}/.
func (b *Backend) CurrentUserPrincipal(ctx context.Context) (string, error) {
	p, err := principal(ctx)
	if err != nil {
		return "", err
	}
	return Prefix + "/" + p.UserID + "/", nil
}

// CalendarHomeSetPath is /dav/{user_id}/calendars/.
func (b *Backend) CalendarHomeSetPath(ctx context.Context) (string, error) {
	p, err := principal(ctx)
	if err != nil {
		return "", err
	}
	return Prefix + "/" + p.UserID + "/calendars/", nil
}

func (b *Backend) CreateCalendar(ctx context.Context, c *caldav.Calendar) error {
	return webdav.NewHTTPError(403, errors.New("calendars are managed in the web app or the REST API"))
}

func (b *Backend) ListCalendars(ctx context.Context) ([]caldav.Calendar, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	cals, err := calendars.List(ctx, b.db, p.UserID)
	if err != nil {
		return nil, err
	}
	out := make([]caldav.Calendar, len(cals))
	for i, c := range cals {
		out[i] = davCalendar(p.UserID, c)
	}
	return out, nil
}

func davCalendar(userID string, c calendars.Calendar) caldav.Calendar {
	return caldav.Calendar{Path: calendarPath(userID, c.ID), Name: c.Name, MaxResourceSize: maxBody, SupportedComponentSet: []string{ical.CompEvent}}
}

func (b *Backend) GetCalendar(ctx context.Context, path string) (*caldav.Calendar, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	t, err := resolve(ctx, b.db, p.UserID, path)
	if err != nil {
		return nil, err
	}
	if t.name != "" {
		return nil, notFound()
	}
	c := davCalendar(p.UserID, t.cal)
	return &c, nil
}

func (b *Backend) GetCalendarObject(ctx context.Context, path string, req *caldav.CalendarCompRequest) (*caldav.CalendarObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	t, err := resolve(ctx, b.db, p.UserID, path)
	if err != nil || t.name == "" {
		return nil, notFound()
	}
	e, err := events.FindLiveByUID(ctx, b.db, p.UserID, t.uid())
	if errors.Is(err, events.ErrNotFound) || (err == nil && e.CalendarID != t.cal.ID) {
		return nil, notFound()
	}
	if err != nil {
		return nil, err
	}
	ovs, err := events.OverridesFor(ctx, b.db, []string{e.ID})
	if err != nil {
		return nil, err
	}
	o, err := eventToObject(e, ovs[e.ID], p.UserID)
	if err != nil {
		return nil, err
	}
	return &o, nil
}

func (b *Backend) ListCalendarObjects(ctx context.Context, path string, req *caldav.CalendarCompRequest) ([]caldav.CalendarObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	t, err := resolve(ctx, b.db, p.UserID, path)
	if err != nil || t.name != "" {
		return nil, notFound()
	}
	return objectsOf(ctx, b.db, p.UserID, t.cal.ID, nil)
}

// QueryCalendarObjects answers calendar-query. A time range is resolved with
// the same expansion as /api/occurrences (so DST and exclusions are right) and
// the remaining filters (properties, text) are applied by the library.
func (b *Backend) QueryCalendarObjects(ctx context.Context, path string, q *caldav.CalendarQuery) ([]caldav.CalendarObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	t, err := resolve(ctx, b.db, p.UserID, path)
	if err != nil || t.name != "" {
		return nil, notFound()
	}
	if q == nil {
		return objectsOf(ctx, b.db, p.UserID, t.cal.ID, nil)
	}
	filter, from, to := stripTimeRange(q.CompFilter)
	var only map[string]bool
	if !from.IsZero() {
		if only, err = eventsInRange(ctx, b.db, p.UserID, t.cal.ID, from, to); err != nil {
			return nil, err
		}
	}
	objs, err := objectsOf(ctx, b.db, p.UserID, t.cal.ID, only)
	if err != nil {
		return nil, err
	}
	return caldav.Filter(&caldav.CalendarQuery{CompRequest: q.CompRequest, CompFilter: filter}, objs)
}
func (b *Backend) PutCalendarObject(ctx context.Context, path string, cal *ical.Calendar, opts *caldav.PutCalendarObjectOptions) (*caldav.CalendarObject, error) {
	return nil, notFound()
}

func (b *Backend) DeleteCalendarObject(ctx context.Context, path string) error { return notFound() }
