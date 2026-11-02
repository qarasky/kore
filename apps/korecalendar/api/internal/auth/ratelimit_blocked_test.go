package auth

import (
	"testing"
	"time"
)

func TestBlockedPeeksWithoutRecording(t *testing.T) {
	l := NewLimiter(2, time.Minute)
	for i := 0; i < 10; i++ {
		if l.Blocked("k") {
			t.Fatal("blocked before any attempt was recorded")
		}
	}
	l.Attempt("k")
	l.Attempt("k")
	if !l.Blocked("k") {
		t.Fatal("not blocked at the limit")
	}
	l.Reset("k")
	if l.Blocked("k") {
		t.Fatal("still blocked after Reset")
	}
}
