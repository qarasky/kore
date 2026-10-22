package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/nodes"
	"github.com/artchsh/kore/api/internal/settings"
	"github.com/artchsh/kore/api/internal/uploads"
	"github.com/artchsh/kore/api/internal/users"
)

const (
	minPasswordLen = 8
	maxPasswordLen = 1024
)

func errJSON(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func (s *server) registerAdmin(mux *http.ServeMux) {
	mux.Handle("GET /api/admin/users", auth.RequireAdmin(http.HandlerFunc(s.listUsers)))
	mux.Handle("POST /api/admin/users", auth.RequireAdmin(http.HandlerFunc(s.createUser)))
	mux.Handle("PATCH /api/admin/users/{id}", auth.RequireAdmin(http.HandlerFunc(s.patchUser)))
	mux.Handle("POST /api/admin/users/{id}/password", auth.RequireAdmin(http.HandlerFunc(s.resetPassword)))
	mux.Handle("DELETE /api/admin/users/{id}", auth.RequireAdmin(http.HandlerFunc(s.deleteUser)))
	mux.Handle("GET /api/admin/settings", auth.RequireAdmin(http.HandlerFunc(s.getSettings)))
	mux.Handle("PATCH /api/admin/settings", auth.RequireAdmin(http.HandlerFunc(s.patchSettings)))
	mux.Handle("GET /api/admin/usage", auth.RequireAdmin(http.HandlerFunc(s.usage)))
	mux.Handle("GET /api/admin/disk", auth.RequireAdmin(http.HandlerFunc(s.adminDisk)))
	mux.Handle("POST /api/me/password", auth.RequireUser(http.HandlerFunc(s.changeOwnPassword)))
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(v); err != nil {
		errJSON(w, 400, "bad_request")
		return false
	}
	return true
}

func validEmail(e string) bool {
	a, err := mail.ParseAddress(e)
	return err == nil && a.Address == e && a.Name == "" && len(e) <= 254
}

// usedSQL is quota.Used for the user u (files they uploaded, trashed
// included, plus open uploads), so admin views match each user's meter.
const usedSQL = `COALESCE((SELECT SUM(size) FROM nodes WHERE uploader=u.id AND is_dir=0),0) +
  COALESCE((SELECT SUM(size) FROM uploads WHERE user_id=u.id),0)`

type userRow struct {
	users.User
	UsedBytes int64 `json:"used_bytes"`
	CreatedAt int64 `json:"created_at"`
}

func (s *server) listUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT u.id,u.email,u.role,u.quota_bytes,u.created_at,`+usedSQL+`
		FROM users u ORDER BY u.email`)
	if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	defer rows.Close()
	out := []userRow{}
	for rows.Next() {
		var u userRow
		if err := rows.Scan(&u.ID, &u.Email, &u.Role, &u.QuotaBytes, &u.CreatedAt, &u.UsedBytes); err != nil {
			errJSON(w, 500, "internal")
			return
		}
		out = append(out, u)
	}
	if rows.Err() != nil {
		errJSON(w, 500, "internal")
		return
	}
	writeJSON(w, 200, out)
}

func (s *server) createUser(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email      string `json:"email"`
		Password   string `json:"password"`
		Role       string `json:"role"`
		QuotaBytes *int64 `json:"quota_bytes"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Email = strings.TrimSpace(in.Email)
	if in.Role == "" {
		in.Role = "user"
	}
	switch {
	case !validEmail(in.Email):
		errJSON(w, 400, "invalid_email")
		return
	case len(in.Password) < minPasswordLen:
		errJSON(w, 400, "password_too_short")
		return
	case len(in.Password) > maxPasswordLen:
		errJSON(w, 400, "password_too_long")
		return
	case in.Role != "admin" && in.Role != "user":
		errJSON(w, 400, "invalid_role")
		return
	case in.QuotaBytes != nil && *in.QuotaBytes < 0:
		errJSON(w, 400, "invalid_quota")
		return
	}
	quota := settings.DefaultQuotaBytes(r.Context(), s.db)
	if in.QuotaBytes != nil {
		quota = *in.QuotaBytes
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		hashErr(w, err)
		return
	}
	u, err := users.Create(r.Context(), s.db, in.Email, hash, in.Role, quota)
	if errors.Is(err, users.ErrExists) {
		errJSON(w, 409, "email_in_use")
		return
	}
	if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	writeJSON(w, 201, u)
}

var errLastAdmin = errors.New("last admin")

func getUserTx(ctx context.Context, tx *sql.Tx, id string) (users.User, error) {
	var u users.User
	err := tx.QueryRowContext(ctx, `SELECT id,email,role,quota_bytes FROM users WHERE id=?`, id).
		Scan(&u.ID, &u.Email, &u.Role, &u.QuotaBytes)
	if errors.Is(err, sql.ErrNoRows) {
		return u, users.ErrNotFound
	}
	return u, err
}

func adminCount(ctx context.Context, tx *sql.Tx) (n int, err error) {
	err = tx.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE role='admin'`).Scan(&n)
	return
}

func (s *server) patchUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var in struct {
		Email      *string `json:"email"`
		Role       *string `json:"role"`
		QuotaBytes *int64  `json:"quota_bytes"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Email != nil {
		e := strings.TrimSpace(*in.Email)
		in.Email = &e
		if !validEmail(e) {
			errJSON(w, 400, "invalid_email")
			return
		}
	}
	if in.Role != nil && *in.Role != "admin" && *in.Role != "user" {
		errJSON(w, 400, "invalid_role")
		return
	}
	if in.QuotaBytes != nil && *in.QuotaBytes < 0 {
		errJSON(w, 400, "invalid_quota")
		return
	}
	ctx := r.Context()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	defer tx.Rollback()
	u, err := getUserTx(ctx, tx, id)
	if errors.Is(err, users.ErrNotFound) {
		errJSON(w, 404, "not_found")
		return
	} else if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	if in.Role != nil && u.Role == "admin" && *in.Role != "admin" {
		if n, err := adminCount(ctx, tx); err != nil {
			errJSON(w, 500, "internal")
			return
		} else if n <= 1 {
			errJSON(w, 409, "last_admin")
			return
		}
	}
	if in.Email != nil {
		u.Email = *in.Email
	}
	if in.Role != nil {
		u.Role = *in.Role
	}
	if in.QuotaBytes != nil {
		u.QuotaBytes = *in.QuotaBytes
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET email=?,role=?,quota_bytes=? WHERE id=?`,
		u.Email, u.Role, u.QuotaBytes, id); err != nil {
		if isUnique(err) {
			errJSON(w, 409, "email_in_use")
			return
		}
		errJSON(w, 500, "internal")
		return
	}
	if err := tx.Commit(); err != nil {
		errJSON(w, 500, "internal")
		return
	}
	writeJSON(w, 200, u)
}

func (s *server) setPassword(ctx context.Context, id, pw string) (bool, error) {
	hash, err := auth.HashPassword(pw)
	if err != nil {
		return false, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE users SET pw_hash=? WHERE id=?`, hash, id)
	if err != nil {
		return false, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return false, nil
	}
	// Invalidate existing sessions after a credential change.
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id=?`, id); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

func (s *server) resetPassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		NewPassword string `json:"new_password"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.NewPassword) < minPasswordLen {
		errJSON(w, 400, "password_too_short")
		return
	}
	if len(in.NewPassword) > maxPasswordLen {
		errJSON(w, 400, "password_too_long")
		return
	}
	ok, err := s.setPassword(r.Context(), r.PathValue("id"), in.NewPassword)
	if err != nil {
		hashErr(w, err)
		return
	}
	if !ok {
		errJSON(w, 404, "not_found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// changeOwnPassword checks the current password (rate-limited like login,
// per user and client IP, so a stolen session can't be used to guess it),
// sets the new one, revokes every session and issues a fresh cookie.
func (s *server) changeOwnPassword(w http.ResponseWriter, r *http.Request) {
	me, ok := auth.FromContext(r.Context())
	if !ok {
		errJSON(w, 401, "unauthorized")
		return
	}
	var in struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if !decode(w, r, &in) {
		return
	}
	key := "pw|" + me.ID + "|" + ClientIP(r)
	if !s.limiter.Attempt(key) {
		w.Header().Set("Retry-After", "900")
		errJSON(w, 429, "too_many_attempts")
		return
	}
	_, hash, err := users.GetByEmail(r.Context(), s.db, me.Email)
	if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	match, err := auth.VerifyPassword(hash, in.Current)
	if err != nil {
		hashErr(w, err)
		return
	}
	if !match {
		errJSON(w, 403, "wrong_password")
		return
	}
	s.limiter.Reset(key)
	if len(in.New) < minPasswordLen {
		errJSON(w, 400, "password_too_short")
		return
	}
	if len(in.New) > maxPasswordLen {
		errJSON(w, 400, "password_too_long")
		return
	}
	ok, err = s.setPassword(r.Context(), me.ID, in.New)
	if err != nil {
		hashErr(w, err)
		return
	}
	if !ok {
		errJSON(w, 404, "not_found")
		return
	}
	// All sessions were revoked; keep the caller signed in with a fresh one.
	tok, err := auth.NewSession(r.Context(), s.db, me.ID, sessionTTL)
	if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: auth.CookieName, Value: tok, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: auth.IsHTTPS(r),
		Expires: time.Now().Add(sessionTTL),
	})
	w.WriteHeader(http.StatusNoContent)
}

// deleteUser removes an account. A user who still has files (anything in
// their personal space, trashed included, or files they uploaded to the
// shared space) is refused with 409 user_has_files unless ?files=purge is
// given: then, in the same transaction that deletes the account, their
// personal space is deleted and their shared-space uploads are handed to the
// acting admin (so the files stay and count against the admin's quota).
// Their open upload sessions are always dropped. Blob and staging files are
// removed only after the commit. The last admin can never be deleted, and
// admins cannot delete their own account.
func (s *server) deleteUser(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	id := r.PathValue("id")
	purge := false
	switch r.URL.Query().Get("files") {
	case "":
	case "purge":
		purge = true
	default:
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
	u, err := getUserTx(ctx, tx, id)
	if errors.Is(err, users.ErrNotFound) {
		errJSON(w, 404, "not_found")
		return
	} else if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	if u.Role == "admin" {
		if n, err := adminCount(ctx, tx); err != nil {
			errJSON(w, 500, "internal")
			return
		} else if n <= 1 {
			errJSON(w, 409, "last_admin")
			return
		}
	}
	if u.ID == me.ID {
		errJSON(w, 409, "cannot_delete_self")
		return
	}
	// personal: in their own space; shared: uploaded by them, now in the
	// shared space; other: uploaded by them, now in someone else's space.
	var personal, shared, other int
	if err := tx.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM nodes WHERE space_owner=?1),
		(SELECT count(*) FROM nodes WHERE uploader=?1 AND space_owner IS NULL),
		(SELECT count(*) FROM nodes WHERE uploader=?1 AND space_owner IS NOT NULL AND space_owner<>?1)`, id).
		Scan(&personal, &shared, &other); err != nil {
		errJSON(w, 500, "internal")
		return
	}
	if !purge && personal+shared+other > 0 {
		writeJSON(w, 409, map[string]any{
			"error": "user_has_files", "file_count": personal + shared + other,
			"personal_count": personal, "shared_count": shared, "other_count": other,
		})
		return
	}
	sessions, err := uploads.DeleteUserSessionsTx(ctx, tx, id)
	if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	var blobs []string
	if purge {
		if blobs, err = nodes.PurgeSpaceTx(ctx, tx, id); err != nil {
			errJSON(w, 500, "internal")
			return
		}
		// Their own space is gone; what remains with this uploader sits in
		// someone else's personal space (charge its owner) or in the shared
		// space (charge the acting admin).
		if _, err := tx.ExecContext(ctx, `UPDATE nodes SET uploader=space_owner
			WHERE uploader=? AND space_owner IS NOT NULL`, id); err != nil {
			errJSON(w, 500, "internal")
			return
		}
		if _, err := tx.ExecContext(ctx, `UPDATE nodes SET uploader=? WHERE uploader=? AND space_owner IS NULL`, me.ID, id); err != nil {
			errJSON(w, 500, "internal")
			return
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM users WHERE id=?`, id); err != nil {
		errJSON(w, 500, "internal")
		return
	}
	if err := tx.Commit(); err != nil {
		errJSON(w, 500, "internal")
		return
	}
	nodes.RemoveBlobs(s.dataDir, blobs)
	uploads.RemoveSessionFiles(s.dataDir, sessions)
	w.WriteHeader(http.StatusNoContent)
}

type settingsView struct {
	TrashRetentionDays     int   `json:"trash_retention_days"`
	MaxFileBytes           int64 `json:"max_file_bytes"`
	DefaultQuotaBytes      int64 `json:"default_quota_bytes"`
	ShareLinksEnabled      bool  `json:"share_links_enabled"`
	ShareDefaultExpiryDays int   `json:"share_default_expiry_days"`
}

func (s *server) currentSettings(ctx context.Context) settingsView {
	return settingsView{
		TrashRetentionDays:     settings.TrashRetentionDays(ctx, s.db),
		MaxFileBytes:           settings.MaxFileBytes(ctx, s.db),
		DefaultQuotaBytes:      settings.DefaultQuotaBytes(ctx, s.db),
		ShareLinksEnabled:      settings.ShareLinksEnabled(ctx, s.db),
		ShareDefaultExpiryDays: settings.ShareDefaultExpiryDays(ctx, s.db),
	}
}

func (s *server) getSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, s.currentSettings(r.Context()))
}

func (s *server) patchSettings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		TrashRetentionDays     *int   `json:"trash_retention_days"`
		MaxFileBytes           *int64 `json:"max_file_bytes"`
		DefaultQuotaBytes      *int64 `json:"default_quota_bytes"`
		ShareLinksEnabled      *bool  `json:"share_links_enabled"`
		ShareDefaultExpiryDays *int   `json:"share_default_expiry_days"`
	}
	if !decode(w, r, &in) {
		return
	}
	switch {
	case in.TrashRetentionDays != nil && (*in.TrashRetentionDays < 1 || *in.TrashRetentionDays > 3650):
		errJSON(w, 400, "invalid_trash_retention_days")
		return
	case in.MaxFileBytes != nil && *in.MaxFileBytes < 0:
		errJSON(w, 400, "invalid_max_file_bytes")
		return
	case in.DefaultQuotaBytes != nil && *in.DefaultQuotaBytes < 0:
		errJSON(w, 400, "invalid_default_quota_bytes")
		return
	case in.ShareDefaultExpiryDays != nil && (*in.ShareDefaultExpiryDays < 0 || *in.ShareDefaultExpiryDays > settings.MaxShareDefaultExpiryDays):
		errJSON(w, 400, "invalid_share_default_expiry_days")
		return
	}
	ctx := r.Context()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	defer tx.Rollback()
	put := func(k string, v any) error {
		_, err := tx.ExecContext(ctx,
			`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, toStr(v))
		return err
	}
	var werr error
	if in.TrashRetentionDays != nil {
		werr = put(settings.KeyTrashRetentionDays, *in.TrashRetentionDays)
	}
	if werr == nil && in.MaxFileBytes != nil {
		werr = put(settings.KeyMaxFileBytes, *in.MaxFileBytes)
	}
	if werr == nil && in.DefaultQuotaBytes != nil {
		werr = put(settings.KeyDefaultQuotaBytes, *in.DefaultQuotaBytes)
	}
	if werr == nil && in.ShareLinksEnabled != nil {
		v := 0
		if *in.ShareLinksEnabled {
			v = 1
		}
		werr = put(settings.KeyShareLinksEnabled, v)
	}
	if werr == nil && in.ShareDefaultExpiryDays != nil {
		werr = put(settings.KeyShareDefaultExpiryDays, *in.ShareDefaultExpiryDays)
	}
	if werr != nil || tx.Commit() != nil {
		errJSON(w, 500, "internal")
		return
	}
	writeJSON(w, 200, s.currentSettings(ctx))
}

func toStr(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// usage reports per-user used/quota (counted like quota.Used, so shared-space
// uploads count against the uploader). It never exposes file names.
func (s *server) usage(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT u.id,u.email,u.quota_bytes,`+usedSQL+`
		FROM users u ORDER BY u.email`)
	if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	defer rows.Close()
	type row struct {
		UserID     string `json:"user_id"`
		Email      string `json:"email"`
		UsedBytes  int64  `json:"used_bytes"`
		QuotaBytes int64  `json:"quota_bytes"`
	}
	out := []row{}
	for rows.Next() {
		var x row
		if err := rows.Scan(&x.UserID, &x.Email, &x.QuotaBytes, &x.UsedBytes); err != nil {
			errJSON(w, 500, "internal")
			return
		}
		out = append(out, x)
	}
	writeJSON(w, 200, out)
}

// isUnique reports a UNIQUE constraint violation (the same test users.Create
// uses to produce users.ErrExists).
func isUnique(err error) bool {
	return errors.Is(err, users.ErrExists) || strings.Contains(err.Error(), "UNIQUE")
}
