// Package auth implements passwords, sessions, rate limiting and HTTP middleware.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"
)

const (
	argonTime    = 1
	argonMemory  = 64 * 1024
	argonThreads = 4
	argonKeyLen  = 32
	saltLen      = 16
)

// ErrBusy is returned when no argon2 slot frees up within the wait limit.
// HTTP handlers map it to 503 busy with Retry-After.
var ErrBusy = errors.New("auth: too many concurrent password hashes")

// Each argon2 computation allocates argonMemory KiB (64 MiB), so the number
// running at once is capped; callers wait up to hashWait for a slot.
var (
	hashSlots = make(chan struct{}, max(2, runtime.GOMAXPROCS(0)))
	hashWait  = 2 * time.Second
	// hashHook, if set (tests only), runs while a slot is held.
	hashHook func()
)

// SetHashConcurrencyForTest replaces the argon2 slot pool with n slots (0 =
// always busy) and the wait limit, returning a function that restores the
// previous values. Only for tests; not safe while hashes are running.
func SetHashConcurrencyForTest(n int, wait time.Duration) (restore func()) {
	oldSlots, oldWait := hashSlots, hashWait
	hashSlots, hashWait = make(chan struct{}, n), wait
	return func() { hashSlots, hashWait = oldSlots, oldWait }
}

// idKey runs argon2id while holding a slot, or fails with ErrBusy.
func idKey(pw, salt []byte, t, m uint32, p uint8, n uint32) ([]byte, error) {
	slots := hashSlots
	timer := time.NewTimer(hashWait)
	defer timer.Stop()
	select {
	case slots <- struct{}{}:
	case <-timer.C:
		return nil, ErrBusy
	}
	defer func() { <-slots }()
	if hashHook != nil {
		hashHook()
	}
	return argon2.IDKey(pw, salt, t, m, p, n), nil
}

// HashPassword returns an encoded argon2id hash with a random salt, or
// ErrBusy when too many hashes are already running.
func HashPassword(pw string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := idKey([]byte(pw), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	if err != nil {
		return "", err
	}
	return encodeHash(salt, key), nil
}

func encodeHash(salt, key []byte) string {
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version,
		argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key))
}

// VerifyPassword checks pw against an encoded hash in constant time. A
// malformed hash is (false, nil); a saturated slot pool is ErrBusy.
func VerifyPassword(hash, pw string) (bool, error) {
	parts := strings.Split(hash, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, nil
	}
	var v int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &v); err != nil || v != argon2.Version {
		return false, nil
	}
	var m, t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil || m == 0 || t == 0 || p == 0 || m > 1<<21 {
		return false, nil
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, nil
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false, nil
	}
	got, err := idKey([]byte(pw), salt, t, m, p, uint32(len(want)))
	if err != nil {
		return false, err
	}
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}
