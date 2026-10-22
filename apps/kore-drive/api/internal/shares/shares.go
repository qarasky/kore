// Package shares stores public share links: an unguessable token bound to
// one node, with an optional expiry and password. Access rules for the
// public side live in httpapi; this package is storage plus the pure
// helpers (tokens, status, unlock cookies).
package shares

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/qarasky/kore/api/internal/users"
)

// ErrNotFound is returned for a missing share or one owned by someone else.
var ErrNotFound = errors.New("share not found")

// Status values.
const (
	StatusActive      = "active"
	StatusExpired     = "expired"
	StatusRevoked     = "revoked"
	StatusItemTrashed = "item_trashed"
	// StatusUnavailable: the creator can no longer access the item (it was
	// moved into someone else's personal space).
	StatusUnavailable = "unavailable"
)

// Share is a share row joined with what is needed of its node.
type Share struct {
	ID             string
	Token          string
	NodeID         string
	CreatedBy      string
	CreatedAt      int64
	ExpiresAt      *int64
	PasswordHash   *string
	RevokedAt      *int64
	DownloadCount  int64
	LastAccessedAt *int64

	NodeName       string
	NodeIsDir      bool
	NodeSize       int64
	NodeLive       bool    // not trashed, not under a trashed folder
	NodeSpaceOwner *string // nil = shared space
}

// TokenBytes is the token entropy (256 bits).
const TokenBytes = 32

// NewToken returns a random URL-safe token (43 base64url characters).
func NewToken() string {
	b := make([]byte, TokenBytes)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// ValidToken reports whether t looks like a token NewToken could return
// (cheap rejection before touching the DB).
func ValidToken(t string) bool {
	if len(t) != 43 {
		return false
	}
	_, err := base64.RawURLEncoding.DecodeString(t)
	return err == nil
}

// CreatorCanAccess reports whether the share's creator can still reach the
// node (shared space, or the creator's own personal space). A node moved
// into another user's personal space must not stay public through a link
// someone else created.
func (s Share) CreatorCanAccess() bool {
	return s.NodeSpaceOwner == nil || *s.NodeSpaceOwner == s.CreatedBy
}

// Status is the share's state at now.
func (s Share) Status(now time.Time) string {
	switch {
	case s.RevokedAt != nil:
		return StatusRevoked
	case s.ExpiresAt != nil && *s.ExpiresAt <= now.Unix():
		return StatusExpired
	case !s.CreatorCanAccess():
		return StatusUnavailable
	case !s.NodeLive:
		return StatusItemTrashed
	}
	return StatusActive
}

const selectSQL = `SELECT s.id,s.token,s.node_id,s.created_by,s.created_at,s.expires_at,s.password_hash,
	s.revoked_at,s.download_count,s.last_accessed_at,
	n.name,n.is_dir,n.size,(n.trashed_at IS NULL AND n.trash_root IS NULL),n.space_owner
	FROM shares s JOIN nodes n ON n.id=s.node_id`

type scanner interface{ Scan(...any) error }

func scan(r scanner) (Share, error) {
	var s Share
	var exp, rev, last sql.NullInt64
	var pw, owner sql.NullString
	var dir, live int
	err := r.Scan(&s.ID, &s.Token, &s.NodeID, &s.CreatedBy, &s.CreatedAt, &exp, &pw, &rev, &s.DownloadCount, &last,
		&s.NodeName, &dir, &s.NodeSize, &live, &owner)
	if err != nil {
		return s, err
	}
	if exp.Valid {
		s.ExpiresAt = &exp.Int64
	}
	if rev.Valid {
		s.RevokedAt = &rev.Int64
	}
	if last.Valid {
		s.LastAccessedAt = &last.Int64
	}
	if pw.Valid {
		s.PasswordHash = &pw.String
	}
	if owner.Valid {
		s.NodeSpaceOwner = &owner.String
	}
	s.NodeIsDir, s.NodeLive = dir != 0, live != 0
	return s, nil
}

// Queryer is *sql.DB or *sql.Tx (inside a tx always pass the tx).
type Queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func one(ctx context.Context, q Queryer, where string, args ...any) (Share, error) {
	s, err := scan(q.QueryRowContext(ctx, selectSQL+` WHERE `+where, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return s, ErrNotFound
	}
	return s, err
}

// ByToken returns the share with token (any state, any owner).
func ByToken(ctx context.Context, q Queryer, token string) (Share, error) {
	return one(ctx, q, `s.token=?`, token)
}

// Mine returns the share id if it was created by userID.
func Mine(ctx context.Context, q Queryer, userID, id string) (Share, error) {
	return one(ctx, q, `s.id=? AND s.created_by=?`, id, userID)
}

// List returns userID's shares, newest first; nodeID != "" narrows to one node.
func List(ctx context.Context, q Queryer, userID, nodeID string) ([]Share, error) {
	where, args := ` WHERE s.created_by=?`, []any{userID}
	if nodeID != "" {
		where += ` AND s.node_id=?`
		args = append(args, nodeID)
	}
	rows, err := q.QueryContext(ctx, selectSQL+where+` ORDER BY s.created_at DESC, s.rowid DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Share{}
	for rows.Next() {
		s, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// Insert stores a new share for nodeID (the caller has checked access in
// the same tx) and returns its id and token.
func Insert(ctx context.Context, q Queryer, nodeID, userID string, now int64, expiresAt *int64, pwHash *string) (id, token string, err error) {
	id, token = users.NewID(), NewToken()
	_, err = q.ExecContext(ctx, `INSERT INTO shares(id,token,node_id,created_by,created_at,expires_at,password_hash)
		VALUES(?,?,?,?,?,?,?)`, id, token, nodeID, userID, now, expiresAt, pwHash)
	return id, token, err
}

// Patch describes a change to a share; nil fields are unchanged.
type Patch struct {
	SetExpiry    bool
	ExpiresAt    *int64 // with SetExpiry: nil = never
	SetPassword  bool
	PasswordHash *string // with SetPassword: nil = no password
	SetRevoked   bool
	Revoked      bool
}

// Update applies p to userID's share id.
func Update(ctx context.Context, q Queryer, userID, id string, now int64, p Patch) error {
	if _, err := Mine(ctx, q, userID, id); err != nil {
		return err
	}
	if p.SetExpiry {
		if _, err := q.ExecContext(ctx, `UPDATE shares SET expires_at=? WHERE id=?`, p.ExpiresAt, id); err != nil {
			return err
		}
	}
	if p.SetPassword {
		if _, err := q.ExecContext(ctx, `UPDATE shares SET password_hash=? WHERE id=?`, p.PasswordHash, id); err != nil {
			return err
		}
	}
	if p.SetRevoked {
		query, args := `UPDATE shares SET revoked_at=NULL WHERE id=?`, []any{id}
		if p.Revoked {
			query, args = `UPDATE shares SET revoked_at=COALESCE(revoked_at,?) WHERE id=?`, []any{now, id}
		}
		if _, err := q.ExecContext(ctx, query, args...); err != nil {
			return err
		}
	}
	return nil
}

// Delete removes userID's share id.
func Delete(ctx context.Context, q Queryer, userID, id string) error {
	res, err := q.ExecContext(ctx, `DELETE FROM shares WHERE id=? AND created_by=?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// CountDownload records a full download.
func CountDownload(ctx context.Context, db *sql.DB, id string, now int64) error {
	_, err := db.ExecContext(ctx, `UPDATE shares SET download_count=download_count+1,last_accessed_at=? WHERE id=?`, now, id)
	return err
}

// SharedAmong returns which of nodeIDs have an active (not revoked, not
// expired) share created by userID: one set-based query.
func SharedAmong(ctx context.Context, q Queryer, userID string, nodeIDs []string, now int64) (map[string]bool, error) {
	out := map[string]bool{}
	if len(nodeIDs) == 0 {
		return out, nil
	}
	const chunk = 500
	for i := 0; i < len(nodeIDs); i += chunk {
		part := nodeIDs[i:min(i+chunk, len(nodeIDs))]
		args := []any{userID, now}
		for _, id := range part {
			args = append(args, id)
		}
		rows, err := q.QueryContext(ctx, `SELECT DISTINCT node_id FROM shares WHERE created_by=? AND revoked_at IS NULL
			AND (expires_at IS NULL OR expires_at>?) AND node_id IN (?`+strings.Repeat(",?", len(part)-1)+`)`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			out[id] = true
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// CookieName is the unlock cookie of a share (distinct per share so
// several unlocked links can coexist).
func CookieName(shareID string) string {
	if len(shareID) > 16 {
		shareID = shareID[:16]
	}
	return "kore_share_" + shareID
}

// UnlockTTL is how long an unlock cookie is valid.
const UnlockTTL = 12 * time.Hour

func mac(secret []byte, shareID, pwHash string, exp int64) []byte {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte("kore-share-unlock\x00" + shareID + "\x00" + strconv.FormatInt(exp, 10) + "\x00" + pwHash))
	return m.Sum(nil)
}

// SignUnlock returns the cookie value unlocking shareID until exp. It is
// bound to the share and to its current password hash, so changing or
// clearing the password invalidates every earlier cookie.
func SignUnlock(secret []byte, shareID, pwHash string, exp time.Time) string {
	e := exp.Unix()
	return strconv.FormatInt(e, 10) + "." + hex.EncodeToString(mac(secret, shareID, pwHash, e))
}

// VerifyUnlock checks a cookie value made by SignUnlock.
func VerifyUnlock(secret []byte, shareID, pwHash, value string, now time.Time) bool {
	es, ms, ok := strings.Cut(value, ".")
	if !ok {
		return false
	}
	e, err := strconv.ParseInt(es, 10, 64)
	if err != nil || e <= now.Unix() {
		return false
	}
	got, err := hex.DecodeString(ms)
	if err != nil {
		return false
	}
	return hmac.Equal(got, mac(secret, shareID, pwHash, e))
}
