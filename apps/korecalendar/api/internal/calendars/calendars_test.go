package calendars

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

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
	if err := Delete(ctx, db, u.ID, "user", c.ID, false); err != nil {
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
	if err := Delete(ctx, db, b.ID, "user", c.ID, false); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Delete: %v", err)
	}
	n := "x"
	if _, err := Update(ctx, db, b.ID, c.ID, &n, nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Update: %v", err)
	}
}

func TestListIsInCreationOrder(t *testing.T) {
	db := testutil.NewDB(t)
	ctx := context.Background()
	u, _ := users.Create(ctx, db, "a@example.com", "x", "admin")
	want := []string{}
	for i := 0; i < 12; i++ { // created within the same second
		name := string(rune('A' + i))
		want = append(want, name)
		if _, err := Create(ctx, db, u.ID, name, "#112233"); err != nil {
			t.Fatal(err)
		}
	}
	list, _ := List(ctx, db, u.ID)
	got := []string{}
	for _, c := range list {
		got = append(got, c.Name)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("order %v, want %v", got, want)
	}
}

func TestDeletedCalendarIsHiddenAndRestorable(t *testing.T) {
	db := testutil.NewDB(t)
	ctx := context.Background()
	u, _ := users.Create(ctx, db, "a@example.com", "x", "admin")
	c, _ := Create(ctx, db, u.ID, "Work", "#7b6cf0")
	if err := Delete(ctx, db, u.ID, "user", c.ID, false); err != nil {
		t.Fatal(err)
	}
	if list, _ := List(ctx, db, u.ID); len(list) != 0 {
		t.Fatalf("deleted calendar still listed: %+v", list)
	}
	if _, err := Get(ctx, db, u.ID, c.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get after delete: %v", err)
	}
	if _, err := Update(ctx, db, u.ID, c.ID, str("x"), nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Update after delete: %v", err)
	}
	got, err := Restore(ctx, db, u.ID, "user", c.ID)
	if err != nil || got.Name != "Work" {
		t.Fatalf("Restore: %+v, %v", got, err)
	}
	if list, _ := List(ctx, db, u.ID); len(list) != 1 {
		t.Fatalf("restored calendar not listed: %+v", list)
	}
}

func TestRestoreAfter30DaysAndOtherUsersAreNotFound(t *testing.T) {
	db := testutil.NewDB(t)
	ctx := context.Background()
	a, _ := users.Create(ctx, db, "a@example.com", "x", "admin")
	b, _ := users.Create(ctx, db, "b@example.com", "x", "user")
	c, _ := Create(ctx, db, a.ID, "Old", "#112233")
	Delete(ctx, db, a.ID, "user", c.ID, false)
	if _, err := Restore(ctx, db, b.ID, "user", c.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user restored it: %v", err)
	}
	db.Exec(`UPDATE calendars SET deleted_at = strftime('%s','now') - 31*86400 WHERE id=?`, c.ID)
	if _, err := Restore(ctx, db, a.ID, "user", c.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restored after 31 days: %v", err)
	}
	n, err := PurgeDeleted(ctx, db, time.Now().Add(-30*24*time.Hour))
	var left int
	db.QueryRow(`SELECT count(*) FROM calendars WHERE id=?`, c.ID).Scan(&left)
	if err != nil || n != 1 || left != 0 {
		t.Fatalf("purged %d, left %d, %v", n, left, err)
	}
}

func str(s string) *string { return &s }
