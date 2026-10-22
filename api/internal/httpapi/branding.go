package httpapi

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/settings"
)

// The login screen picture: one admin-uploaded PNG/JPEG/WebP stored at a
// fixed path on the data volume, served publicly (the login page shows it to
// anyone). Without one the web app shows its built-in artwork.

const (
	maxLoginImageBytes = 5 << 20
	brandingDirName    = "branding"
	loginImageName     = "login-image"
	loginImageCSP      = "default-src 'none'; sandbox"
)

func (s *server) registerBranding(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/branding", s.getBranding)
	mux.HandleFunc("GET /api/branding/login-image", s.serveLoginImage)
	mux.Handle("POST /api/admin/branding/login-image", auth.RequireAdmin(http.HandlerFunc(s.uploadLoginImage)))
	mux.Handle("DELETE /api/admin/branding/login-image", auth.RequireAdmin(http.HandlerFunc(s.resetLoginImage)))
}

// sniffImage returns the content type of a PNG, JPEG or WebP image from its
// magic bytes, or "" for anything else (SVG, GIF, HTML, ...).
func sniffImage(b []byte) string {
	switch {
	case bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")):
		return "image/png"
	case bytes.HasPrefix(b, []byte("\xff\xd8\xff")):
		return "image/jpeg"
	case len(b) >= 12 && bytes.Equal(b[:4], []byte("RIFF")) && bytes.Equal(b[8:12], []byte("WEBP")):
		return "image/webp"
	}
	return ""
}

func (s *server) brandingDir() string { return filepath.Join(s.dataDir, brandingDirName) }
func (s *server) loginImagePath() string {
	return filepath.Join(s.brandingDir(), loginImageName)
}

type brandingState struct {
	LoginImage bool  `json:"login_image"`
	Version    int64 `json:"version"`
	ctype      string
}

func (s *server) branding(ctx context.Context) brandingState {
	var b brandingState
	if v, ok := settings.Get(ctx, s.db, settings.KeyLoginImageVersion); ok {
		b.Version, _ = strconv.ParseInt(v, 10, 64)
	}
	if ct, ok := settings.Get(ctx, s.db, settings.KeyLoginImageType); ok && sniffType(ct) {
		if _, err := os.Stat(s.loginImagePath()); err == nil {
			b.LoginImage, b.ctype = true, ct
		}
	}
	return b
}

// sniffType reports whether ct is one of the types sniffImage returns.
func sniffType(ct string) bool {
	return ct == "image/png" || ct == "image/jpeg" || ct == "image/webp"
}

func (s *server) getBranding(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, s.branding(r.Context()))
}

func (s *server) serveLoginImage(w http.ResponseWriter, r *http.Request) {
	b := s.branding(r.Context())
	if !b.LoginImage {
		errJSON(w, 404, "not_found")
		return
	}
	f, err := os.Open(s.loginImagePath())
	if err != nil {
		errJSON(w, 404, "not_found")
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	h := w.Header()
	h.Set("Content-Type", b.ctype)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", loginImageCSP)
	h.Set("Cache-Control", "public, max-age=3600")
	h.Set("ETag", fmt.Sprintf(`"li-%d-%d"`, b.Version, st.Size()))
	http.ServeContent(w, r, "", time.Time{}, f)
}

// uploadLoginImage stores multipart field "file" as the login picture. The
// client's file name is ignored; the type comes from the magic bytes.
func (s *server) uploadLoginImage(w http.ResponseWriter, r *http.Request) {
	// Room for the multipart framing around a file at the cap.
	r.Body = http.MaxBytesReader(w, r.Body, maxLoginImageBytes+64<<10)
	mr, err := r.MultipartReader()
	if err != nil {
		errJSON(w, 400, "bad_request")
		return
	}
	var part io.ReadCloser
	for {
		p, err := mr.NextPart()
		if err != nil {
			if tooLarge(err) {
				errJSON(w, 413, "too_large")
			} else {
				errJSON(w, 400, "bad_request")
			}
			return
		}
		if p.FormName() == "file" {
			part = p
			break
		}
		p.Close()
	}
	defer part.Close()

	dir := s.brandingDir()
	if err := os.MkdirAll(dir, 0o750); err != nil {
		log.Printf("branding: mkdir: %v", err)
		errJSON(w, 500, "internal")
		return
	}
	tmp, err := os.CreateTemp(dir, ".upload-*")
	if err != nil {
		log.Printf("branding: temp file: %v", err)
		errJSON(w, 500, "internal")
		return
	}
	committed := false
	defer func() {
		if !committed {
			tmp.Close()
			os.Remove(tmp.Name())
		}
	}()
	n, err := io.Copy(tmp, io.LimitReader(part, maxLoginImageBytes+1))
	switch {
	case err != nil && tooLarge(err), n > maxLoginImageBytes:
		errJSON(w, 413, "too_large")
		return
	case err != nil:
		errJSON(w, 400, "bad_request")
		return
	}
	head := make([]byte, 16)
	k, _ := tmp.ReadAt(head, 0)
	ctype := sniffImage(head[:k])
	if ctype == "" {
		errJSON(w, 415, "unsupported_image")
		return
	}
	if err := tmp.Sync(); err != nil {
		errJSON(w, 500, "internal")
		return
	}
	if err := tmp.Close(); err != nil {
		errJSON(w, 500, "internal")
		return
	}
	if err := os.Rename(tmp.Name(), s.loginImagePath()); err != nil {
		log.Printf("branding: rename: %v", err)
		errJSON(w, 500, "internal")
		return
	}
	committed = true
	// The file is in place before the settings point at it; no tx is held
	// during the file I/O above.
	if err := s.setLoginImage(r.Context(), ctype); err != nil {
		log.Printf("branding: settings: %v", err)
		errJSON(w, 500, "internal")
		return
	}
	writeJSON(w, 200, s.branding(r.Context()))
}

// resetLoginImage goes back to the built-in artwork: the settings first, then
// (after commit) the file.
func (s *server) resetLoginImage(w http.ResponseWriter, r *http.Request) {
	if err := s.setLoginImage(r.Context(), ""); err != nil {
		log.Printf("branding: reset: %v", err)
		errJSON(w, 500, "internal")
		return
	}
	if err := os.Remove(s.loginImagePath()); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Printf("branding: remove: %v", err)
	}
	writeJSON(w, 200, s.branding(r.Context()))
}

// setLoginImage stores ctype ("" deletes it) and advances the version, in
// one transaction.
func (s *server) setLoginImage(ctx context.Context, ctype string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var prev int64
	var v string
	if err := tx.QueryRowContext(ctx, `SELECT value FROM settings WHERE key=?`, settings.KeyLoginImageVersion).Scan(&v); err == nil {
		prev, _ = strconv.ParseInt(v, 10, 64)
	}
	next := max(time.Now().UnixMilli(), prev+1)
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
		settings.KeyLoginImageVersion, strconv.FormatInt(next, 10)); err != nil {
		return err
	}
	if ctype == "" {
		_, err = tx.ExecContext(ctx, `DELETE FROM settings WHERE key=?`, settings.KeyLoginImageType)
	} else {
		_, err = tx.ExecContext(ctx,
			`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
			settings.KeyLoginImageType, ctype)
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}

func tooLarge(err error) bool {
	var mbe *http.MaxBytesError
	return errors.As(err, &mbe)
}
