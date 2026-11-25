package events

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

func TestTooManyRDatesAreRejected(t *testing.T) {
	f := newFixture(t)
	rdates := make([]string, MaxRDates+1)
	for i := range rdates {
		rdates[i] = fmt.Sprintf("2027-01-01T%02d:%02d:%02d", i/3600%24, i/60%60, i%60)
	}
	_, err := Create(context.Background(), f.db, f.actor(), Input{
		Title: "flood", Start: "2026-12-01T09:00:00", End: "2026-12-01T10:00:00", TZ: "UTC", RDates: rdates,
	})
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("want a validation error, got %v", err)
	}
	if _, err := Create(context.Background(), f.db, f.actor(), Input{
		Title: "ok", Start: "2026-12-01T09:00:00", End: "2026-12-01T10:00:00", TZ: "UTC", RDates: rdates[:MaxRDates],
	}); err != nil {
		t.Fatalf("at the limit: %v", err)
	}
}
