package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/artchsh/kore/api/internal/users"
)

// CookieName is the session cookie.
const CookieName = "kore_session"

type ctxKey struct{}

// FromContext returns the authenticated user, if any.
func FromContext(ctx context.Context) (users.User, bool) {
	u, ok := ctx.Value(ctxKey{}).(users.User)
	return u, ok
}

// WithUser returns a context carrying u.
func WithUser(ctx context.Context, u users.User) context.Context {
	return context.WithValue(ctx, ctxKey{}, u)
}

// IsHTTPS reports whether the request arrived over HTTPS (directly or via proxy).
func IsHTTPS(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}

// Middleware loads the session user, if any, into the request context.
// Handlers must use RequireUser/RequireAdmin to enforce authentication.
func Middleware(db *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if c, err := r.Cookie(CookieName); err == nil && c.Value != "" {
				if u, err := UserForToken(r.Context(), db, c.Value); err == nil {
					r = r.WithContext(WithUser(r.Context(), u))
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireUser rejects unauthenticated requests with 401.
func RequireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := FromContext(r.Context()); !ok {
			jsonError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireAdmin rejects non-admins (401 anonymous, 403 non-admin).
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := FromContext(r.Context())
		if !ok {
			jsonError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if u.Role != "admin" {
			jsonError(w, http.StatusForbidden, "forbidden")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func jsonError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
