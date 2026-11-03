package httpapi

import (
	"context"
	"crypto/subtle"
	"errors"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/qarasky/kore/api/internal/auth"
	"github.com/qarasky/kore/api/internal/config"
	"github.com/qarasky/kore/api/internal/oidc"
	"github.com/qarasky/kore/api/internal/settings"
	"github.com/qarasky/kore/api/internal/users"
)

const (
	callbackPath    = "/api/auth/oidc/callback"
	backchannelPath = "/api/auth/oidc/backchannel-logout"
	flowCookie      = "kore_oidc"
	flowTTL         = 10 * time.Minute
	refreshEvery    = 10 * time.Minute // how often an SSO session proves itself to the provider
	refreshBackoff  = time.Minute      // retry delay after a transient provider failure
	defaultNext     = "/files"
)

type ssoState struct {
	p             *oidc.Provider
	publicURL     string
	linkByEmail   bool
	autoProvision bool
	ownerEmail    string            // first admin on a fresh install ("" = none)
	apps          map[string]string // app switcher: app key -> base URL (this app included)
	limit         *auth.Limiter
	refreshMu     sync.Mutex // serialises refresh-token rotation (parallel redemptions look like theft)
}

// Option configures the server.
type Option func(*server)

// WithConfig applies the login settings of cfg: Kore ID (if configured) and
// whether password login stays enabled.
func WithConfig(cfg config.Config) Option {
	return func(s *server) {
		s.passwordLogin = cfg.LocalLoginEnabled()
		if !cfg.OIDC.Enabled() {
			return
		}
		s.sso = &ssoState{
			p: oidc.New(oidc.Config{
				Issuer: cfg.OIDC.Issuer, ClientID: cfg.OIDC.ClientID, ClientSecret: cfg.OIDC.ClientSecret,
				RedirectURL: cfg.PublicURL + callbackPath,
			}),
			publicURL: cfg.PublicURL, linkByEmail: cfg.OIDC.LinkByEmailEnabled(), autoProvision: cfg.OIDC.AutoProvisionEnabled(),
			ownerEmail: cfg.OIDC.OwnerEmail,
			apps:       appURLs(cfg.PublicURL, cfg.OIDC.Apps),
			limit:      auth.NewLimiter(30, 15*time.Minute),
		}
	}
}

// WithProvider is WithConfig with a ready provider (tests). The optional
// ownerEmail names the first administrator on a fresh install.
func WithProvider(p *oidc.Provider, publicURL string, linkByEmail, autoProvision, passwordLogin bool, ownerEmail ...string) Option {
	return func(s *server) {
		owner := ""
		if len(ownerEmail) > 0 {
			owner = ownerEmail[0]
		}
		s.passwordLogin = passwordLogin
		s.sso = &ssoState{p: p, publicURL: publicURL, linkByEmail: linkByEmail, autoProvision: autoProvision,
			ownerEmail: owner,
			limit:      auth.NewLimiter(30, 15*time.Minute)}
	}
}

func (s *server) registerSSO(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/config", s.authConfig)
	if s.sso != nil {
		mux.HandleFunc("GET /api/auth/oidc/login", s.oidcLogin)
		mux.HandleFunc("GET "+callbackPath, s.oidcCallback)
		mux.HandleFunc("POST "+backchannelPath, s.backchannelLogout)
	}
}

// appURLs is the app switcher map: the configured apps plus Kore itself.
func appURLs(publicURL string, apps map[string]string) map[string]string {
	out := map[string]string{"kore": publicURL}
	for k, v := range apps {
		out[k] = v
	}
	return out
}

type authConfigJSON struct {
	LocalLogin bool `json:"local_login"`
	OIDC       bool `json:"oidc"`
	// FirstUserSSO is true when Kore ID is configured with an owner email:
	// the first sign-in with that verified email becomes the administrator.
	FirstUserSSO bool `json:"first_user_sso"`
	// Issuer is Kore ID's base URL (its account page is Issuer + "/account").
	Issuer string `json:"issuer,omitempty"`
	// Apps are the Kore apps' base URLs for the app switcher.
	Apps map[string]string `json:"apps,omitempty"`
}

func (s *server) authConfig(w http.ResponseWriter, r *http.Request) {
	out := authConfigJSON{LocalLogin: s.passwordLogin, OIDC: s.sso != nil,
		FirstUserSSO: s.sso != nil && s.sso.ownerEmail != ""}
	if s.sso != nil {
		out.Issuer = s.sso.p.Issuer()
		out.Apps = s.sso.apps
		if out.Apps == nil {
			out.Apps = appURLs(s.sso.publicURL, nil)
		}
	}
	writeJSON(w, 200, out)
}

// safeNext keeps only same-origin relative paths (mirrors web/lib/safe-next.ts).
func safeNext(raw string) string {
	if !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") {
		return defaultNext
	}
	for _, c := range raw {
		if c == '\\' || c <= 0x20 || c == 0x7f {
			return defaultNext
		}
	}
	u, err := url.Parse(raw)
	if err != nil || u.IsAbs() || u.Host != "" || u.Path == "/login" || strings.HasPrefix(u.Path, "/login/") {
		return defaultNext
	}
	return raw
}

func (s *server) ssoSecure() bool { return strings.HasPrefix(s.sso.publicURL, "https://") }

func (s *server) flowCookie(value string, maxAge int) *http.Cookie {
	return &http.Cookie{Name: flowCookie, Value: value, Path: "/api/auth/oidc", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: s.ssoSecure(), MaxAge: maxAge}
}

func (s *server) ssoFail(w http.ResponseWriter, r *http.Request, linking bool, code string) {
	dest := "/login?error=" + code
	if linking {
		dest = "/account?sso=" + code
	}
	http.Redirect(w, r, s.sso.publicURL+dest, http.StatusFound)
}

// oidcLogin starts the authorization-code flow (?next=/path, ?link=1 to bind
// the signed-in user's account to a Kore ID account).
func (s *server) oidcLogin(w http.ResponseWriter, r *http.Request) {
	linking := r.URL.Query().Get("link") == "1"
	if !s.sso.limit.Attempt("sso|" + limitKey(r)) {
		w.Header().Set("Retry-After", "900")
		errJSON(w, 429, "too_many_attempts")
		return
	}
	f := auth.Flow{Next: safeNext(r.URL.Query().Get("next"))}
	if linking {
		me, ok := auth.FromContext(r.Context())
		if !ok {
			http.Redirect(w, r, s.sso.publicURL+"/login", http.StatusFound)
			return
		}
		f.LinkUserID = me.ID
		f.Next = "/account"
	}
	flow := oidc.NewFlow()
	f.Nonce, f.Verifier = flow.Nonce, flow.Verifier
	extra := url.Values{}
	if linking {
		extra.Set("prompt", "login") // prove you control the Kore ID account you are linking
	}
	dest, err := s.sso.p.AuthURL(r.Context(), flow, extra)
	if err != nil {
		log.Printf("sso: %v", err)
		s.ssoFail(w, r, linking, "sso_unavailable")
		return
	}
	if err := auth.SaveFlow(r.Context(), s.db, flow.State, f, flowTTL); err != nil {
		log.Printf("sso: save flow: %v", err)
		s.ssoFail(w, r, linking, "sso_failed")
		return
	}
	// The cookie ties the callback to this browser (login-CSRF defence).
	http.SetCookie(w, s.flowCookie(flow.State, int(flowTTL.Seconds())))
	http.Redirect(w, r, dest, http.StatusFound)
}

func (s *server) oidcCallback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	state := q.Get("state")
	http.SetCookie(w, s.flowCookie("", -1))
	c, err := r.Cookie(flowCookie)
	if state == "" || err != nil || subtle.ConstantTimeCompare([]byte(c.Value), []byte(state)) != 1 {
		s.ssoFail(w, r, false, "sso_failed")
		return
	}
	flow, ok, err := auth.TakeFlow(r.Context(), s.db, state)
	if err != nil || !ok {
		s.ssoFail(w, r, false, "sso_failed")
		return
	}
	linking := flow.LinkUserID != ""
	fail := func(code string) { s.ssoFail(w, r, linking, code) }
	if iss := q.Get("iss"); iss != "" && iss != s.sso.p.Issuer() {
		fail("sso_failed")
		return
	}
	if e := q.Get("error"); e != "" {
		fail("sso_denied")
		return
	}
	code := q.Get("code")
	if code == "" {
		fail("sso_failed")
		return
	}
	tok, err := s.sso.p.Exchange(r.Context(), code, flow.Verifier)
	if err != nil {
		log.Printf("sso: code exchange: %v", err)
		fail("sso_failed")
		return
	}
	claims, err := s.sso.p.Verify(r.Context(), tok.IDToken)
	if err != nil || claims.Nonce == "" || subtle.ConstantTimeCompare([]byte(claims.Nonce), []byte(flow.Nonce)) != 1 {
		log.Printf("sso: id token: %v", err)
		fail("sso_failed")
		return
	}
	if linking {
		me, ok := auth.FromContext(r.Context())
		if !ok || me.ID != flow.LinkUserID {
			fail("sso_failed")
			return
		}
	}
	u, code2 := s.resolveSSOUser(r.Context(), claims, flow.LinkUserID)
	if code2 != "" {
		fail(code2)
		return
	}
	if linking {
		http.Redirect(w, r, s.sso.publicURL+"/account?sso=linked", http.StatusFound)
		return
	}
	sess, err := auth.NewSSOSession(r.Context(), s.db, u.ID, sessionTTL, tok.IDToken, tok.RefreshToken, claims.Sid)
	if err != nil {
		fail("sso_failed")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: auth.CookieName, Value: sess, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: auth.IsHTTPS(r) || s.ssoSecure(),
		Expires: time.Now().Add(sessionTTL),
	})
	http.Redirect(w, r, s.sso.publicURL+flow.Next, http.StatusFound)
}

// resolveSSOUser maps verified claims to a local user: by sub; else (link
// flow) bind to the signed-in user; else by email when link_by_email is on
// and the provider says email_verified; else provision. The second result is an error code for the login page.
func (s *server) resolveSSOUser(ctx context.Context, c oidc.Claims, linkUserID string) (users.User, string) {
	if linkUserID != "" {
		switch err := auth.LinkSub(ctx, s.db, linkUserID, c.Sub); {
		case err == nil:
			return users.User{ID: linkUserID}, ""
		case errors.Is(err, auth.ErrSubTaken):
			return users.User{}, "sso_sub_taken"
		case errors.Is(err, auth.ErrAlreadyLinked):
			return users.User{}, "sso_already_linked"
		default:
			log.Printf("sso: link: %v", err)
			return users.User{}, "sso_failed"
		}
	}
	u, err := auth.UserBySub(ctx, s.db, c.Sub)
	if err == nil {
		return u, ""
	}
	if !errors.Is(err, users.ErrNotFound) {
		log.Printf("sso: lookup: %v", err)
		return users.User{}, "sso_failed"
	}
	if c.Email == "" {
		return users.User{}, "sso_no_email"
	}
	existing, sub, err := auth.UserByEmailWithSub(ctx, s.db, c.Email)
	switch {
	case err == nil:
		// The email belongs to a local account that is not (yet) linked to this subject.
		if sub != "" || !s.sso.linkByEmail || !c.EmailVerified {
			return users.User{}, "sso_email_in_use"
		}
		if err := auth.LinkSub(ctx, s.db, existing.ID, c.Sub); err != nil {
			return users.User{}, "sso_email_in_use"
		}
		return existing, ""
	case !errors.Is(err, users.ErrNotFound):
		log.Printf("sso: lookup email: %v", err)
		return users.User{}, "sso_failed"
	}
	if !s.sso.autoProvision {
		return users.User{}, "sso_not_provisioned"
	}
	role := "user"
	if n, err := users.Count(ctx, s.db); err != nil {
		log.Printf("sso: count users: %v", err)
		return users.User{}, "sso_failed"
	} else if n == 0 {
		// Never let whoever signs in first on a fresh install become the
		// administrator by accident: only the explicitly configured owner
		// email, with a verified claim, creates the first admin account.
		if s.sso.ownerEmail == "" || !c.EmailVerified ||
			!strings.EqualFold(strings.TrimSpace(c.Email), s.sso.ownerEmail) {
			return users.User{}, "sso_no_admin"
		}
		role = "admin"
	}
	u, err = auth.ProvisionSSO(ctx, s.db, c.Sub, c.Email, role, settings.DefaultQuotaBytes(ctx, s.db))
	if err != nil {
		// A parallel first login for the same subject may have won.
		if u2, err2 := auth.UserBySub(ctx, s.db, c.Sub); err2 == nil {
			return u2, ""
		}
		if errors.Is(err, users.ErrExists) {
			return users.User{}, "sso_email_in_use"
		}
		log.Printf("sso: provision: %v", err)
		return users.User{}, "sso_failed"
	}
	return u, ""
}

// sessionMiddleware loads the user from the session cookie (an SSO session
// must also still be good with Kore ID) or, failing that, from a Kore ID
// access token in "Authorization: Bearer". Handlers still enforce auth with
// RequireUser/RequireAdmin.
func (s *server) sessionMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie(auth.CookieName); err == nil && c.Value != "" {
			if u, err := auth.UserForToken(r.Context(), s.db, c.Value); err == nil && s.sessionStillValid(r.Context(), c.Value) {
				r = r.WithContext(auth.WithUser(r.Context(), u))
			}
		} else if s.sso != nil {
			if u, ok := s.bearerUser(r); ok {
				r = r.WithContext(auth.WithUser(r.Context(), u))
			}
		}
		next.ServeHTTP(w, r)
	})
}

// bearerUser authenticates a Kore ID access token (audience = our client id,
// header typ at+jwt). ID tokens (typ JWT) are refused.
func (s *server) bearerUser(r *http.Request) (users.User, bool) {
	h := r.Header.Get("Authorization")
	if len(h) < 8 || !strings.EqualFold(h[:7], "bearer ") {
		return users.User{}, false
	}
	c, err := s.sso.p.VerifyAccessToken(r.Context(), strings.TrimSpace(h[7:]))
	if err != nil {
		return users.User{}, false
	}
	u, code := s.resolveSSOUser(r.Context(), c, "")
	if code != "" {
		return users.User{}, false
	}
	return u, true
}

// sessionStillValid periodically redeems the session's refresh token, which
// fails once the user signed out everywhere at Kore ID or the account is
// disabled there. Transient provider errors keep the session.
func (s *server) sessionStillValid(ctx context.Context, tok string) bool {
	if s.sso == nil {
		return true
	}
	ss, err := auth.SSOSessionFor(ctx, s.db, tok)
	if err != nil || ss.RefreshToken == "" || time.Since(ss.CheckedAt) < refreshEvery {
		return true
	}
	s.sso.refreshMu.Lock()
	defer s.sso.refreshMu.Unlock()
	if ss, err = auth.SSOSessionFor(ctx, s.db, tok); err != nil || ss.RefreshToken == "" || time.Since(ss.CheckedAt) < refreshEvery {
		return true // another request refreshed it while we waited (or the session is gone)
	}
	// Not tied to the request: abandoning the call after the provider rotated
	// the token would lose the new one and the next refresh would look like theft.
	rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	t, err := s.sso.p.Refresh(rctx, ss.RefreshToken)
	switch {
	case errors.Is(err, oidc.ErrInvalidGrant):
		auth.DeleteSession(ctx, s.db, tok)
		return false
	case err != nil:
		log.Printf("sso: refresh: %v", err)
		auth.TouchSSOCheck(ctx, s.db, tok, time.Now().Add(refreshBackoff-refreshEvery))
		return true
	}
	rt := t.RefreshToken
	if rt == "" {
		rt = ss.RefreshToken
	}
	auth.SetSSOTokens(ctx, s.db, tok, t.IDToken, rt, time.Now())
	return true
}

// ssoLogoutURL is the Kore ID end-session URL for an SSO session ("" otherwise).
func (s *server) ssoLogoutURL(ctx context.Context, tok string) string {
	if s.sso == nil {
		return ""
	}
	ss, err := auth.SSOSessionFor(ctx, s.db, tok)
	if err != nil || ss.IDToken == "" {
		return ""
	}
	return s.sso.p.EndSessionURL(ctx, ss.IDToken, s.sso.publicURL+"/login", "")
}

// backchannelLogout implements OIDC Back-Channel Logout 1.0: Kore ID POSTs a
// signed logout_token when a Kore ID session ends, and every local session
// created from it (same sid) is deleted; a token without sid ends all sessions
// of the user linked to its sub. It is server-to-server: no cookies, no
// session middleware (see handler).
func (s *server) backchannelLogout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := r.ParseForm(); err != nil {
		errJSON(w, 400, "invalid_request")
		return
	}
	lc, err := s.sso.p.VerifyLogoutToken(r.Context(), r.PostForm.Get("logout_token"))
	if err != nil {
		log.Printf("sso: back-channel logout: %v", err)
		errJSON(w, 400, "invalid_request")
		return
	}
	var n int64
	if lc.Sid != "" {
		n, err = auth.DeleteSessionsBySID(r.Context(), s.db, lc.Sid)
	} else {
		n, err = auth.DeleteSessionsBySub(r.Context(), s.db, lc.Sub)
	}
	if err != nil {
		log.Printf("sso: back-channel logout: %v", err)
		s.sso.p.ForgetLogoutJTI(lc.Jti) // let the provider's retry through
		errJSON(w, 500, "internal")
		return
	}
	if n > 0 {
		log.Printf("sso: back-channel logout ended %d session(s)", n)
	}
	w.WriteHeader(200)
}
