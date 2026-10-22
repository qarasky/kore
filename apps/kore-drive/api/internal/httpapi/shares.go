package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/nodes"
	"github.com/artchsh/kore/api/internal/settings"
	"github.com/artchsh/kore/api/internal/shares"
)

const (
	minSharePasswordLen = 8
	maxSharePasswordLen = 1024
)

// registerShares mounts the owner's share-link management. Every route is
// scoped to the caller's own shares (someone else's share is 404, admins
// included).
func (s *server) registerShares(mux *http.ServeMux) {
	mux.Handle("POST /api/shares", auth.RequireUser(http.HandlerFunc(s.createShare)))
	mux.Handle("GET /api/shares", auth.RequireUser(http.HandlerFunc(s.listShares)))
	mux.Handle("PATCH /api/shares/{id}", auth.RequireUser(http.HandlerFunc(s.patchShare)))
	mux.Handle("DELETE /api/shares/{id}", auth.RequireUser(http.HandlerFunc(s.deleteShare)))
	mux.Handle("GET /api/nodes/{id}/shares", auth.RequireUser(http.HandlerFunc(s.nodeShares)))
}

type shareJSON struct {
	ID             string `json:"id"`
	Token          string `json:"token"`
	URLPath        string `json:"url_path"`
	NodeID         string `json:"node_id"`
	NodeName       string `json:"node_name"`
	IsDir          bool   `json:"is_dir"`
	Size           int64  `json:"size"`
	CreatedAt      int64  `json:"created_at"`
	ExpiresAt      *int64 `json:"expires_at"`
	HasPassword    bool   `json:"has_password"`
	DownloadCount  int64  `json:"download_count"`
	LastAccessedAt *int64 `json:"last_accessed_at"`
	Status         string `json:"status"`
}

func (s *server) shareOut(sh shares.Share) shareJSON {
	out := shareJSON{sh.ID, sh.Token, "/s/" + sh.Token, sh.NodeID, sh.NodeName, sh.NodeIsDir, sh.NodeSize,
		sh.CreatedAt, sh.ExpiresAt, sh.PasswordHash != nil, sh.DownloadCount, sh.LastAccessedAt, sh.Status(s.now())}
	if !sh.CreatorCanAccess() {
		// The item now lives in someone else's personal space: say nothing
		// about it (not even its current name).
		out.NodeName, out.Size = "", 0
	}
	return out
}

// expiryIn parses expires_in_days: absent → def (0 = never), null → never,
// else one of 1, 7, 30. set=false means "absent".
func expiryIn(raw json.RawMessage) (days int, set, ok bool) {
	if raw == nil {
		return 0, false, true
	}
	if string(raw) == "null" {
		return 0, true, true
	}
	if err := json.Unmarshal(raw, &days); err != nil {
		return 0, true, false
	}
	switch days {
	case 1, 7, 30:
		return days, true, true
	}
	return 0, true, false
}

func expiresAt(now time.Time, days int) *int64 {
	if days <= 0 {
		return nil
	}
	e := now.Add(time.Duration(days) * 24 * time.Hour).Unix()
	return &e
}

// sharePassword validates and hashes a link password (outside any tx).
func sharePassword(w http.ResponseWriter, pw string) (*string, bool) {
	switch {
	case len(pw) < minSharePasswordLen:
		errJSON(w, 400, "password_too_short")
		return nil, false
	case len(pw) > maxSharePasswordLen:
		errJSON(w, 400, "password_too_long")
		return nil, false
	}
	h, err := auth.HashPassword(pw)
	if err != nil {
		hashErr(w, err)
		return nil, false
	}
	return &h, true
}

func (s *server) createShare(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	var in struct {
		NodeID        string          `json:"node_id"`
		ExpiresInDays json.RawMessage `json:"expires_in_days"`
		Password      *string         `json:"password"`
	}
	if !requireJSON(w, r) || !decode(w, r, &in) {
		return
	}
	ctx := r.Context()
	if !settings.ShareLinksEnabled(ctx, s.db) {
		errJSON(w, 403, "shares_disabled")
		return
	}
	days, set, ok := expiryIn(in.ExpiresInDays)
	if !ok {
		errJSON(w, 400, "invalid_expiry")
		return
	}
	if !set {
		days = settings.ShareDefaultExpiryDays(ctx, s.db)
	}
	var pwHash *string
	if in.Password != nil && *in.Password != "" {
		if pwHash, ok = sharePassword(w, *in.Password); !ok {
			return
		}
	}
	now := s.now()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	defer tx.Rollback()
	// nodes.Get: live (not trashed) and accessible to the caller, else 404.
	// A space root has no node row, so it can never be shared.
	if _, err := nodes.Get(ctx, tx, me, in.NodeID); err != nil {
		nodeErr(w, err)
		return
	}
	id, _, err := shares.Insert(ctx, tx, in.NodeID, me.ID, now.Unix(), expiresAt(now, days), pwHash)
	if err != nil {
		log.Printf("share create: %v", err)
		errJSON(w, 500, "internal")
		return
	}
	sh, err := shares.Mine(ctx, tx, me.ID, id)
	if err != nil || tx.Commit() != nil {
		errJSON(w, 500, "internal")
		return
	}
	writeJSON(w, 201, s.shareOut(sh))
}

func (s *server) writeShares(w http.ResponseWriter, list []shares.Share) {
	out := make([]shareJSON, len(list))
	for i, sh := range list {
		out[i] = s.shareOut(sh)
	}
	writeJSON(w, 200, out)
}

func (s *server) listShares(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	list, err := shares.List(r.Context(), s.db, me.ID, "")
	if err != nil {
		log.Printf("share list: %v", err)
		errJSON(w, 500, "internal")
		return
	}
	s.writeShares(w, list)
}

func (s *server) nodeShares(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	n, err := nodes.Get(r.Context(), s.db, me, r.PathValue("id"))
	if err != nil {
		nodeErr(w, err)
		return
	}
	list, err := shares.List(r.Context(), s.db, me.ID, n.ID)
	if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	s.writeShares(w, list)
}

func (s *server) patchShare(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	var in struct {
		ExpiresInDays json.RawMessage `json:"expires_in_days"`
		Password      json.RawMessage `json:"password"` // absent = unchanged, null = clear
		Revoked       *bool           `json:"revoked"`
	}
	if !requireJSON(w, r) || !decode(w, r, &in) {
		return
	}
	var p shares.Patch
	days, set, ok := expiryIn(in.ExpiresInDays)
	if !ok {
		errJSON(w, 400, "invalid_expiry")
		return
	}
	now := s.now()
	if set {
		p.SetExpiry, p.ExpiresAt = true, expiresAt(now, days)
	}
	if in.Password != nil {
		p.SetPassword = true
		if string(in.Password) != "null" {
			var pw string
			if err := json.Unmarshal(in.Password, &pw); err != nil {
				errJSON(w, 400, "bad_request")
				return
			}
			// Hash before the tx (argon2 must not hold the write lock).
			if p.PasswordHash, ok = sharePassword(w, pw); !ok {
				return
			}
		}
	}
	if in.Revoked != nil {
		p.SetRevoked, p.Revoked = true, *in.Revoked
	}
	if !p.SetExpiry && !p.SetPassword && !p.SetRevoked {
		errJSON(w, 400, "bad_request")
		return
	}
	ctx := r.Context()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	defer tx.Rollback()
	id := r.PathValue("id")
	if err := shares.Update(ctx, tx, me.ID, id, now.Unix(), p); err != nil {
		shareErr(w, err)
		return
	}
	sh, err := shares.Mine(ctx, tx, me.ID, id)
	if err != nil || tx.Commit() != nil {
		errJSON(w, 500, "internal")
		return
	}
	writeJSON(w, 200, s.shareOut(sh))
}

// deleteShare revokes a link (the row stays so the list shows it as
// revoked); ?purge=1 removes it for good.
func (s *server) deleteShare(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	ctx, id := r.Context(), r.PathValue("id")
	var err error
	switch r.URL.Query().Get("purge") {
	case "1":
		err = shares.Delete(ctx, s.db, me.ID, id)
	case "":
		var tx interface {
			shares.Queryer
			Commit() error
			Rollback() error
		}
		if tx, err = s.db.BeginTx(ctx, nil); err == nil {
			defer tx.Rollback()
			if err = shares.Update(ctx, tx, me.ID, id, s.now().Unix(), shares.Patch{SetRevoked: true, Revoked: true}); err == nil {
				err = tx.Commit()
			}
		}
	default:
		errJSON(w, 400, "bad_request")
		return
	}
	if err != nil {
		shareErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func shareErr(w http.ResponseWriter, err error) {
	if errors.Is(err, shares.ErrNotFound) {
		errJSON(w, 404, "not_found")
		return
	}
	log.Printf("share: %v", err)
	errJSON(w, 500, "internal")
}
