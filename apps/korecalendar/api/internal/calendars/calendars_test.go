package calendars

import (
	"context"
	"errors"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/testutil"
	"github.com/qarasky/korecalendar/api/internal/users"
)

func TestCreateListUpdateDelete(t *testing.T) {
	db := testutil.NewDB(t)
	ctx := context.Background()
	u, _ := users.Create(ctx, db, "a@example.com", "x", "admin")
	c, err := Create(ctx, db, u.ID, "Work", "#7b6cf0")
	if err != nil {
		t.Fatal(err)
	}
	list, _ := List(ctx, db, u.ID)
	if len(list) != 1 || list[0].ID != c.ID || list[0].Color != "#7b6cf0" {
		t.Fatalf("list = %+v", list)
	}
	name := "Job"
	got, err := Update(ctx, db, u.ID, c.ID, &name, nil)
	if err != nil || got.Name != "Job" || got.Color != "#7b6cf0" {
		t.Fatalf("update = %+v, %v", got, err)
	}
	if err := Delete(ctx, db, u.ID, c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := Get(ctx, db, u.ID, c.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after delete: %v", err)
	}
}

func TestValidation(t *testing.T) {
	db := testutil.NewDB(t)
	ctx := context.Background()
	u, _ := users.Create(ctx, db, "a@example.com", "x", "admin")
	for _, color := range []string{"blue", "#12345", "#12345g", "123456", ""} {
		if _, err := Create(ctx, db, u.ID, "X", color); !errors.Is(err, ErrValidation) {
			t.Errorf("color %q accepted: %v", color, err)
		}
	}
	if _, err := Create(ctx, db, u.ID, "  ", "#112233"); !errors.Is(err, ErrValidation) {
		t.Errorf("blank name accepted: %v", err)
	}
}

func TestOtherUsersCalendarIsNotFound(t *testing.T) {
	db := testutil.NewDB(t)
	ctx := context.Background()
	a, _ := users.Create(ctx, db, "a@example.com", "x", "admin")
	b, _ := users.Create(ctx, db, "b@example.com", "x", "user")
	c, _ := Create(ctx, db, a.ID, "Mine", "#112233")
	if _, err := Get(ctx, db, b.ID, c.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get: %v", err)
	}
	if err := Delete(ctx, db, b.ID, c.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Delete: %v", err)
	}
	n := "x"
	if _, err := Update(ctx, db, b.ID, c.ID, &n, nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Update: %v", err)
	}
}
