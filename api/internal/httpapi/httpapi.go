// Package httpapi builds Kore's HTTP router.
package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/uploads"
)

const sessionTTL = 30 * 24 * time.Hour

type server struct {
	db      *sql.DB
	dataDir string
	limiter *auth.Limiter
	uploads *uploads.Uploads
}

// New returns the API handler. dataDir is the (already checked) volume.
func New(db *sql.DB, dataDir string) http.Handler {
	s := &server{db: db, dataDir: dataDir, limiter: auth.NewLimiter(5, 15*time.Minute), uploads: uploads.New(db, dataDir)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /api/auth/login", s.login)
	mux.HandleFunc("POST /api/auth/logout", s.logout)
	mux.Handle("GET /api/auth/me", auth.RequireUser(http.HandlerFunc(s.me)))
	s.registerAdmin(mux)
	s.registerNodes(mux)
	s.registerUploads(mux)
	s.registerTransfer(mux)
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
	return auth.Middleware(db)(mux)
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
		writeJSON(w, 400, map[string]string{"error": "bad request"})
		return
	}
	key := strings.ToLower(strings.TrimSpace(in.Email)) + "|" + ClientIP(r)
	if !s.limiter.Attempt(key) {
		w.Header().Set("Retry-After", "900")
		writeJSON(w, 429, map[string]string{"error": "too many attempts, try again later"})
		return
	}
	u, err := auth.Authenticate(r.Context(), s.db, in.Email, in.Password)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
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
