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
	ErrNotFound    = errors.New("user not found")
	ErrEmailTaken  = errors.New("email already registered")
	ErrSetupClosed = errors.New("setup already done")
)

// User is an account.
type User struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	Timezone string `json:"timezone"`
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

// Create inserts a user. A duplicate email is ErrEmailTaken.
func Create(ctx context.Context, db *sql.DB, email, pwHash, role string) (User, error) {
	u := User{ID: NewID(), Email: email, Role: role, Timezone: "UTC"}
	_, err := db.ExecContext(ctx, `INSERT INTO users(id,email,pw_hash,role,created_at) VALUES(?,?,?,?,?)`,
		u.ID, u.Email, pwHash, u.Role, time.Now().Unix())
	if isUnique(err) {
		return User{}, ErrEmailTaken
	}
	return u, err
}

// CreateFirstAdmin creates an admin only if no user exists yet (atomically),
// else ErrSetupClosed.
func CreateFirstAdmin(ctx context.Context, db *sql.DB, email, pwHash string) (User, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback()
	var n int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&n); err != nil {
		return User{}, err
	}
	if n > 0 {
		return User{}, ErrSetupClosed
	}
	u := User{ID: NewID(), Email: email, Role: "admin", Timezone: "UTC"}
	if _, err := tx.ExecContext(ctx, `INSERT INTO users(id,email,pw_hash,role,created_at) VALUES(?,?,?,?,?)`,
		u.ID, u.Email, pwHash, u.Role, time.Now().Unix()); err != nil {
		return User{}, err
	}
	return u, tx.Commit()
}

// GetByEmail returns the user and their password hash.
func GetByEmail(ctx context.Context, db *sql.DB, email string) (User, string, error) {
	var u User
	var hash string
	err := db.QueryRowContext(ctx, `SELECT id,email,role,timezone,pw_hash FROM users WHERE email=?`, email).
		Scan(&u.ID, &u.Email, &u.Role, &u.Timezone, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, "", ErrNotFound
	}
	return u, hash, err
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
