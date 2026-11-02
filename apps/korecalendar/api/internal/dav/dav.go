// Package dav serves CalDAV (RFC 4791) over the same events and calendars as
// the REST API. Clients sign in with HTTP Basic: the account's email and an
// access token as the password. Another user's paths are 404, never 403.
package dav

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/emersion/go-webdav/caldav"
	"github.com/qarasky/korecalendar/api/internal/auth"
	"github.com/qarasky/korecalendar/api/internal/users"
)

const (
	// Prefix is where the CalDAV tree lives.
	Prefix = "/dav"
	// maxBody caps a request body, as for .ics import.
	maxBody = 5 << 20
	// retryAfter is how long a locked-out client is told to wait.
	retryAfter = 15 * time.Minute
)

// Options are the collaborators the handler needs from the server.
type Options struct {
	Limiter   *auth.Limiter // failed sign-ins per email|client
	IPLimiter *auth.Limiter // failed sign-ins per client across all emails
	ClientKey func(*http.Request) string
}

type ifMatchKey struct{}

// New returns the handler for /dav/ and /.well-known/caldav.
func New(db *sql.DB, o Options) http.Handler {
	cd := &caldav.Handler{Backend: &Backend{db: db}, Prefix: Prefix}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/.well-known/caldav" {
			// Clients probe this before they have credentials.
			http.Redirect(w, r, Prefix+"/", http.StatusMovedPermanently)
			return
		}
		p, ok := authenticate(w, r, db, o)
		if !ok {
			return
		}
		if !ownPath(r.URL.Path, p.UserID) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if r.ContentLength > maxBody {
			http.Error(w, "the request body is larger than 5 MB", http.StatusRequestEntityTooLarge)
			return
		}
		// Not on an empty body: a MaxBytesReader never reports EOF for a zero-length
		// read, which would turn an empty PROPFIND (RFC 4918: allprop) into a 400.
		if r.ContentLength != 0 {
			r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		}
		ctx := auth.WithPrincipal(r.Context(), p)
		if r.Method == http.MethodDelete {
			ctx = context.WithValue(ctx, ifMatchKey{}, r.Header.Get("If-Match"))
		}
		cd.ServeHTTP(w, r.WithContext(ctx))
	})
}

// ownPath reports whether path is /dav/ itself or lies under the caller's own
// principal; anything under another user's id does not exist for the caller.
func ownPath(path, userID string) bool {
	rest := strings.Trim(strings.TrimPrefix(path, Prefix), "/")
	if rest == "" {
		return true
	}
	first, _, _ := strings.Cut(rest, "/")
	return first == userID
}

func challenge(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", `Basic realm="KoreCalendar", charset="UTF-8"`)
	http.Error(w, "authentication required", http.StatusUnauthorized)
}

// authenticate checks Basic credentials: the email of the account and one of
// its access tokens. Sessions, cookies and the account password are refused.
func authenticate(w http.ResponseWriter, r *http.Request, db *sql.DB, o Options) (auth.Principal, bool) {
	email, pass, ok := r.BasicAuth()
	if !ok || email == "" || pass == "" {
		challenge(w)
		return auth.Principal{}, false
	}
	ip := o.ClientKey(r)
	emailKey := strings.ToLower(email) + "|" + ip
	// Every CalDAV request carries credentials and clients run many in
	// parallel, so (unlike a login) only failures count against the budget.
	if o.Limiter.Blocked(emailKey) || o.IPLimiter.Blocked(ip) {
		w.Header().Set("Retry-After", strconv.Itoa(int(retryAfter/time.Second)))
		http.Error(w, "too many failed attempts", http.StatusTooManyRequests)
		return auth.Principal{}, false
	}
	p, ok := auth.TokenPrincipal(r.Context(), db, pass)
	if ok {
		u, err := users.Get(r.Context(), db, p.UserID)
		ok = err == nil && strings.EqualFold(u.Email, email)
	}
	if !ok {
		o.Limiter.Attempt(emailKey)
		o.IPLimiter.Attempt(ip)
		challenge(w)
		return auth.Principal{}, false
	}
	o.Limiter.Reset(emailKey)
	return p, true
}
