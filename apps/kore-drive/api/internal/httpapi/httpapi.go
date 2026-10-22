// Package httpapi builds Kore's HTTP router.
package httpapi

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/settings"
	"github.com/artchsh/kore/api/internal/uploads"
)

const sessionTTL = 30 * 24 * time.Hour

type server struct {
	db      *sql.DB
	dataDir string
	limiter *auth.Limiter // per email|IP (and per user|IP for password changes)
	ipLimit *auth.Limiter // per client IP across all emails
	uploads *uploads.Uploads

	// Public share links (shares.go, public.go).
	now         func() time.Time // injectable clock for share expiry
	shareSecret []byte           // HMAC key for unlock cookies
	shareLimit  *auth.Limiter    // failed unlocks per client IP|share
	publicLimit *auth.Limiter    // requests per client IP across public routes
	zipSlots    chan struct{}    // concurrent public zip streams
}

// New returns the API handler. dataDir is the (already checked) volume.
func New(db *sql.DB, dataDir string) http.Handler {
	return newServer(db, dataDir).handler()
}

func newServer(db *sql.DB, dataDir string) *server {
	secret, err := settings.ShareSecret(context.Background(), db)
	if err != nil {
		// Unlock cookies then just do not survive a restart.
		log.Printf("share secret: %v; using an ephemeral key", err)
		secret = make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			panic(err)
		}
	}
	return &server{db: db, dataDir: dataDir, limiter: auth.NewLimiter(5, 15*time.Minute),
		ipLimit: auth.NewLimiter(30, 15*time.Minute), uploads: uploads.New(db, dataDir),
		now: time.Now, shareSecret: secret,
		shareLimit:  auth.NewLimiter(5, 15*time.Minute),
		publicLimit: auth.NewLimiter(300, time.Minute),
		zipSlots:    make(chan struct{}, 4)}
}

func (s *server) handler() http.Handler {
	db := s.db
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /api/auth/login", s.login)
	mux.HandleFunc("POST /api/auth/logout", s.logout)
	mux.Handle("GET /api/auth/me", auth.RequireUser(http.HandlerFunc(s.me)))
	s.registerMe(mux)
	s.registerAdmin(mux)
	s.registerNodes(mux)
	s.registerTrash(mux)
	s.registerUploads(mux)
	s.registerTransfer(mux)
	s.registerPreview(mux)
	s.registerShares(mux)
	s.registerPublic(mux)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		var allow []string
		for _, m := range []string{"GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"} {
			r2 := r.Clone(r.Context())
			r2.Method = m
			if _, pat := mux.Handler(r2); pat != "" && pat != "/api/" {
				allow = append(allow, m)
			}
		}
		if len(allow) > 0 {
			w.Header().Set("Allow", strings.Join(allow, ", "))
			writeJSON(w, 405, map[string]string{"error": "method_not_allowed"})
			return
		}
		writeJSON(w, 404, map[string]string{"error": "not_found"})
	})
	authed := auth.Middleware(db)(mux)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Public share routes never look at the session cookie: they bypass
		// the session middleware entirely, so being signed in (even as an
		// admin or the owner) changes nothing there.
		if strings.HasPrefix(r.URL.Path, publicPrefix) {
			publicHeaders(w)
			mux.ServeHTTP(w, r)
			return
		}
		authed.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func (s *server) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&in); err != nil {
		errJSON(w, 400, "bad_request")
		return
	}
	ip := ClientIP(r)
	ipKey := "ip|" + ip
	key := strings.ToLower(strings.TrimSpace(in.Email)) + "|" + ip
	if !s.ipLimit.Attempt(ipKey) || !s.limiter.Attempt(key) {
		w.Header().Set("Retry-After", "900")
		errJSON(w, 429, "too_many_attempts")
		return
	}
	u, err := auth.Authenticate(r.Context(), s.db, in.Email, in.Password)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrInvalidCredentials):
			errJSON(w, 401, "invalid_credentials")
		case errors.Is(err, auth.ErrBusy):
			busy(w)
		default:
			errJSON(w, 500, "internal")
		}
		return
	}
	s.limiter.Reset(key)
	s.ipLimit.Forgive(ipKey)
	tok, err := auth.NewSession(r.Context(), s.db, u.ID, sessionTTL)
	if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: auth.CookieName, Value: tok, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: auth.IsHTTPS(r),
		Expires: time.Now().Add(sessionTTL),
	})
	writeJSON(w, 200, u)
}

// busy answers a request that found the password-hash pool saturated.
func busy(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "2")
	errJSON(w, 503, "busy")
}

// hashErr maps a password hashing failure to its HTTP error.
func hashErr(w http.ResponseWriter, err error) {
	if errors.Is(err, auth.ErrBusy) {
		busy(w)
		return
	}
	errJSON(w, 500, "internal")
}

func (s *server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(auth.CookieName); err == nil {
		auth.DeleteSession(r.Context(), s.db, c.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name: auth.CookieName, Value: "", Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: auth.IsHTTPS(r), MaxAge: -1,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) me(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.FromContext(r.Context())
	writeJSON(w, 200, u)
}
