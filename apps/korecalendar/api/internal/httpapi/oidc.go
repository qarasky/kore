package httpapi

import (
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/qarasky/korecalendar/api/internal/auth"
	"github.com/qarasky/korecalendar/api/internal/sso"
)

const (
	oidcFlowTTL    = 10 * time.Minute
	oidcFlowCookie = "korecal_oidc"
	oidcCookiePath = "/api/auth/oidc"
)

var unsafeNext = regexp.MustCompile(`[\\\s\x00-\x1f\x7f]`)

// safeNext returns raw if it is a same-origin relative path that is safe to
// redirect to after sign-in, else "/". It mirrors web/lib/safe-next.ts.
func safeNext(raw string) string {
	if !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || unsafeNext.MatchString(raw) {
		return "/"
	}
	u, err := url.Parse(raw)
	if err != nil || u.IsAbs() || u.Host != "" {
		return "/"
	}
	for _, p := range []string{"/login", "/setup"} {
		if u.Path == p || strings.HasPrefix(u.Path, p+"/") {
			return "/"
		}
	}
	return raw
}

func hashState(state string) string {
	h := sha256.Sum256([]byte(state))
	return hex.EncodeToString(h[:])
}

// handleAuthConfig tells the sign-in pages (web, Android) which ways in exist.
func (s *server) handleAuthConfig(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"password_login": s.passwordLogin, "oidc": nil}
	if s.sso != nil {
		out["oidc"] = map[string]any{
			"name":      s.ssoName,
			"issuer":    s.sso.Provider.Issuer(),
			"login_url": "/api/auth/oidc/login",
			"client_id": s.sso.Cfg.ClientID,
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func loginError(w http.ResponseWriter, r *http.Request, code string) {
	http.Redirect(w, r, "/login?error="+url.QueryEscape(code), http.StatusFound)
}

// handleOIDCLogin starts the authorization-code flow: PKCE verifier, state and
// nonce are kept server-side; the browser also gets a cookie holding the state
// so the callback can only be completed by the browser that started it.
func (s *server) handleOIDCLogin(w http.ResponseWriter, r *http.Request) {
	if s.sso == nil {
		errJSON(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	if !s.ipLimit.Attempt(limitKey(r)) {
		rateLimited(w, 15*time.Minute)
		return
	}
	next := safeNext(r.URL.Query().Get("next"))
	flow, err := s.sso.Provider.Begin(r.Context())
	if err != nil {
		log.Printf("oidc: begin: %v", err)
		loginError(w, r, "provider_unavailable")
		return
	}
	now := time.Now()
	s.db.ExecContext(r.Context(), `DELETE FROM oidc_flows WHERE expires_at<?`, now.Unix())
	if _, err := s.db.ExecContext(r.Context(), `INSERT INTO oidc_flows(state_hash,nonce,verifier,next,expires_at) VALUES(?,?,?,?,?)`,
		hashState(flow.State), flow.Nonce, flow.Verifier, next, now.Add(oidcFlowTTL).Unix()); err != nil {
		errJSON(w, http.StatusInternalServerError, "internal", "could not start the sign-in")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: oidcFlowCookie, Value: flow.State, Path: oidcCookiePath, HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: auth.IsHTTPS(r), MaxAge: int(oidcFlowTTL.Seconds())})
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, flow.URL, http.StatusFound)
}

// takeFlow reads and deletes the stored flow for state in one step, so a state
// (and its code) works once.
func (s *server) takeFlow(r *http.Request, state string) (nonce, verifier, next string, ok bool) {
	var exp int64
	err := s.db.QueryRowContext(r.Context(),
		`DELETE FROM oidc_flows WHERE state_hash=? RETURNING nonce,verifier,next,expires_at`, hashState(state)).
		Scan(&nonce, &verifier, &next, &exp)
	if errors.Is(err, sql.ErrNoRows) || err != nil || exp < time.Now().Unix() {
		return "", "", "", false
	}
	return nonce, verifier, next, true
}

func (s *server) handleOIDCCallback(w http.ResponseWriter, r *http.Request) {
	if s.sso == nil {
		errJSON(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	clear := &http.Cookie{Name: oidcFlowCookie, Value: "", Path: oidcCookiePath, MaxAge: -1, HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: auth.IsHTTPS(r)}
	http.SetCookie(w, clear)

	q := r.URL.Query()
	if !s.ipLimit.Attempt(limitKey(r)) {
		loginError(w, r, "rate_limited")
		return
	}
	state, code := q.Get("state"), q.Get("code")
	c, err := r.Cookie(oidcFlowCookie)
	if state == "" || err != nil || subtle.ConstantTimeCompare([]byte(c.Value), []byte(state)) != 1 {
		loginError(w, r, "invalid_state")
		return
	}
	nonce, verifier, next, ok := s.takeFlow(r, state)
	if !ok {
		loginError(w, r, "invalid_state")
		return
	}
	// RFC 9207: if the provider says who answered, it must be our issuer.
	if iss := q.Get("iss"); iss != "" && iss != s.sso.Provider.Issuer() {
		loginError(w, r, "invalid_issuer")
		return
	}
	if e := q.Get("error"); e != "" {
		loginError(w, r, "provider_"+safeCode(e))
		return
	}
	if code == "" {
		loginError(w, r, "invalid_request")
		return
	}
	claims, idToken, err := s.sso.Provider.Exchange(r.Context(), code, verifier, nonce)
	if err != nil {
		log.Printf("oidc: exchange: %v", err)
		loginError(w, r, "exchange_failed")
		return
	}
	u, err := s.sso.Resolve(r.Context(), claims)
	switch {
	case errors.Is(err, sso.ErrNoAccount):
		loginError(w, r, "no_account")
		return
	case errors.Is(err, sso.ErrEmailInUse), errors.Is(err, sso.ErrAlreadyLinks):
		loginError(w, r, "email_in_use")
		return
	case errors.Is(err, sso.ErrNoAdmin):
		loginError(w, r, "no_admin")
		return
	case errors.Is(err, sso.ErrNoEmail):
		loginError(w, r, "no_email")
		return
	case err != nil:
		log.Printf("oidc: resolve user: %v", err)
		loginError(w, r, "internal")
		return
	}
	tok, err := auth.NewSessionWithIDToken(r.Context(), s.db, u.ID, sessionTTL, idToken)
	if err != nil {
		loginError(w, r, "internal")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: auth.CookieName, Value: tok, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: auth.IsHTTPS(r), MaxAge: int(sessionTTL.Seconds())})
	http.Redirect(w, r, safeNext(next), http.StatusFound)
}

var nonCode = regexp.MustCompile(`[^a-z_]`)

func safeCode(e string) string {
	e = nonCode.ReplaceAllString(strings.ToLower(e), "")
	if len(e) > 40 {
		e = e[:40]
	}
	return e
}
