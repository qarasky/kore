package auth

import (
	"errors"
	"fmt"
	"runtime"
	"testing"
	"time"
)

func TestHashSlotsDefaultSize(t *testing.T) {
	want := max(2, runtime.GOMAXPROCS(0))
	if got := cap(hashSlots); got != want {
		t.Fatalf("cap %d, want %d", got, want)
	}
}

func TestHashBusyReturnsErrBusy(t *testing.T) {
	h, err := HashPassword("pw-123456")
	if err != nil {
		t.Fatal(err)
	}
	restore := SetHashConcurrencyForTest(1, 20*time.Millisecond)
	defer restore()
	hashSlots <- struct{}{} // occupy the only slot
	start := time.Now()
	if _, err := HashPassword("x"); !errors.Is(err, ErrBusy) {
		t.Fatalf("hash: %v", err)
	}
	if time.Since(start) < 20*time.Millisecond {
		t.Fatal("did not wait")
	}
	if _, err := VerifyPassword(h, "pw-123456"); !errors.Is(err, ErrBusy) {
		t.Fatalf("verify: %v", err)
	}
	<-hashSlots // free it: works again, and every path released its slot
	for i := 0; i < 3; i++ {
		if ok, err := VerifyPassword(h, "pw-123456"); !ok || err != nil {
			t.Fatalf("after release: %v %v", ok, err)
		}
	}
	if ok, err := VerifyPassword("garbage", "x"); ok || err != nil {
		t.Fatalf("garbage: %v %v", ok, err)
	}
}

func TestLimiterPrunesExpiredKeys(t *testing.T) {
	now := time.Unix(1000, 0)
	l := NewLimiterClock(5, time.Minute, func() time.Time { return now })
	for i := 0; i < 10; i++ {
		l.Attempt(fmt.Sprintf("k%d", i))
	}
	if n := l.Len(); n != 10 {
		t.Fatalf("len %d", n)
	}
	now = now.Add(2 * time.Minute)
	l.Attempt("fresh")
	if n := l.Len(); n != 1 {
		t.Fatalf("expired keys not pruned: len %d", n)
	}
}

func TestLimiterCapsKeys(t *testing.T) {
	now := time.Unix(1000, 0)
	l := NewLimiterClock(5, time.Hour, func() time.Time { return now })
	l.maxKeys = 100
	for i := 0; i < 500; i++ {
		now = now.Add(time.Millisecond)
		if !l.Attempt(fmt.Sprintf("k%d", i)) {
			t.Fatalf("new key %d blocked", i)
		}
		if n := l.Len(); n > 100 {
			t.Fatalf("len %d > cap", n)
		}
	}
	// The newest keys survive, the oldest were evicted.
	l.mu.Lock()
	_, newest := l.hits["k499"]
	_, oldest := l.hits["k0"]
	l.mu.Unlock()
	if !newest || oldest {
		t.Fatalf("newest kept %v, oldest kept %v", newest, oldest)
	}
}

func TestLimiterForgive(t *testing.T) {
	now := time.Unix(1000, 0)
	l := NewLimiterClock(2, time.Minute, func() time.Time { return now })
	l.Attempt("ip")
	l.Attempt("ip")
	l.Forgive("ip")
	if !l.Attempt("ip") {
		t.Fatal("forgive did not free an attempt")
	}
	if l.Attempt("ip") {
		t.Fatal("forgive freed more than one attempt")
	}
	l.Forgive("missing") // no panic
}
