// Package httpapi builds Kore's HTTP router.
package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/artchsh/kore/api/internal/auth"
)

const sessionTTL = 30 * 24 * time.Hour

type server struct {
	db      *sql.DB
	limiter *auth.Limiter
}

// New returns the API handler.
func New(db *sql.DB) http.Handler {
	s := &server{db: db, limiter: auth.NewLimiter(5, 15*time.Minute)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /api/auth/login", s.login)
	mux.HandleFunc("POST /api/auth/logout", s.logout)
	mux.Handle("GET /api/auth/me", auth.RequireUser(http.HandlerFunc(s.me)))
	return auth.Middleware(db)(mux)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func clientIP(r *http.Request) string {
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return h
}

func (s *server) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, 400, map[string]string{"error": "bad request"})
		return
	}
	key := strings.ToLower(strings.TrimSpace(in.Email)) + "|" + clientIP(r)
	if !s.limiter.Allow(key) {
		w.Header().Set("Retry-After", "900")
		writeJSON(w, 429, map[string]string{"error": "too many attempts, try again later"})
		return
	}
	u, err := auth.Authenticate(r.Context(), s.db, in.Email, in.Password)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			s.limiter.Fail(key)
			writeJSON(w, 401, map[string]string{"error": "invalid email or password"})
			return
		}
		writeJSON(w, 500, map[string]string{"error": "internal error"})
		return
	}
	s.limiter.Reset(key)
	tok, err := auth.NewSession(r.Context(), s.db, u.ID, sessionTTL)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "internal error"})
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: auth.CookieName, Value: tok, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: auth.IsHTTPS(r),
		Expires: time.Now().Add(sessionTTL),
	})
	writeJSON(w, 200, u)
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
