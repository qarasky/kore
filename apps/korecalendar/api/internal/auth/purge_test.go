package auth

import (
	"context"
	"testing"
	"time"

	"github.com/qarasky/korecalendar/api/internal/testutil"
	"github.com/qarasky/korecalendar/api/internal/users"
)

func TestPurgeExpiredSessionsKeepsLiveOnes(t *testing.T) {
	db := testutil.NewDB(t)
	ctx := context.Background()
	u, err := users.Create(ctx, db, "a@example.com", "admin")
	if err != nil {
		t.Fatal(err)
	}
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
