package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
)

// CookieName is the session cookie.
const CookieName = "korecal_session"

// Principal is who is making a request.
type Principal struct {
	UserID    string
	Role      string
	Via       string // "session" or "token"
	TokenName string // set when Via == "token"
}

// Label is what gets recorded as "who changed this": "user" for sessions,
// the token's name for tokens.
func (p Principal) Label() string {
	if p.Via == "token" {
		return p.TokenName
	}
	return "user"
}

type ctxKey struct{}

// FromContext returns the authenticated principal, if any.
func FromContext(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(ctxKey{}).(Principal)
	return p, ok
}

// WithPrincipal returns a context carrying p.
func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, ctxKey{}, p)
}

// IsHTTPS reports whether the request arrived over HTTPS (directly or via a
// trusted proxy, which Caddy enforces by overwriting forwarded headers).
func IsHTTPS(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}

// RawToken returns the bearer token or session cookie value of a request.
func RawToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	if c, err := r.Cookie(CookieName); err == nil {
		return c.Value
	}
	return ""
}

// Require authenticates the request (session bearer token or cookie) and
// puts the Principal in the context; otherwise it answers 401 unauthorized.
func Require(db *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p, ok := authenticate(r, db)
			if !ok {
				writeErr(w, http.StatusUnauthorized, "unauthorized", "authentication required")
				return
			}
			next.ServeHTTP(w, r.WithContext(WithPrincipal(r.Context(), p)))
		})
	}
}

func authenticate(r *http.Request, db *sql.DB) (Principal, bool) {
	tok := RawToken(r)
	if tok == "" {
		return Principal{}, false
	}
	if isToken(tok) {
		return principalForToken(r.Context(), db, tok)
	}
	u, err := UserForToken(r.Context(), db, tok)
	if err != nil {
		return Principal{}, false
	}
	return Principal{UserID: u.ID, Role: u.Role, Via: "session"}, true
}

// RequireAdmin must run after Require. Non-admins get 404, so the route's
// existence is not revealed.
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p, ok := FromContext(r.Context()); !ok || p.Role != "admin" {
			writeErr(w, http.StatusNotFound, "not_found", "not found")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeErr(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": msg}})
}

// RequireSession must run after Require. It rejects token principals with
// 403 forbidden, so a leaked agent token cannot manage tokens.
func RequireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p, ok := FromContext(r.Context()); !ok || p.Via != "session" {
			writeErr(w, http.StatusForbidden, "forbidden", "this action needs a signed-in session, not an access token")
			return
		}
		next.ServeHTTP(w, r)
	})
}
