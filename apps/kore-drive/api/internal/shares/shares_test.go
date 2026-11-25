package shares

import (
	"strings"
	"testing"
	"time"
)

func TestToken(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		tok := NewToken()
		if !ValidToken(tok) || strings.ContainsAny(tok, "+/=") || seen[tok] {
			t.Fatalf("bad token %q", tok)
		}
		seen[tok] = true
	}
	for _, bad := range []string{"", "abc", strings.Repeat("a", 42), strings.Repeat("!", 43), strings.Repeat("a", 44)} {
		if ValidToken(bad) {
			t.Fatalf("accepted %q", bad)
		}
	}
}

func TestUnlockCookie(t *testing.T) {
	sec := []byte("0123456789abcdef0123456789abcdef")
	now := time.Unix(1_000_000, 0)
	v := SignUnlock(sec, "share-a", "hash1", now.Add(UnlockTTL))
	if !VerifyUnlock(sec, "share-a", "hash1", v, now) {
		t.Fatal("valid cookie rejected")
	}
	cases := map[string]bool{
		"other share":    VerifyUnlock(sec, "share-b", "hash1", v, now),
		"password moved": VerifyUnlock(sec, "share-a", "hash2", v, now),
		"expired":        VerifyUnlock(sec, "share-a", "hash1", v, now.Add(UnlockTTL)),
		"other secret":   VerifyUnlock([]byte("x"), "share-a", "hash1", v, now),
		"garbage":        VerifyUnlock(sec, "share-a", "hash1", "nope", now),
		"tampered exp":   VerifyUnlock(sec, "share-a", "hash1", "9"+v, now),
	}
	for name, ok := range cases {
		if ok {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestStatus(t *testing.T) {
	now := time.Unix(1000, 0)
	past, future := int64(999), int64(1001)
	other, me := "other", "me"
	base := Share{CreatedBy: me, NodeLive: true}
	check := func(s Share, want string) {
		t.Helper()
		if got := s.Status(now); got != want {
			t.Fatalf("got %s want %s", got, want)
		}
	}
	check(base, StatusActive)
	s := base
	s.ExpiresAt = &future
	check(s, StatusActive)
	s.ExpiresAt = &past
	check(s, StatusExpired)
	s = base
	s.RevokedAt = &past
	check(s, StatusRevoked)
	s = base
	s.NodeLive = false
	check(s, StatusItemTrashed)
	s = base
	s.NodeSpaceOwner = &other
	check(s, StatusUnavailable)
	s.NodeSpaceOwner = &me
	check(s, StatusActive)
}
