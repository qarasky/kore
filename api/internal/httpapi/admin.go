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
	"github.com/artchsh/kore/api/internal/settings"
	"github.com/artchsh/kore/api/internal/users"
)

const minPasswordLen = 8

func errJSON(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// adminOnly is like auth.RequireAdmin but always answers with JSON.
func adminOnly(h http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := auth.FromContext(r.Context())
		if !ok {
			errJSON(w, 401, "unauthorized")
			return
		}
		if u.Role != "admin" {
			errJSON(w, 403, "forbidden")
			return
		}
		h(w, r)
	})
}

func (s *server) registerAdmin(mux *http.ServeMux) {
	mux.Handle("GET /api/admin/users", adminOnly(s.listUsers))
	mux.Handle("POST /api/admin/users", adminOnly(s.createUser))
	mux.Handle("PATCH /api/admin/users/{id}", adminOnly(s.patchUser))
	mux.Handle("POST /api/admin/users/{id}/password", adminOnly(s.resetPassword))
	mux.Handle("DELETE /api/admin/users/{id}", adminOnly(s.deleteUser))
	mux.Handle("GET /api/admin/settings", adminOnly(s.getSettings))
	mux.Handle("PATCH /api/admin/settings", adminOnly(s.patchSettings))
	mux.Handle("GET /api/admin/usage", adminOnly(s.usage))
	mux.HandleFunc("POST /api/me/password", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := auth.FromContext(r.Context()); !ok {
			errJSON(w, 401, "unauthorized")
			return
		}
		s.changeOwnPassword(w, r)
	})
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

func (s *server) listUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id,email,role,quota_bytes FROM users ORDER BY email`)
	if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	defer rows.Close()
	out := []users.User{}
	for rows.Next() {
		var u users.User
		if err := rows.Scan(&u.ID, &u.Email, &u.Role, &u.QuotaBytes); err != nil {
			errJSON(w, 500, "internal")
			return
		}
		out = append(out, u)
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
		errJSON(w, 500, "internal")
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
		if strings.Contains(err.Error(), "UNIQUE") {
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
	ok, err := s.setPassword(r.Context(), r.PathValue("id"), in.NewPassword)
	if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	if !ok {
		errJSON(w, 404, "not_found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) changeOwnPassword(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	var in struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if !decode(w, r, &in) {
		return
	}
	_, hash, err := users.GetByEmail(r.Context(), s.db, me.Email)
	if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	if !auth.VerifyPassword(hash, in.Current) {
		errJSON(w, 403, "wrong_password")
		return
	}
	if len(in.New) < minPasswordLen {
		errJSON(w, 400, "password_too_short")
		return
	}
	if ok, err := s.setPassword(r.Context(), me.ID, in.New); err != nil || !ok {
		errJSON(w, 500, "internal")
		return
	}
	// All sessions were revoked; keep the caller signed in with a fresh one.
	if tok, err := auth.NewSession(r.Context(), s.db, me.ID, sessionTTL); err == nil {
		http.SetCookie(w, &http.Cookie{
			Name: auth.CookieName, Value: tok, Path: "/", HttpOnly: true,
			SameSite: http.SameSiteLaxMode, Secure: auth.IsHTTPS(r),
			Expires: time.Now().Add(sessionTTL),
		})
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) deleteUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
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
	var files int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM nodes WHERE space_owner=?`, id).Scan(&files); err != nil {
		errJSON(w, 500, "internal")
		return
	}
	if files > 0 {
		writeJSON(w, 409, map[string]any{"error": "user_has_files", "file_count": files})
		return
	}
	// Items the user uploaded into shared spaces still reference them.
	var uploaded int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM nodes WHERE uploader=?`, id).Scan(&uploaded); err != nil {
		errJSON(w, 500, "internal")
		return
	}
	if uploaded > 0 {
		writeJSON(w, 409, map[string]any{"error": "user_has_files", "file_count": uploaded})
		return
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM users WHERE id=?`, id); err != nil {
		errJSON(w, 500, "internal")
		return
	}
	if err := tx.Commit(); err != nil {
		errJSON(w, 500, "internal")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type settingsView struct {
	TrashRetentionDays int   `json:"trash_retention_days"`
	MaxFileBytes       int64 `json:"max_file_bytes"`
	DefaultQuotaBytes  int64 `json:"default_quota_bytes"`
}

func (s *server) currentSettings(ctx context.Context) settingsView {
	return settingsView{
		TrashRetentionDays: settings.TrashRetentionDays(ctx, s.db),
		MaxFileBytes:       settings.MaxFileBytes(ctx, s.db),
		DefaultQuotaBytes:  settings.DefaultQuotaBytes(ctx, s.db),
	}
}

func (s *server) getSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, s.currentSettings(r.Context()))
}

func (s *server) patchSettings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		TrashRetentionDays *int   `json:"trash_retention_days"`
		MaxFileBytes       *int64 `json:"max_file_bytes"`
		DefaultQuotaBytes  *int64 `json:"default_quota_bytes"`
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
	}
	ctx := r.Context()
	set := func(k string, v any) bool {
		if err := settings.Set(ctx, s.db, k, toStr(v)); err != nil {
			errJSON(w, 500, "internal")
			return false
		}
		return true
	}
	if in.TrashRetentionDays != nil && !set(settings.KeyTrashRetentionDays, int64(*in.TrashRetentionDays)) {
		return
	}
	if in.MaxFileBytes != nil && !set(settings.KeyMaxFileBytes, *in.MaxFileBytes) {
		return
	}
	if in.DefaultQuotaBytes != nil && !set(settings.KeyDefaultQuotaBytes, *in.DefaultQuotaBytes) {
		return
	}
	writeJSON(w, 200, s.currentSettings(ctx))
}

func toStr(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func (s *server) usage(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `
SELECT u.id,u.email,u.quota_bytes,COALESCE(SUM(n.size),0)
FROM users u LEFT JOIN nodes n ON n.space_owner=u.id AND n.is_dir=0
GROUP BY u.id ORDER BY u.email`)
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
