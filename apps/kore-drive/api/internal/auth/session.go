package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/artchsh/kore/api/internal/config"
	"github.com/artchsh/kore/api/internal/settings"
	"github.com/artchsh/kore/api/internal/users"
	"golang.org/x/crypto/argon2"
)

// ErrInvalidCredentials is returned for both unknown email and wrong password.
var ErrInvalidCredentials = errors.New("invalid email or password")

// ErrPlaceholderPassword is returned when bootstrap is asked to use the shipped placeholder password.
var ErrPlaceholderPassword = errors.New(`admin_password is still the placeholder "change-me"; set a real password in the config file`)

const placeholderPassword = "change-me"

// MinBootstrapPasswordLen is the minimum admin_password length, in characters.
const MinBootstrapPasswordLen = 8

// ErrShortPassword is returned when bootstrap is given a too-short admin_password.
var ErrShortPassword = fmt.Errorf("admin_password must be at least %d characters; set a longer password in the config file", MinBootstrapPasswordLen)

var (
	dummyOnce sync.Once
	dummyHash string
)

// dummy returns a hash verified against when the email is unknown, to
// equalize timing. It is computed once, outside the slot pool, so a busy
// pool can never make it fail.
func dummy() string {
	dummyOnce.Do(func() {
		salt := []byte("kore-dummy-salt!")
		dummyHash = encodeHash(salt, argon2.IDKey([]byte("kore-dummy-password"), salt, argonTime, argonMemory, argonThreads, argonKeyLen))
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

// Bootstrap creates the first admin from config when no users exist.
func Bootstrap(ctx context.Context, db *sql.DB, cfg config.Config) error {
	n, err := users.Count(ctx, db)
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	if cfg.AdminPassword == placeholderPassword {
		return ErrPlaceholderPassword
	}
	if utf8.RuneCountInString(cfg.AdminPassword) < MinBootstrapPasswordLen {
		return ErrShortPassword
	}
	h, err := HashPassword(cfg.AdminPassword)
	if err != nil {
		return err
	}
	_, err = users.Create(ctx, db, cfg.AdminEmail, h, "admin", settings.DefaultQuotaBytes(ctx, db))
	return err
}
