package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/qarasky/korecalendar/api/internal/users"
)

// TokenPrefix marks personal access tokens, so they are recognisable in logs
// and secret scanners.
const TokenPrefix = "kcal_"

// ErrNotFound is returned when a token does not exist or belongs to someone else.
var ErrNotFound = errors.New("not found")

// TokenInfo describes a token without its secret.
type TokenInfo struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CreatedAt  int64  `json:"created_at"`
	LastUsedAt int64  `json:"last_used_at"`
}

// CreateToken makes a new token for userID. The secret is returned once; only
// its SHA-256 is stored.
func CreateToken(ctx context.Context, db *sql.DB, userID, name string) (id, secret string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	secret = TokenPrefix + base64.RawURLEncoding.EncodeToString(b)
	id = users.NewID()
	_, err = db.ExecContext(ctx, `INSERT INTO tokens(id,user_id,name,token_hash,created_at) VALUES(?,?,?,?,?)`,
		id, userID, name, hashToken(secret), time.Now().Unix())
	return id, secret, err
}

// ListTokens returns the user's tokens, newest first.
func ListTokens(ctx context.Context, db *sql.DB, userID string) ([]TokenInfo, error) {
	rows, err := db.QueryContext(ctx, `SELECT id,name,created_at,last_used_at FROM tokens WHERE user_id=? ORDER BY created_at DESC, id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TokenInfo{}
	for rows.Next() {
		var t TokenInfo
		if err := rows.Scan(&t.ID, &t.Name, &t.CreatedAt, &t.LastUsedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// RevokeToken deletes the user's token; someone else's id is ErrNotFound.
func RevokeToken(ctx context.Context, db *sql.DB, userID, id string) error {
	res, err := db.ExecContext(ctx, `DELETE FROM tokens WHERE id=? AND user_id=?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// principalForToken resolves a kcal_ token to its owner and records use at
// most once a minute.
func principalForToken(ctx context.Context, db *sql.DB, tok string) (Principal, bool) {
	var p Principal
	var id string
	err := db.QueryRowContext(ctx,
		`SELECT t.id,t.name,u.id,u.role FROM tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=?`, hashToken(tok)).
		Scan(&id, &p.TokenName, &p.UserID, &p.Role)
	if err != nil {
		return Principal{}, false
	}
	now := time.Now().Unix()
	db.ExecContext(ctx, `UPDATE tokens SET last_used_at=? WHERE id=? AND last_used_at<?`, now, id, now-60)
	p.Via = "token"
	return p, true
}

// TokenPrincipal authenticates an access token (never a session token): who
// it belongs to, with Via "token". Used where only tokens may be offered, such
// as the CalDAV endpoint's Basic password.
func TokenPrincipal(ctx context.Context, db *sql.DB, tok string) (Principal, bool) {
	if !isToken(tok) {
		return Principal{}, false
	}
	return principalForToken(ctx, db, tok)
}

func isToken(tok string) bool { return strings.HasPrefix(tok, TokenPrefix) }
