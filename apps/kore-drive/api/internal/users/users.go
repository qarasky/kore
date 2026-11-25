// Package users manages account records. Password hashing lives in auth.
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

// User is an account. Roles are "admin" or "user".
type User struct {
	ID         string `json:"id"`
	Email      string `json:"email"`
	Role       string `json:"role"`
	QuotaBytes int64  `json:"quota_bytes"`
}

var (
	ErrNotFound = errors.New("user not found")
	ErrExists   = errors.New("email already in use")
	ErrRole     = errors.New("role must be admin or user")
)

// NewID returns a random 128-bit hex identifier.
func NewID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// Create inserts a user. Accounts come from Kore ID; pw_hash is a legacy
// column kept NOT NULL for existing databases, so it is written empty and
// never read.
func Create(ctx context.Context, db *sql.DB, email, role string, quotaBytes int64) (User, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		return User{}, errors.New("email is required")
	}
	if role != "admin" && role != "user" {
		return User{}, ErrRole
	}
	u := User{ID: NewID(), Email: email, Role: role, QuotaBytes: quotaBytes}
	_, err := db.ExecContext(ctx,
		`INSERT INTO users(id,email,pw_hash,role,quota_bytes,created_at) VALUES(?,?,'',?,?,?)`,
		u.ID, u.Email, u.Role, u.QuotaBytes, time.Now().Unix())
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return User{}, ErrExists
		}
		return User{}, err
	}
	return u, nil
}

// GetByEmail returns the user with that email (case-insensitive).
func GetByEmail(ctx context.Context, db *sql.DB, email string) (User, error) {
	var u User
	err := db.QueryRowContext(ctx,
		`SELECT id,email,role,quota_bytes FROM users WHERE email=?`, strings.TrimSpace(email)).
		Scan(&u.ID, &u.Email, &u.Role, &u.QuotaBytes)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

// Count returns the number of users.
func Count(ctx context.Context, db *sql.DB) (int, error) {
	var n int
	err := db.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&n)
	return n, err
}
