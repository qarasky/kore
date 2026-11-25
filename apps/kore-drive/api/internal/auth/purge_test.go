package auth

import (
	"context"
	"testing"
	"time"
)

func TestPurgeExpiredSessionsKeepsLiveOnes(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	u := mkUser(t, db, "alice@example.com", "user")
	live, err := NewSession(ctx, db, u.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if _, err := NewSession(ctx, db, u.ID, -time.Hour); err != nil {
			t.Fatal(err)
		}
	}
	n, err := PurgeExpiredSessions(ctx, db)
	if err != nil || n != 3 {
		t.Fatalf("purged %d, err %v; want 3", n, err)
	}
	if _, err := UserForToken(ctx, db, live); err != nil {
		t.Fatalf("the live session must survive: %v", err)
	}
}
