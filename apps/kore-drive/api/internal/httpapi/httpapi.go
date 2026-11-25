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
	"sync"
	"time"

	"github.com/qarasky/kore/api/internal/auth"
	"github.com/qarasky/kore/api/internal/settings"
	"github.com/qarasky/kore/api/internal/uploads"
)

const sessionTTL = 30 * 24 * time.Hour

type server struct {
	db      *sql.DB
	dataDir string
	limiter *auth.Limiter // share-link password attempts per share|IP
	ipLimit *auth.Limiter // share-link password attempts per client IP
	uploads *uploads.Uploads

	// Public share links (shares.go, public.go).
	now         func() time.Time // injectable clock for share expiry
	shareSecret []byte           // HMAC key for unlock cookies
	shareLimit  *auth.Limiter    // failed unlocks per client IP|share
	shareFail   *auth.Limiter    // failed unlocks per share, any address
	sizeCache   *sizeCache       // shared-folder totals for public pages
	zipMu       sync.Mutex
	zipByIP     map[string]int // running public zips per client address
	publicLimit *auth.Limiter  // requests per client IP across public routes
	zipSlots    chan struct{}  // concurrent public zip streams

	sso *ssoState // Kore ID login; nil unless configured (oidc.go)
}

// New returns the API handler. dataDir is the (already checked) volume.
func New(db *sql.DB, dataDir string, opts ...Option) http.Handler {
	s := newServer(db, dataDir)
	for _, o := range opts {
		o(s)
	}
	return s.handler()
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
		shareFail:   auth.NewLimiter(50, time.Hour),
		sizeCache:   newSizeCache(1000, time.Minute),
		zipByIP:     map[string]int{},
		publicLimit: auth.NewLimiter(300, time.Minute),
		zipSlots:    make(chan struct{}, 4)}
}

func (s *server) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	s.registerSSO(mux)
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
	s.registerBranding(mux)
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
	authed := s.sessionMiddleware(mux)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Public share routes never look at the session cookie: they bypass
		// the session middleware entirely, so being signed in (even as an
		// admin or the owner) changes nothing there.
		if strings.HasPrefix(r.URL.Path, publicPrefix) {
			publicHeaders(w)
			mux.ServeHTTP(w, r)
			return
		}
		// Back-channel logout is called by Kore ID, not a browser: it is
		// authenticated by its signed logout token alone.
		if r.URL.Path == backchannelPath {
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

// busy answers a request that found the password-hash pool saturated (share
// link passwords still use the argon2 pool).
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
	endSession := ""
	if c, err := r.Cookie(auth.CookieName); err == nil {
		endSession = s.ssoLogoutURL(r.Context(), c.Value)
		auth.DeleteSession(r.Context(), s.db, c.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name: auth.CookieName, Value: "", Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: auth.IsHTTPS(r), MaxAge: -1,
	})
	if endSession != "" {
		// Signed in with Kore ID: the browser should also end the SSO session.
		writeJSON(w, 200, map[string]string{"redirect": endSession})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) me(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.FromContext(r.Context())
	writeJSON(w, 200, u)
}
