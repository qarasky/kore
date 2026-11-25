// Package ics reads and writes iCalendar (.ics) files for KoreCalendar's
// events: recurrence rules, exclusions, single-occurrence overrides and
// reminders survive a round trip. Rules outside the supported subset are
// reported per event and never approximated.
package ics

import (
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	ical "github.com/emersion/go-ical"
	"github.com/qarasky/korecalendar/api/internal/events"
	"github.com/qarasky/korecalendar/api/internal/recur"
)

const (
	wallLayout = "2006-01-02T15:04:05"
	dateLayout = "2006-01-02"
)

// ErrNotICal means the input is not an iCalendar file.
var ErrNotICal = errors.New("not a valid iCalendar file")

// ParsedEvent is one series (or single event) read from a file.
type ParsedEvent struct {
	Index     int // position of the VEVENT in the file, counting series only
	UID       string
	Input     events.Input
	Exdates   []string
	Overrides []events.Override
}

// Issue is a problem with one event of the file.
type Issue struct {
	Index  int    `json:"index"`
	UID    string `json:"uid"`
	Reason string `json:"reason"`
}

// tval is a parsed DATE or DATE-TIME property value.
type tval struct {
	allDay  bool
	wall    string // wall time in tz (a date when allDay)
	tz      string
	instant time.Time
}

// resolveTZ maps a TZID to an IANA zone name, if it is one (also accepting the
// "/vendor/2005/Europe/Berlin" style some exporters use).
func resolveTZ(tzid string) (string, bool) {
	tzid = strings.TrimSpace(tzid)
	if tzid == "" {
		return "", false
	}
	if _, err := time.LoadLocation(tzid); err == nil {
		return tzid, true
	}
	parts := strings.Split(strings.Trim(tzid, "/"), "/")
	for i := 1; i < len(parts); i++ {
		cand := strings.Join(parts[i:], "/")
		if _, err := time.LoadLocation(cand); err == nil {
			return cand, true
		}
	}
	return "", false
}

// parseTime reads a DTSTART-like property. Floating times and unknown zones
// use defaultTZ; the second result is a warning to show the user, if any.
func parseTime(p ical.Prop, defaultTZ string) (tval, string, error) {
	v := strings.TrimSpace(p.Value)
	switch {
	case strings.EqualFold(p.Params.Get("VALUE"), "DATE") || len(v) == 8:
		d, err := time.ParseInLocation("20060102", v, time.UTC)
		if err != nil {
			return tval{}, "", fmt.Errorf("%s: %q is not a date", p.Name, v)
		}
		return tval{allDay: true, wall: d.Format(dateLayout), tz: "UTC", instant: d}, "", nil
	case strings.HasSuffix(v, "Z") || strings.HasSuffix(v, "z"):
		t, err := time.ParseInLocation("20060102T150405Z", strings.ToUpper(v), time.UTC)
		if err != nil {
			return tval{}, "", fmt.Errorf("%s: %q is not a date-time", p.Name, v)
		}
		return tval{wall: t.Format(wallLayout), tz: "UTC", instant: t}, "", nil
	}
	tz, warn := defaultTZ, ""
	if tzid := p.Params.Get("TZID"); tzid != "" {
		if name, ok := resolveTZ(tzid); ok {
			tz = name
		} else {
			warn = fmt.Sprintf("unknown time zone %q, used %s instead", tzid, defaultTZ)
		}
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return tval{}, "", fmt.Errorf("unknown default time zone %q", tz)
	}
	t, err := time.ParseInLocation("20060102T150405", v, loc)
	if err != nil {
		return tval{}, "", fmt.Errorf("%s: %q is not a date-time", p.Name, v)
	}
	return tval{wall: t.Format(wallLayout), tz: tz, instant: t.UTC()}, warn, nil
}

// wallIn returns v as a wall time in the event's zone.
func wallIn(v tval, tz string) string {
	if v.allDay {
		return v.wall
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return v.wall
	}
	return v.instant.In(loc).Format(wallLayout)
}

func layoutFor(allDay bool) string {
	if allDay {
		return dateLayout
	}
	return wallLayout
}

func text(c *ical.Component, name string) string {
	p := c.Props.Get(name)
	if p == nil {
		return ""
	}
	if s, err := p.Text(); err == nil {
		return s
	}
	return p.Value
}

// listProp splits a (possibly comma-separated, possibly repeated) property
// into single-valued copies.
func listProp(c *ical.Component, name string) []ical.Prop {
	var out []ical.Prop
	for _, p := range c.Props.Values(name) {
		for _, v := range strings.Split(p.Value, ",") {
			if v = strings.TrimSpace(v); v != "" && !strings.Contains(v, "/") { // skip PERIOD values
				out = append(out, ical.Prop{Name: p.Name, Params: p.Params, Value: v})
			}
		}
	}
	return out
}

func sortedUnique(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}

// alarms reads VALARM reminders that fire before the start, newest-lead first.
func alarms(c *ical.Component) []events.Reminder {
	seen := map[int]bool{}
	var out []events.Reminder
	for _, a := range c.Children {
		if a.Name != "VALARM" {
			continue
		}
		t := a.Props.Get("TRIGGER")
		if t == nil || strings.EqualFold(t.Params.Get("VALUE"), "DATE-TIME") || strings.EqualFold(t.Params.Get("RELATED"), "END") {
			continue
		}
		d, err := t.Duration()
		if err != nil || d > 0 {
			continue
		}
		m := int(-d / time.Minute)
		if m > events.MaxReminderMinutes || seen[m] {
			continue
		}
		seen[m] = true
		out = append(out, events.Reminder{MinutesBefore: m})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].MinutesBefore > out[j].MinutesBefore })
	return out
}

func sameReminders(a, b []events.Reminder) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// endWall works out the event's end as a wall time in tz from DTEND or
// DURATION; "" when the file gives neither.
func endWall(c *ical.Component, start tval, tz, defaultTZ string) (string, error) {
	if p := c.Props.Get("DTEND"); p != nil {
		e, _, err := parseTime(*p, defaultTZ)
		if err != nil {
			return "", err
		}
		if e.allDay != start.allDay {
			return "", errors.New("DTSTART and DTEND must both be dates or both be date-times")
		}
		return wallIn(e, tz), nil
	}
	if p := c.Props.Get("DURATION"); p != nil {
		d, err := p.Duration()
		if err != nil {
			return "", fmt.Errorf("DURATION: %v", err)
		}
		w, err := time.Parse(layoutFor(start.allDay), wallIn(start, tz))
		if err != nil {
			return "", err
		}
		return w.Add(d).Format(layoutFor(start.allDay)), nil
	}
	return "", nil
}

// Parse reads an .ics file. Events that cannot be imported are returned as
// errors (by their position in the file) while the rest still import;
// warnings note data that was adjusted or ignored. defaultTZ is the zone for
// floating times and unknown zones.
func Parse(r io.Reader, defaultTZ string) (items []ParsedEvent, errs, warns []Issue, err error) {
	cal, err := ical.NewDecoder(r).Decode()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("%w: %v", ErrNotICal, err)
	}
	var masters []*ical.Component
	overrides := map[string][]*ical.Component{}
	for _, c := range cal.Children {
		if c.Name != "VEVENT" {
			continue
		}
		if c.Props.Get("RECURRENCE-ID") != nil {
			uid := text(c, "UID")
			overrides[uid] = append(overrides[uid], c)
			continue
		}
		masters = append(masters, c)
	}
	used := map[string]bool{}
	for i, c := range masters {
		uid := text(c, "UID")
		fail := func(reason string) { errs = append(errs, Issue{Index: i, UID: uid, Reason: reason}) }
		warn := func(reason string) { warns = append(warns, Issue{Index: i, UID: uid, Reason: reason}) }
		if strings.EqualFold(text(c, "STATUS"), "CANCELLED") {
			warn("cancelled event skipped")
			continue
		}
		ds := c.Props.Get("DTSTART")
		if ds == nil {
			fail("the event has no DTSTART")
			continue
		}
		start, w, perr := parseTime(*ds, defaultTZ)
		if perr != nil {
			fail(perr.Error())
			continue
		}
		if w != "" {
			warn(w)
		}
		tz := start.tz
		if start.allDay { // a date has no zone of its own: it lives in the user's
			tz = defaultTZ
		}
		end, perr := endWall(c, start, tz, defaultTZ)
		if perr != nil {
			fail(perr.Error())
			continue
		}
		in := events.Input{Title: text(c, "SUMMARY"), Notes: text(c, "DESCRIPTION"), Location: text(c, "LOCATION"),
			Start: wallIn(start, tz), End: end, TZ: tz, AllDay: start.allDay, Reminders: alarms(c)}
		if in.Title == "" {
			in.Title = "(no title)"
		}
		if rr := c.Props.Get("RRULE"); rr != nil {
			if verr := recur.ValidateRule(rr.Value); verr != nil {
				fail(strings.TrimPrefix(verr.Error(), recur.ErrUnsupportedRule.Error()+": "))
				continue
			}
			in.RRule = strings.TrimPrefix(strings.TrimSpace(rr.Value), "RRULE:")
		}
		pe := ParsedEvent{Index: i, UID: uid, Input: in}
		for _, p := range listProp(c, "RDATE") {
			if v, _, err := parseTime(p, defaultTZ); err == nil {
				pe.Input.RDates = append(pe.Input.RDates, wallIn(v, tz))
			}
		}
		for _, p := range listProp(c, "EXDATE") {
			if v, _, err := parseTime(p, defaultTZ); err == nil {
				pe.Exdates = append(pe.Exdates, wallIn(v, tz))
			}
		}
		pe.Input.RDates = sortedUnique(pe.Input.RDates)
		for _, oc := range overrides[uid] {
			used[uid] = true
			ov, cancelled, owarn := override(oc, pe, defaultTZ)
			if owarn != "" {
				warn(owarn)
			}
			switch {
			case cancelled != "":
				pe.Exdates = append(pe.Exdates, cancelled)
			case ov != nil:
				pe.Overrides = append(pe.Overrides, *ov)
			}
		}
		pe.Exdates = sortedUnique(pe.Exdates)
		items = append(items, pe)
	}
	for uid := range overrides {
		if !used[uid] {
			warns = append(warns, Issue{Index: -1, UID: uid, Reason: "changed occurrence without its series ignored"})
		}
	}
	return items, errs, warns, nil
}

// override turns a VEVENT with RECURRENCE-ID into an Override relative to its
// series, or reports the key as cancelled. Fields equal to the series' are left
// unset so they keep following it.
func override(c *ical.Component, m ParsedEvent, defaultTZ string) (ov *events.Override, cancelled, warning string) {
	rid, _, err := parseTime(*c.Props.Get("RECURRENCE-ID"), defaultTZ)
	if err != nil {
		return nil, "", "changed occurrence ignored: " + err.Error()
	}
	key := wallIn(rid, m.Input.TZ)
	if strings.EqualFold(text(c, "STATUS"), "CANCELLED") {
		return nil, key, ""
	}
	o := events.Override{Key: key}
	if t := text(c, "SUMMARY"); t != "" && t != m.Input.Title {
		o.Title = &t
	}
	if c.Props.Get("DESCRIPTION") != nil {
		if n := text(c, "DESCRIPTION"); n != m.Input.Notes {
			o.Notes = &n
		}
	}
	if c.Props.Get("LOCATION") != nil {
		if l := text(c, "LOCATION"); l != m.Input.Location {
			o.Location = &l
		}
	}
	allDay := m.Input.AllDay
	if ds := c.Props.Get("DTSTART"); ds != nil {
		start, _, err := parseTime(*ds, defaultTZ)
		if err != nil {
			return nil, "", "changed occurrence ignored: " + err.Error()
		}
		if start.allDay != m.Input.AllDay {
			a := start.allDay
			o.AllDay, allDay = &a, a
		}
		s := wallIn(start, m.Input.TZ)
		if s != key {
			o.Start = &s
		}
		if e, err := endWall(c, start, m.Input.TZ, defaultTZ); err == nil && e != "" {
			// compare with the end the series would give this occurrence
			ms, e1 := time.Parse(layoutFor(m.Input.AllDay), m.Input.Start)
			me, e2 := time.Parse(layoutFor(m.Input.AllDay), m.Input.End)
			st, e3 := time.Parse(layoutFor(allDay), s)
			if e1 != nil || e2 != nil || e3 != nil || e != st.Add(me.Sub(ms)).Format(layoutFor(allDay)) {
				o.End = &e
			}
		}
	}
	if rs := alarms(c); len(rs) > 0 && !sameReminders(rs, m.Input.Reminders) {
		o.Reminders = &rs
	}
	if o.Title == nil && o.Notes == nil && o.Location == nil && o.Start == nil && o.End == nil && o.AllDay == nil && o.Reminders == nil {
		return nil, "", ""
	}
	return &o, "", ""
}
