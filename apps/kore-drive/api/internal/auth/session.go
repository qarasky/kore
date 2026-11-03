package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"time"

	"github.com/qarasky/kore/api/internal/users"
)

func hashToken(tok string) string {
	s := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(s[:])
}

// NewSession creates a session and returns the raw token; only its SHA-256 is stored.
func NewSession(ctx context.Context, db *sql.DB, userID string, ttl time.Duration) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	tok := base64.RawURLEncoding.EncodeToString(b)
	_, err := db.ExecContext(ctx, `INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)`,
		hashToken(tok), userID, time.Now().Add(ttl).Unix())
	if err != nil {
		return "", err
	}
	return tok, nil
}

// UserForToken returns the user owning an unexpired session token.
func UserForToken(ctx context.Context, db *sql.DB, tok string) (users.User, error) {
	var u users.User
	err := db.QueryRowContext(ctx,
		`SELECT u.id,u.email,u.role,u.quota_bytes FROM sessions s JOIN users u ON u.id=s.user_id
		 WHERE s.token_hash=? AND s.expires_at>?`, hashToken(tok), time.Now().Unix()).
		Scan(&u.ID, &u.Email, &u.Role, &u.QuotaBytes)
	if errors.Is(err, sql.ErrNoRows) {
		return users.User{}, users.ErrNotFound
	}
	return u, err
}

// DeleteSession removes a session by raw token.
func DeleteSession(ctx context.Context, db *sql.DB, tok string) error {
	_, err := db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash=?`, hashToken(tok))
	return err
}
