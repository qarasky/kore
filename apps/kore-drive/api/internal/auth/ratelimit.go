package auth

import (
	"sync"
	"time"
)

// Limiter counts attempts per key within a sliding window, in memory.
// Attempts are reserved up front so concurrent requests cannot exceed max.
type Limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	now    func() time.Time
	hits   map[string][]time.Time
}

// NewLimiter allows up to max attempts per key within window.
func NewLimiter(max int, window time.Duration) *Limiter {
	return NewLimiterClock(max, window, time.Now)
}

// NewLimiterClock is NewLimiter with an injectable clock.
func NewLimiterClock(max int, window time.Duration, now func() time.Time) *Limiter {
	return &Limiter{max: max, window: window, now: now, hits: map[string][]time.Time{}}
}

func (l *Limiter) prune(key string, now time.Time) []time.Time {
	ts := l.hits[key]
	i := 0
	for i < len(ts) && now.Sub(ts[i]) >= l.window {
		i++
	}
	ts = ts[i:]
	if len(ts) == 0 {
		delete(l.hits, key)
		return nil
	}
	l.hits[key] = ts
	return ts
}

// Attempt atomically checks and records an attempt for key. It returns false
// (recording nothing) when key is already at the limit. Call Reset after a
// successful login to clear the key.
func (l *Limiter) Attempt(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if len(l.prune(key, now)) >= l.max {
		return false
	}
	l.hits[key] = append(l.hits[key], now)
	return true
}

// Reset clears key (after a successful login).
func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.hits, key)
}
