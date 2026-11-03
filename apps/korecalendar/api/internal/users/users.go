// Package users reads and writes the users table.
package users

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

// Errors returned by this package.
var (
	ErrNotFound   = errors.New("user not found")
	ErrEmailTaken = errors.New("email already registered")
)

// User is an account.
type User struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	Timezone string `json:"timezone"`
}

// AdminUser is a user as the administrator's user page sees them.
type AdminUser struct {
	User
	CreatedAt int64 `json:"created_at"`
	// KoreIDLinked is true once a Kore ID subject is attached. Accounts created
	// before Kore ID, or provisioned ahead of a first sign-in, may not be yet.
	KoreIDLinked bool `json:"kore_id_linked"`
}

// NewID returns a random 16-byte hex id.
func NewID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func isUnique(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}

// NoPassword is written to the legacy users.pw_hash column, which stays NOT
// NULL but is no longer read or written with a real hash: KoreCalendar has no
// password sign-in. It is not a valid encoded hash, so nothing verifies against it.
const NoPassword = "!"

// Create inserts a password-less local account, for an existing person who has
// not signed in with Kore ID yet (a duplicate email is ErrEmailTaken). They
// link to their Kore ID identity by verified email on first sign-in.
func Create(ctx context.Context, db *sql.DB, email, role string) (User, error) {
	u := User{ID: NewID(), Email: email, Role: role, Timezone: "UTC"}
	_, err := db.ExecContext(ctx, `INSERT INTO users(id,email,pw_hash,role,created_at) VALUES(?,?,?,?,?)`,
		u.ID, u.Email, NoPassword, u.Role, time.Now().Unix())
	if isUnique(err) {
		return User{}, ErrEmailTaken
	}
	return u, err
}

// Get returns a user by id.
func Get(ctx context.Context, db *sql.DB, id string) (User, error) {
	var u User
	err := db.QueryRowContext(ctx, `SELECT id,email,role,timezone FROM users WHERE id=?`, id).
		Scan(&u.ID, &u.Email, &u.Role, &u.Timezone)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

// SetTimezone stores the user's default IANA time zone.
func SetTimezone(ctx context.Context, db *sql.DB, id, tz string) error {
	_, err := db.ExecContext(ctx, `UPDATE users SET timezone=? WHERE id=?`, tz, id)
	return err
}

// Count returns the number of users.
func Count(ctx context.Context, db *sql.DB) (int, error) {
	var n int
	err := db.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&n)
	return n, err
}

// ErrSubTaken is returned when linking a subject already linked to another user.
var ErrSubTaken = errors.New("subject already linked to another user")

// GetBySub returns the user linked to an OpenID subject.
func GetBySub(ctx context.Context, db *sql.DB, sub string) (User, error) {
	var u User
	err := db.QueryRowContext(ctx, `SELECT id,email,role,timezone FROM users WHERE oidc_sub=?`, sub).
		Scan(&u.ID, &u.Email, &u.Role, &u.Timezone)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

// GetLinkByEmail returns the user with that email and the subject linked to
// them ("" if none).
func GetLinkByEmail(ctx context.Context, db *sql.DB, email string) (User, string, error) {
	var u User
	var sub sql.NullString
	err := db.QueryRowContext(ctx, `SELECT id,email,role,timezone,oidc_sub FROM users WHERE email=?`, email).
		Scan(&u.ID, &u.Email, &u.Role, &u.Timezone, &sub)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, "", ErrNotFound
	}
	return u, sub.String, err
}

// CreateOIDC inserts a password-less user for an OpenID subject. A duplicate
// email is ErrEmailTaken, a duplicate subject ErrSubTaken.
func CreateOIDC(ctx context.Context, db *sql.DB, email, sub, role string) (User, error) {
	u := User{ID: NewID(), Email: email, Role: role, Timezone: "UTC"}
	_, err := db.ExecContext(ctx, `INSERT INTO users(id,email,pw_hash,role,created_at,oidc_sub) VALUES(?,?,?,?,?,?)`,
		u.ID, u.Email, NoPassword, u.Role, time.Now().Unix(), sub)
	if isUnique(err) {
		if strings.Contains(err.Error(), "oidc_sub") {
			return User{}, ErrSubTaken
		}
		return User{}, ErrEmailTaken
	}
	return u, err
}

// LinkSub links an OpenID subject to an existing user who has none yet.
func LinkSub(ctx context.Context, db *sql.DB, userID, sub string) error {
	res, err := db.ExecContext(ctx, `UPDATE users SET oidc_sub=? WHERE id=? AND oidc_sub IS NULL`, sub, userID)
	if isUnique(err) {
		return ErrSubTaken
	}
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetRole changes a user's role; an unknown id is ErrNotFound.
func SetRole(ctx context.Context, db *sql.DB, id, role string) error {
	res, err := db.ExecContext(ctx, `UPDATE users SET role=? WHERE id=?`, role, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// List returns every account for the administrator's user page.
func List(ctx context.Context, db *sql.DB) ([]AdminUser, error) {
	rows, err := db.QueryContext(ctx, `SELECT id,email,role,timezone,created_at,oidc_sub IS NOT NULL FROM users ORDER BY email`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminUser{}
	for rows.Next() {
		var u AdminUser
		if err := rows.Scan(&u.ID, &u.Email, &u.Role, &u.Timezone, &u.CreatedAt, &u.KoreIDLinked); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
