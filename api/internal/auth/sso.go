package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/qarasky/kore/api/internal/users"
)

// Errors from linking a Kore ID subject to a local account.
var (
	ErrSubTaken      = errors.New("this Kore ID account is already linked to another user")
	ErrAlreadyLinked = errors.New("this user is already linked to a different Kore ID account")
)

// ssoNoPassword is stored as pw_hash for accounts created by SSO. It is not a
// valid hash, so password login can never succeed for them.
const ssoNoPassword = "!"

// HashToken is the stored form of a raw session token.
func HashToken(tok string) string { return hashToken(tok) }

const userCols = `id,email,role,quota_bytes`

func scanUser(row *sql.Row) (users.User, error) {
	var u users.User
	err := row.Scan(&u.ID, &u.Email, &u.Role, &u.QuotaBytes)
	if errors.Is(err, sql.ErrNoRows) {
		return users.User{}, users.ErrNotFound
	}
	return u, err
}

// UserBySub returns the local user linked to a Kore ID subject.
func UserBySub(ctx context.Context, db *sql.DB, sub string) (users.User, error) {
	return scanUser(db.QueryRowContext(ctx, `SELECT `+userCols+` FROM users WHERE sub=?`, sub))
}

// UserByEmailWithSub returns the user with that email and its current sub ("" if unlinked).
func UserByEmailWithSub(ctx context.Context, db *sql.DB, email string) (users.User, string, error) {
	var u users.User
	var sub sql.NullString
	err := db.QueryRowContext(ctx, `SELECT `+userCols+`,sub FROM users WHERE email=?`, strings.TrimSpace(email)).
		Scan(&u.ID, &u.Email, &u.Role, &u.QuotaBytes, &sub)
	if errors.Is(err, sql.ErrNoRows) {
		return users.User{}, "", users.ErrNotFound
	}
	return u, sub.String, err
}

// LinkSub binds sub to a local user. It is a no-op when already bound to that
// same sub, and an error when either side is bound to something else.
func LinkSub(ctx context.Context, db *sql.DB, userID, sub string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var owner string
	err = tx.QueryRowContext(ctx, `SELECT id FROM users WHERE sub=?`, sub).Scan(&owner)
	switch {
	case err == nil && owner == userID:
		return nil
	case err == nil:
		return ErrSubTaken
	case !errors.Is(err, sql.ErrNoRows):
		return err
	}
	res, err := tx.ExecContext(ctx, `UPDATE users SET sub=? WHERE id=? AND sub IS NULL`, sub, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n != 1 {
		var cur sql.NullString
		if err := tx.QueryRowContext(ctx, `SELECT sub FROM users WHERE id=?`, userID).Scan(&cur); errors.Is(err, sql.ErrNoRows) {
			return users.ErrNotFound
		}
		return ErrAlreadyLinked
	}
	return tx.Commit()
}

// ProvisionSSO creates an account for a first-time Kore ID user (role is
// normally "user"; the configured owner gets "admin" on a fresh install, no
// usable password either way). users.ErrExists means the email is taken.
func ProvisionSSO(ctx context.Context, db *sql.DB, sub, email, role string, quotaBytes int64) (users.User, error) {
	u, err := users.Create(ctx, db, email, ssoNoPassword, role, quotaBytes)
	if err != nil {
		return users.User{}, err
	}
	if err := LinkSub(ctx, db, u.ID, sub); err != nil {
		db.ExecContext(ctx, `DELETE FROM users WHERE id=?`, u.ID)
		return users.User{}, err
	}
	return u, nil
}

// Flow is a stored in-flight authorization request.
type Flow struct {
	Nonce, Verifier, Next, LinkUserID string
}

// SaveFlow stores a login attempt keyed by its state, dropping expired ones.
func SaveFlow(ctx context.Context, db *sql.DB, state string, f Flow, ttl time.Duration) error {
	now := time.Now().Unix()
	db.ExecContext(ctx, `DELETE FROM oidc_flows WHERE expires_at<?`, now)
	_, err := db.ExecContext(ctx,
		`INSERT INTO oidc_flows(state_hash,nonce,verifier,next,link_user_id,expires_at) VALUES(?,?,?,?,?,?)`,
		hashToken(state), f.Nonce, f.Verifier, f.Next, f.LinkUserID, now+int64(ttl.Seconds()))
	return err
}

// TakeFlow returns and deletes the flow for state (single use). ok is false
// when unknown or expired.
func TakeFlow(ctx context.Context, db *sql.DB, state string) (f Flow, ok bool, err error) {
	var exp int64
	err = db.QueryRowContext(ctx,
		`DELETE FROM oidc_flows WHERE state_hash=? RETURNING nonce,verifier,next,link_user_id,expires_at`, hashToken(state)).
		Scan(&f.Nonce, &f.Verifier, &f.Next, &f.LinkUserID, &exp)
	if errors.Is(err, sql.ErrNoRows) {
		return Flow{}, false, nil
	}
	if err != nil {
		return Flow{}, false, err
	}
	return f, exp > time.Now().Unix(), nil
}

// NewSSOSession is NewSession plus the provider tokens and the Kore ID
// session id (sid, "" when the id token has none).
func NewSSOSession(ctx context.Context, db *sql.DB, userID string, ttl time.Duration, idToken, refreshToken, sid string) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	tok := base64.RawURLEncoding.EncodeToString(b)
	_, err := db.ExecContext(ctx,
		`INSERT INTO sessions(token_hash,user_id,expires_at,id_token,refresh_token,checked_at,sid) VALUES(?,?,?,?,?,?,?)`,
		hashToken(tok), userID, time.Now().Add(ttl).Unix(), idToken, refreshToken, time.Now().Unix(), sql.NullString{String: sid, Valid: sid != ""})
	if err != nil {
		return "", err
	}
	return tok, nil
}

// DeleteSessionsBySID ends every local session created from the Kore ID
// session sid (back-channel logout) and returns how many there were.
func DeleteSessionsBySID(ctx context.Context, db *sql.DB, sid string) (int64, error) {
	if sid == "" {
		return 0, nil
	}
	res, err := db.ExecContext(ctx, `DELETE FROM sessions WHERE sid=?`, sid)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// DeleteSessionsBySub ends every local session (SSO or password) of the user
// linked to the Kore ID subject sub and returns how many there were.
func DeleteSessionsBySub(ctx context.Context, db *sql.DB, sub string) (int64, error) {
	if sub == "" {
		return 0, nil
	}
	res, err := db.ExecContext(ctx, `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE sub=?)`, sub)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// SSOSession is the provider state attached to a session.
type SSOSession struct {
	IDToken, RefreshToken string
	CheckedAt             time.Time
}

// SSOSessionFor returns the provider state of a session (zero if none).
func SSOSessionFor(ctx context.Context, db *sql.DB, tok string) (SSOSession, error) {
	var s SSOSession
	var at int64
	err := db.QueryRowContext(ctx, `SELECT id_token,refresh_token,checked_at FROM sessions WHERE token_hash=?`, hashToken(tok)).
		Scan(&s.IDToken, &s.RefreshToken, &at)
	if errors.Is(err, sql.ErrNoRows) {
		return SSOSession{}, nil
	}
	s.CheckedAt = time.Unix(at, 0)
	return s, err
}

// SetSSOTokens stores rotated provider tokens and the check time.
func SetSSOTokens(ctx context.Context, db *sql.DB, tok, idToken, refreshToken string, checkedAt time.Time) error {
	_, err := db.ExecContext(ctx,
		`UPDATE sessions SET id_token=CASE WHEN ?<>'' THEN ? ELSE id_token END, refresh_token=?, checked_at=? WHERE token_hash=?`,
		idToken, idToken, refreshToken, checkedAt.Unix(), hashToken(tok))
	return err
}

// TouchSSOCheck moves checked_at without touching the tokens (used to back off after a transient failure).
func TouchSSOCheck(ctx context.Context, db *sql.DB, tok string, checkedAt time.Time) error {
	_, err := db.ExecContext(ctx, `UPDATE sessions SET checked_at=? WHERE token_hash=?`, checkedAt.Unix(), hashToken(tok))
	return err
}
