package dav

import (
	"bytes"
	"context"
	"errors"

	"github.com/emersion/go-ical"
	"github.com/emersion/go-webdav"
	"github.com/emersion/go-webdav/caldav"
	"github.com/qarasky/korecalendar/api/internal/auth"
	"github.com/qarasky/korecalendar/api/internal/events"
	"github.com/qarasky/korecalendar/api/internal/ics"
	"github.com/qarasky/korecalendar/api/internal/recur"
	"github.com/qarasky/korecalendar/api/internal/users"
)

func actorOf(p auth.Principal) events.Actor { return events.Actor{UserID: p.UserID, Label: p.Label()} }

func precondition(t caldav.PreconditionType) error { return caldav.NewPreconditionError(t) }

func preconditionFailed(err error) error { return webdav.NewHTTPError(412, err) }

// PutCalendarObject creates or replaces one event series from a client's file.
// What is stored is what the model can hold (see docs/caldav.md); the response
// carries no ETag, so the client re-reads what was actually stored.
func (b *Backend) PutCalendarObject(ctx context.Context, path string, cal *ical.Calendar, opts *caldav.PutCalendarObjectOptions) (*caldav.CalendarObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	t, err := resolve(ctx, b.db, p.UserID, path)
	if err != nil || t.name == "" {
		return nil, notFound()
	}
	kind, uid, err := caldav.ValidateCalendarObject(cal)
	if err != nil || uid == "" {
		return nil, precondition(caldav.PreconditionValidCalendarData)
	}
	if kind != ical.CompEvent {
		return nil, precondition(caldav.PreconditionSupportedCalendarComponent)
	}
	if t.name != uid+".ics" {
		return nil, precondition(caldav.PreconditionValidCalendarObjectResource)
	}
	var buf bytes.Buffer
	if err := ical.NewEncoder(&buf).Encode(cal); err != nil {
		return nil, precondition(caldav.PreconditionValidCalendarData)
	}
	u, err := users.Get(ctx, b.db, p.UserID)
	if err != nil {
		return nil, err
	}
	items, errs, _, err := ics.Parse(&buf, u.Timezone)
	if err != nil {
		return nil, precondition(caldav.PreconditionValidCalendarData)
	}
	if len(errs) > 0 || len(items) != 1 {
		return nil, precondition(caldav.PreconditionValidCalendarObjectResource)
	}
	it := items[0]

	o := events.PutOptions{SameCalendar: true, FreeDeletedUID: true}
	if opts != nil {
		if opts.IfNoneMatch.IsWildcard() {
			o.CreateOnly = true
		}
		if opts.IfMatch.IsSet() {
			cur, err := events.FindLiveByUID(ctx, b.db, p.UserID, uid)
			if errors.Is(err, events.ErrNotFound) {
				return nil, preconditionFailed(errors.New("the resource does not exist"))
			}
			if err != nil {
				return nil, err
			}
			if !opts.IfMatch.IsWildcard() {
				tag, err := opts.IfMatch.ETag()
				if err != nil {
					return nil, preconditionFailed(err)
				}
				v, ok := versionFromETag(tag, cur)
				if !ok {
					return nil, preconditionFailed(errors.New("the ETag does not match"))
				}
				o.IfVersion = &v
			}
		}
	}
	_, err = events.Put(ctx, b.db, actorOf(p), t.cal.ID, events.Imported{UID: it.UID, Input: it.Input, Exdates: it.Exdates, Overrides: it.Overrides}, o)
	var ve *events.ValidationError
	switch {
	case err == nil:
		return &caldav.CalendarObject{Path: path}, nil
	case errors.Is(err, events.ErrVersionConflict), errors.Is(err, events.ErrExists):
		return nil, preconditionFailed(err)
	case errors.Is(err, events.ErrNotFound) && o.IfVersion != nil:
		return nil, preconditionFailed(err)
	case errors.Is(err, events.ErrNotFound):
		return nil, notFound()
	case errors.Is(err, events.ErrUIDConflict):
		return nil, precondition(caldav.PreconditionNoUIDConflict)
	case errors.As(err, &ve), errors.Is(err, recur.ErrUnsupportedRule):
		return nil, precondition(caldav.PreconditionValidCalendarObjectResource)
	}
	return nil, err
}

// DeleteCalendarObject soft-deletes the series (restorable for 30 days). An
// If-Match header, which the library does not pass on, arrives in the context.
func (b *Backend) DeleteCalendarObject(ctx context.Context, path string) error {
	p, err := principal(ctx)
	if err != nil {
		return err
	}
	t, err := resolve(ctx, b.db, p.UserID, path)
	if err != nil || t.name == "" {
		return notFound()
	}
	e, err := events.FindLiveByUID(ctx, b.db, p.UserID, t.uid())
	if errors.Is(err, events.ErrNotFound) || (err == nil && e.CalendarID != t.cal.ID) {
		return notFound()
	}
	if err != nil {
		return err
	}
	var ifMatch *int
	if m, _ := ctx.Value(ifMatchKey{}).(string); m != "" && m != "*" {
		v, ok := versionFromETag(m, e)
		if !ok {
			return preconditionFailed(errors.New("the ETag does not match"))
		}
		ifMatch = &v
	}
	_, err = events.Delete(ctx, b.db, actorOf(p), e.ID, events.ScopeAll, "", ifMatch)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, events.ErrVersionConflict):
		return preconditionFailed(err)
	case errors.Is(err, events.ErrNotFound):
		return notFound()
	}
	return err
}
