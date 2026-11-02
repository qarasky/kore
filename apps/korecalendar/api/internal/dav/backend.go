package dav

import (
	"context"
	"database/sql"
	"errors"

	"github.com/emersion/go-ical"
	"github.com/emersion/go-webdav"
	"github.com/emersion/go-webdav/caldav"
	"github.com/qarasky/korecalendar/api/internal/auth"
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

func (b *Backend) ListCalendars(ctx context.Context) ([]caldav.Calendar, error) { return nil, nil }

func (b *Backend) GetCalendar(ctx context.Context, path string) (*caldav.Calendar, error) {
	return nil, notFound()
}

func (b *Backend) GetCalendarObject(ctx context.Context, path string, req *caldav.CalendarCompRequest) (*caldav.CalendarObject, error) {
	return nil, notFound()
}

func (b *Backend) ListCalendarObjects(ctx context.Context, path string, req *caldav.CalendarCompRequest) ([]caldav.CalendarObject, error) {
	return nil, notFound()
}

func (b *Backend) QueryCalendarObjects(ctx context.Context, path string, q *caldav.CalendarQuery) ([]caldav.CalendarObject, error) {
	return nil, notFound()
}

func (b *Backend) PutCalendarObject(ctx context.Context, path string, cal *ical.Calendar, opts *caldav.PutCalendarObjectOptions) (*caldav.CalendarObject, error) {
	return nil, notFound()
}

func (b *Backend) DeleteCalendarObject(ctx context.Context, path string) error { return notFound() }
