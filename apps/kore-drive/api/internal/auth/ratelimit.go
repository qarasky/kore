package auth

import (
	"container/list"
	"sync"
	"time"
)

const (
	// defaultMaxKeys caps the number of tracked keys; the oldest key is
	// evicted to make room for a new one.
	defaultMaxKeys = 50000
	// sweepEvery is how often (by the limiter's clock) expired keys are
	// dropped from the whole map.
	sweepEvery = time.Minute
)

// Limiter counts attempts per key within a sliding window, in memory.
// Attempts are reserved up front so concurrent requests cannot exceed max.
// Memory is bounded: expired keys are swept periodically and at most
// maxKeys keys are kept (oldest evicted first).
type Limiter struct {
	mu        sync.Mutex
	max       int
	window    time.Duration
	now       func() time.Time
	hits      map[string]*bucket
	order     *list.List // keys by creation, oldest at the front
	maxKeys   int
	lastSweep time.Time
}

type bucket struct {
	ts   []time.Time
	elem *list.Element
}

// NewLimiter allows up to max attempts per key within window.
func NewLimiter(max int, window time.Duration) *Limiter {
	return NewLimiterClock(max, window, time.Now)
}

// NewLimiterClock is NewLimiter with an injectable clock.
func NewLimiterClock(max int, window time.Duration, now func() time.Time) *Limiter {
	return &Limiter{max: max, window: window, now: now, hits: map[string]*bucket{},
		order: list.New(), maxKeys: defaultMaxKeys, lastSweep: now()}
}

func (l *Limiter) remove(key string, b *bucket) {
	l.order.Remove(b.elem)
	delete(l.hits, key)
}

// prune drops key's expired attempts (and the key once empty).
func (l *Limiter) prune(key string, now time.Time) *bucket {
	b := l.hits[key]
	if b == nil {
		return nil
	}
	i := 0
	for i < len(b.ts) && now.Sub(b.ts[i]) >= l.window {
		i++
	}
	b.ts = b.ts[i:]
	if len(b.ts) == 0 {
		l.remove(key, b)
		return nil
	}
	return b
}

func (l *Limiter) sweep(now time.Time) {
	if now.Sub(l.lastSweep) < sweepEvery {
		return
	}
	l.lastSweep = now
	for k := range l.hits {
		l.prune(k, now)
	}
}

// Attempt atomically checks and records an attempt for key. It returns false
// (recording nothing) when key is already at the limit. Call Reset after a
// successful login to clear the key.
func (l *Limiter) Attempt(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.sweep(now)
	b := l.prune(key, now)
	if b != nil && len(b.ts) >= l.max {
		return false
	}
	if b == nil {
		for len(l.hits) >= l.maxKeys && l.order.Len() > 0 {
			front := l.order.Front()
			k := front.Value.(string)
			l.remove(k, l.hits[k])
		}
		b = &bucket{elem: l.order.PushBack(key)}
		l.hits[key] = b
	}
	b.ts = append(b.ts, now)
	return true
}

// Reset clears key (after a successful login).
func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if b := l.hits[key]; b != nil {
		l.remove(key, b)
	}
}

// Forgive removes key's most recent attempt (e.g. a successful login should
// not count against a shared per-IP budget, but earlier failures still do).
func (l *Limiter) Forgive(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.hits[key]
	if b == nil {
		return
	}
	b.ts = b.ts[:len(b.ts)-1]
	if len(b.ts) == 0 {
		l.remove(key, b)
	}
}

// Len returns the number of tracked keys.
func (l *Limiter) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.hits)
}
