package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"sync"
	"time"

	"github.com/qarasky/korecalendar/api/internal/users"
	"golang.org/x/crypto/argon2"
)

// ErrInvalidCredentials is returned for both unknown email and wrong password.
var ErrInvalidCredentials = errors.New("invalid email or password")

var (
	dummyOnce sync.Once
	dummyHash string
)

// dummy returns a hash verified against when the email is unknown, to
// equalize timing. Computed once, outside the slot pool.
func dummy() string {
	dummyOnce.Do(func() {
		salt := []byte("korecal-dummy-salt!!")[:saltLen]
		dummyHash = encodeHash(salt, argon2.IDKey([]byte("korecal-dummy-password"), salt, argonTime, argonMemory, argonThreads, argonKeyLen))
	})
	return dummyHash
}

// Authenticate verifies credentials. Failure is ErrInvalidCredentials, or
// ErrBusy when the password-hash pool is saturated.
func Authenticate(ctx context.Context, db *sql.DB, email, pw string) (users.User, error) {
	u, hash, err := users.GetByEmail(ctx, db, email)
	if err != nil {
		if errors.Is(err, users.ErrNotFound) {
			if _, err := VerifyPassword(dummy(), pw); err != nil {
				return users.User{}, err
			}
			return users.User{}, ErrInvalidCredentials
		}
		return users.User{}, err
	}
	ok, err := VerifyPassword(hash, pw)
	if err != nil {
		return users.User{}, err
	}
	if !ok {
		return users.User{}, ErrInvalidCredentials
	}
	return u, nil
}

func hashToken(tok string) string {
	s := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(s[:])
}

// NewSession creates a session and returns the raw token; only its SHA-256 is stored.
func NewSession(ctx context.Context, db *sql.DB, userID string, ttl time.Duration) (string, error) {
	return NewSessionWithIDToken(ctx, db, userID, ttl, "")
}

// NewSessionWithIDToken is NewSession for a Kore ID login: it keeps the id
// token, which RP-initiated logout needs as id_token_hint.
func NewSessionWithIDToken(ctx context.Context, db *sql.DB, userID string, ttl time.Duration, idToken string) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	tok := base64.RawURLEncoding.EncodeToString(b)
	_, err := db.ExecContext(ctx, `INSERT INTO sessions(token_hash,user_id,expires_at,id_token) VALUES(?,?,?,?)`,
		hashToken(tok), userID, time.Now().Add(ttl).Unix(), idToken)
	if err != nil {
		return "", err
	}
	return tok, nil
}

// UserForToken returns the user owning an unexpired session token.
func UserForToken(ctx context.Context, db *sql.DB, tok string) (users.User, error) {
	var u users.User
	err := db.QueryRowContext(ctx,
		`SELECT u.id,u.email,u.role,u.timezone FROM sessions s JOIN users u ON u.id=s.user_id
		 WHERE s.token_hash=? AND s.expires_at>?`, hashToken(tok), time.Now().Unix()).
		Scan(&u.ID, &u.Email, &u.Role, &u.Timezone)
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

// SessionIDToken returns the Kore ID token stored with a session ("" if none).
func SessionIDToken(ctx context.Context, db *sql.DB, tok string) string {
	var t string
	db.QueryRowContext(ctx, `SELECT id_token FROM sessions WHERE token_hash=?`, hashToken(tok)).Scan(&t)
	return t
}
