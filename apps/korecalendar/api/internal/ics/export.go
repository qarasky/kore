package ics

import (
	"bytes"
	"fmt"
	"strconv"
	"strings"
	"time"

	ical "github.com/emersion/go-ical"
	"github.com/qarasky/korecalendar/api/internal/events"
)

// timeProp builds DTSTART-like properties: a date for all-day events, UTC
// with a Z suffix, or a local time with its TZID.
func timeProp(name string, walls []string, tz string, allDay bool) *ical.Prop {
	p := ical.NewProp(name)
	vals := make([]string, 0, len(walls))
	for _, w := range walls {
		t, err := time.Parse(layoutFor(allDay), w)
		if err != nil {
			continue
		}
		if allDay {
			vals = append(vals, t.Format("20060102"))
		} else if tz == "UTC" || tz == "" {
			vals = append(vals, t.Format("20060102T150405")+"Z")
		} else {
			vals = append(vals, t.Format("20060102T150405"))
		}
	}
	p.Value = strings.Join(vals, ",")
	switch {
	case allDay:
		p.SetValueType(ical.ValueDate)
	case tz != "UTC" && tz != "":
		p.Params.Set("TZID", tz)
	}
	return p
}

func alarmComponents(title string, rs []events.Reminder) []*ical.Component {
	var out []*ical.Component
	for _, r := range rs {
		a := ical.NewComponent("VALARM")
		a.Props.SetText("ACTION", "DISPLAY")
		a.Props.SetText("DESCRIPTION", title)
		t := ical.NewProp("TRIGGER")
		if r.MinutesBefore == 0 {
			t.Value = "PT0S"
		} else {
			t.Value = fmt.Sprintf("-PT%dM", r.MinutesBefore)
		}
		a.Props.Set(t)
		out = append(out, a)
	}
	return out
}

func setText(c *ical.Component, name, value string) {
	if value != "" {
		c.Props.SetText(name, value)
	}
}

// Export writes the events (with their overrides, keyed by event id) as an
// iCalendar file. An event imported from a file keeps that file's UID; others
// use their id.
func Export(evs []events.Event, overrides map[string][]events.Override) ([]byte, error) {
	cal := ical.NewCalendar()
	cal.Props.SetText("VERSION", "2.0")
	cal.Props.SetText("PRODID", "-//KoreCalendar//EN")
	cal.Props.SetText("CALSCALE", "GREGORIAN")
	for _, e := range evs {
		uid := e.ICSUID
		if uid == "" {
			uid = e.ID
		}
		ev := ical.NewEvent()
		ev.Props.SetText("UID", uid)
		ev.Props.SetDateTime("DTSTAMP", time.Unix(e.UpdatedAt, 0).UTC())
		seq := ical.NewProp("SEQUENCE")
		seq.Value = strconv.Itoa(max(e.Version-1, 0))
		ev.Props.Set(seq)
		ev.Props.SetText("SUMMARY", e.Title)
		setText(ev.Component, "DESCRIPTION", e.Notes)
		setText(ev.Component, "LOCATION", e.Location)
		ev.Props.Set(timeProp("DTSTART", []string{e.Start}, e.TZ, e.AllDay))
		ev.Props.Set(timeProp("DTEND", []string{e.End}, e.TZ, e.AllDay))
		if e.RRule != "" {
			rr := ical.NewProp("RRULE")
			rr.Value = strings.TrimPrefix(e.RRule, "RRULE:")
			ev.Props.Set(rr)
		}
		if len(e.RDates) > 0 {
			ev.Props.Set(timeProp("RDATE", e.RDates, e.TZ, e.AllDay))
		}
		if len(e.Exdates) > 0 {
			ev.Props.Set(timeProp("EXDATE", e.Exdates, e.TZ, e.AllDay))
		}
		ev.Children = append(ev.Children, alarmComponents(e.Title, e.Reminders)...)
		cal.Children = append(cal.Children, ev.Component)

		ms, e1 := time.Parse(layoutFor(e.AllDay), e.Start)
		me, e2 := time.Parse(layoutFor(e.AllDay), e.End)
		for _, o := range overrides[e.ID] {
			if o.Cancelled || e1 != nil || e2 != nil {
				continue
			}
			allDay := e.AllDay
			if o.AllDay != nil {
				allDay = *o.AllDay
			}
			start := o.Key
			if o.Start != nil {
				start = *o.Start
			}
			st, err := time.Parse(layoutFor(allDay), start)
			if err != nil {
				continue
			}
			end := st.Add(me.Sub(ms)).Format(layoutFor(allDay))
			if o.End != nil {
				end = *o.End
			}
			title, notes, loc, rs := e.Title, e.Notes, e.Location, e.Reminders
			if o.Title != nil {
				title = *o.Title
			}
			if o.Notes != nil {
				notes = *o.Notes
			}
			if o.Location != nil {
				loc = *o.Location
			}
			if o.Reminders != nil {
				rs = *o.Reminders
			}
			ov := ical.NewEvent()
			ov.Props.SetText("UID", uid)
			ov.Props.SetDateTime("DTSTAMP", time.Unix(e.UpdatedAt, 0).UTC())
			ov.Props.Set(timeProp("RECURRENCE-ID", []string{o.Key}, e.TZ, e.AllDay))
			ov.Props.SetText("SUMMARY", title)
			setText(ov.Component, "DESCRIPTION", notes)
			setText(ov.Component, "LOCATION", loc)
			ov.Props.Set(timeProp("DTSTART", []string{start}, e.TZ, allDay))
			ov.Props.Set(timeProp("DTEND", []string{end}, e.TZ, allDay))
			ov.Children = append(ov.Children, alarmComponents(title, rs)...)
			cal.Children = append(cal.Children, ov.Component)
		}
	}
	var buf bytes.Buffer
	if err := ical.NewEncoder(&buf).Encode(cal); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
