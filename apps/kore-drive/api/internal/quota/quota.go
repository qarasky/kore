// Package quota computes per-user storage usage and enforces limits.
//
// Usage counts every file node a user uploaded (trashed included, until
// purged) plus the full declared size of their open uploads. Shared-space
// files count against their uploader; a move into a personal space
// re-attributes the moved subtree to that space's owner (checked with
// Reserve in the move's transaction), a move into the shared space keeps it.
package quota

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// ErrExceeded is returned when a reservation would exceed the user's quota.
var ErrExceeded = errors.New("quota exceeded")

// Querier is satisfied by *sql.DB and *sql.Tx.
type Querier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

const usedSQL = `SELECT
  COALESCE((SELECT SUM(size) FROM nodes WHERE uploader=? AND is_dir=0),0) +
  COALESCE((SELECT SUM(size) FROM uploads WHERE user_id=?),0)`

// Used returns the bytes counted against userID.
func Used(ctx context.Context, q Querier, userID string) (int64, error) {
	var n int64
	err := q.QueryRowContext(ctx, usedSQL, userID, userID).Scan(&n)
	return n, err
}

func limit(ctx context.Context, q Querier, userID string) (int64, error) {
	var l int64
	err := q.QueryRowContext(ctx, `SELECT quota_bytes FROM users WHERE id=?`, userID).Scan(&l)
	if err != nil {
		return 0, fmt.Errorf("quota limit for %q: %w", userID, err)
	}
	return l, nil
}

// Remaining returns quota minus used, never below zero.
func Remaining(ctx context.Context, q Querier, userID string) (int64, error) {
	l, err := limit(ctx, q, userID)
	if err != nil {
		return 0, err
	}
	u, err := Used(ctx, q, userID)
	if err != nil {
		return 0, err
	}
	if u >= l {
		return 0, nil
	}
	return l - u, nil
}

// Reserve verifies used+bytes <= quota inside tx, returning ErrExceeded
// otherwise. The caller must insert the uploads row in the same tx before
// committing. Race-freedom relies on the tx holding SQLite's write lock from
// BEGIN (store.Open sets _txlock=immediate), so concurrent reservers serialize.
func Reserve(ctx context.Context, tx *sql.Tx, userID string, bytes int64) error {
	if bytes < 0 {
		return fmt.Errorf("quota: negative reservation %d", bytes)
	}
	rem, err := Remaining(ctx, tx, userID)
	if err != nil {
		return err
	}
	if bytes > rem {
		return ErrExceeded
	}
	return nil
}
