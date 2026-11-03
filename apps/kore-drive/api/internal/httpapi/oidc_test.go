package httpapi

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/qarasky/kore/api/internal/auth"
	"github.com/qarasky/kore/api/internal/config"
	"github.com/qarasky/kore/api/internal/oidc"
	"github.com/qarasky/kore/api/internal/store"
	"github.com/qarasky/kore/api/internal/users"
)

const pubURL = "https://kore.test"

var b64 = base64.RawURLEncoding

// fakeID is a minimal Kore ID: discovery, JWKS and a token endpoint whose
// answers the test scripts.
type fakeID struct {
	srv  *httptest.Server
	priv ed25519.PrivateKey
	mu   sync.Mutex
	// tokenFn answers /token; default returns an id token for sub/email with the request's nonce.
	nonce         string
	sub, email    string
	sid           string // "sid" claim of id tokens ("" = none)
	emailVerified bool
	refreshErr    string // "invalid_grant" or "boom": make refresh fail
	refreshes     int
	tokenReqs     []url.Values
}

func newFakeID(t *testing.T) *fakeID {
	t.Helper()
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	f := &fakeID{priv: priv, sub: "11111111-1111-4111-8111-111111111111", email: "new@kore.test", sid: "sid-1"}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"issuer": f.srv.URL, "authorization_endpoint": f.srv.URL + "/authorize",
			"token_endpoint": f.srv.URL + "/token", "jwks_uri": f.srv.URL + "/jwks", "end_session_endpoint": f.srv.URL + "/logout",
			"code_challenge_methods_supported": []string{"S256"}})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{"kty": "OKP", "crv": "Ed25519", "kid": "k", "use": "sig", "x": b64.EncodeToString(pub)}}})
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		f.mu.Lock()
		defer f.mu.Unlock()
		f.tokenReqs = append(f.tokenReqs, r.Form)
		w.Header().Set("Content-Type", "application/json")
		if r.Form.Get("grant_type") == "refresh_token" {
			f.refreshes++
			switch f.refreshErr {
			case "invalid_grant":
				w.WriteHeader(400)
				w.Write([]byte(`{"error":"invalid_grant"}`))
				return
			case "boom":
				w.WriteHeader(503)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"refresh_token": "rt-next", "id_token": f.token(map[string]any{})})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"id_token": f.token(map[string]any{"nonce": f.nonce}), "refresh_token": "rt-1", "access_token": f.access(map[string]any{})})
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

// token is an id token (typ JWT) with the given claims overridden.
func (f *fakeID) token(over map[string]any) string {
	c := map[string]any{"iss": f.srv.URL, "aud": "kore", "sub": f.sub, "email": f.email, "email_verified": f.emailVerified,
		"iat": time.Now().Unix(), "exp": time.Now().Add(10 * time.Minute).Unix()}
	if f.sid != "" {
		c["sid"] = f.sid
	}
	return f.signTyp("JWT", c, over)
}

// access is an access token (typ at+jwt).
func (f *fakeID) access(over map[string]any) string {
	c := map[string]any{"iss": f.srv.URL, "aud": "kore", "client_id": "kore", "sub": f.sub, "email": f.email, "email_verified": f.emailVerified,
		"scope": "openid profile email", "iat": time.Now().Unix(), "exp": time.Now().Add(10 * time.Minute).Unix(), "jti": "at-" + b64.EncodeToString([]byte(time.Now().String()))}
	return f.signTyp("at+jwt", c, over)
}

// logout is a back-channel logout token (typ logout+jwt) for f.sub / f.sid.
func (f *fakeID) logout(jti string, over map[string]any) string {
	c := map[string]any{"iss": f.srv.URL, "aud": "kore", "sub": f.sub, "sid": f.sid, "jti": jti,
		"iat": time.Now().Unix(), "exp": time.Now().Add(2 * time.Minute).Unix(),
		"events": map[string]any{"http://schemas.openid.net/event/backchannel-logout": map[string]any{}}}
	return f.signTyp("logout+jwt", c, over)
}

// signTyp signs base claims with over applied (a nil value deletes the claim).
func (f *fakeID) signTyp(typ string, c, over map[string]any) string {
	for k, v := range over {
		if v == nil {
			delete(c, k)
			continue
		}
		c[k] = v
	}
	h, _ := json.Marshal(map[string]string{"alg": "EdDSA", "kid": "k", "typ": typ})
	cb, _ := json.Marshal(c)
	in := b64.EncodeToString(h) + "." + b64.EncodeToString(cb)
	return in + "." + b64.EncodeToString(ed25519.Sign(f.priv, []byte(in)))
}

type ssoEnv struct {
	h   http.Handler
	db  *sql.DB
	idp *fakeID
}

func setupSSO(t *testing.T, linkByEmail, autoProvision bool) *ssoEnv {
	t.Helper()
	e := newSSOEnv(t, linkByEmail, autoProvision, "")
	if _, err := users.Create(context.Background(), e.db, "local@kore.test", "admin", 7); err != nil {
		t.Fatal(err)
	}
	return e
}

// setupSSOEmpty is setupSSO without the seeded local admin: a fresh install.
func setupSSOEmpty(t *testing.T, ownerEmail string) *ssoEnv {
	t.Helper()
	return newSSOEnv(t, false, true, ownerEmail)
}

func newSSOEnv(t *testing.T, linkByEmail, autoProvision bool, ownerEmail string) *ssoEnv {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	idp := newFakeID(t)
	p := oidc.New(oidc.Config{Issuer: idp.srv.URL, ClientID: "kore", ClientSecret: "secret", RedirectURL: pubURL + callbackPath})
	return &ssoEnv{h: New(db, t.TempDir(), WithProvider(p, pubURL, linkByEmail, autoProvision, ownerEmail)), db: db, idp: idp}
}

func (e *ssoEnv) do(method, target string, hdr map[string]string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, nil)
	req.RemoteAddr = "1.2.3.4:5555"
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	return rec
}

func cookie(rec *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == name && c.MaxAge >= 0 && c.Value != "" {
			return c
		}
	}
	return nil
}

// sessionCookie signs an existing local account in directly (SSO is the only
// login path, but tests need a cookie without running a provider).
func sessionCookie(t *testing.T, db *sql.DB, email string) *http.Cookie {
	t.Helper()
	u, err := users.GetByEmail(context.Background(), db, email)
	if err != nil {
		t.Fatal(err)
	}
	tok, err := auth.NewSession(context.Background(), db, u.ID, 3600e9)
	if err != nil {
		t.Fatal(err)
	}
	return &http.Cookie{Name: auth.CookieName, Value: tok}
}

// startLogin runs /api/auth/oidc/login and returns the provider URL query and the flow cookie.
func (e *ssoEnv) startLogin(t *testing.T, target string, cookies ...*http.Cookie) (url.Values, *http.Cookie) {
	t.Helper()
	rec := e.do("GET", target, nil, cookies...)
	if rec.Code != 302 {
		t.Fatalf("login start: %d %s", rec.Code, rec.Body)
	}
	loc, _ := url.Parse(rec.Header().Get("Location"))
	if !strings.HasPrefix(loc.String(), e.idp.srv.URL+"/authorize") {
		t.Fatalf("redirected to %s", loc)
	}
	fc := cookie(rec, flowCookie)
	if fc == nil || !fc.HttpOnly || !fc.Secure {
		t.Fatalf("flow cookie %+v", fc)
	}
	return loc.Query(), fc
}

func (e *ssoEnv) callback(q url.Values, code string, fc *http.Cookie, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	cb := url.Values{"code": {code}, "state": {q.Get("state")}, "iss": {e.idp.srv.URL}}
	cs := cookies
	if fc != nil {
		cs = append([]*http.Cookie{fc}, cookies...)
	}
	return e.do("GET", callbackPath+"?"+cb.Encode(), nil, cs...)
}

// signIn runs a whole login flow with the fake provider's current identity.
func (e *ssoEnv) signIn(t *testing.T) *httptest.ResponseRecorder {
	t.Helper()
	q, fc := e.startLogin(t, "/api/auth/oidc/login")
	e.idp.nonce = q.Get("nonce")
	return e.callback(q, "code", fc)
}

func TestSSOFullLoginProvisionsAndCreatesSession(t *testing.T) {
	e := setupSSO(t, false, true)
	q, fc := e.startLogin(t, "/api/auth/oidc/login?next=/trash")
	if q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "" || q.Get("nonce") == "" ||
		q.Get("client_id") != "kore" || q.Get("redirect_uri") != pubURL+callbackPath {
		t.Fatalf("authorization request %v", q)
	}
	e.idp.nonce = q.Get("nonce")
	rec := e.callback(q, "code", fc)
	if rec.Code != 302 || rec.Header().Get("Location") != pubURL+"/trash" {
		t.Fatalf("callback: %d %s", rec.Code, rec.Header().Get("Location"))
	}
	// The code was redeemed with the PKCE verifier matching the challenge, and the secret.
	req := e.idp.tokenReqs[0]
	if oidc.ChallengeS256(req.Get("code_verifier")) != q.Get("code_challenge") || req.Get("client_secret") != "secret" || req.Get("redirect_uri") != pubURL+callbackPath {
		t.Fatalf("token request %v", req)
	}
	sess := cookie(rec, auth.CookieName)
	if sess == nil || !sess.HttpOnly || !sess.Secure {
		t.Fatalf("session cookie %+v", sess)
	}
	me := e.do("GET", "/api/auth/me", nil, sess)
	var u users.User
	json.Unmarshal(me.Body.Bytes(), &u)
	if me.Code != 200 || u.Email != "new@kore.test" || u.Role != "user" {
		t.Fatalf("me: %d %s", me.Code, me.Body)
	}
	// Same subject signs in again: same local account, no duplicate.
	q2, fc2 := e.startLogin(t, "/api/auth/oidc/login")
	e.idp.nonce = q2.Get("nonce")
	rec2 := e.callback(q2, "code", fc2)
	u2, _ := auth.UserForToken(context.Background(), e.db, cookie(rec2, auth.CookieName).Value)
	if u2.ID != u.ID {
		t.Fatalf("second login made a new user: %s vs %s", u2.ID, u.ID)
	}
	if n, _ := users.Count(context.Background(), e.db); n != 2 {
		t.Fatalf("%d users", n)
	}
	// Password login no longer exists at all.
	if rec := e.do("POST", "/api/auth/login", nil); rec.Code != 404 {
		t.Fatalf("password login endpoint: %d", rec.Code)
	}
}

func TestSSOCallbackRejects(t *testing.T) {
	e := setupSSO(t, false, true)
	good := func() (url.Values, *http.Cookie) {
		q, fc := e.startLogin(t, "/api/auth/oidc/login")
		e.idp.nonce = q.Get("nonce")
		return q, fc
	}
	expectFail := func(name string, rec *httptest.ResponseRecorder, code string) {
		t.Helper()
		if rec.Code != 302 || rec.Header().Get("Location") != pubURL+"/login?error="+code || cookie(rec, auth.CookieName) != nil {
			t.Errorf("%s: %d %q session=%v", name, rec.Code, rec.Header().Get("Location"), cookie(rec, auth.CookieName))
		}
	}
	q, _ := good()
	expectFail("no flow cookie (login CSRF)", e.callback(q, "c", nil), "sso_failed")
	q, fc := good()
	other := &http.Cookie{Name: flowCookie, Value: "attacker-state"}
	expectFail("cookie/state mismatch", e.callback(q, "c", other), "sso_failed")
	_ = fc
	expectFail("unknown state", e.callback(url.Values{"state": {"nope"}}, "c", &http.Cookie{Name: flowCookie, Value: "nope"}), "sso_failed")
	q, fc = good()
	e.idp.nonce = "wrong-nonce"
	expectFail("nonce mismatch", e.callback(q, "c", fc), "sso_failed")
	q, fc = good()
	if rec := e.callback(q, "c", fc); rec.Code != 302 || cookie(rec, auth.CookieName) == nil {
		t.Fatal("control: valid login failed")
	}
	// State is single use.
	expectFail("replayed state", e.callback(q, "c", fc), "sso_failed")
	q, fc = good()
	rec := e.do("GET", callbackPath+"?"+url.Values{"error": {"access_denied"}, "state": {q.Get("state")}}.Encode(), nil, fc)
	expectFail("provider error", rec, "sso_denied")
	q, fc = good()
	rec = e.do("GET", callbackPath+"?"+url.Values{"code": {"c"}, "state": {q.Get("state")}, "iss": {"https://evil"}}.Encode(), nil, fc)
	expectFail("wrong iss", rec, "sso_failed")
}

func TestSSOEmailCollision(t *testing.T) {
	// With link_by_email on, an unverified email must not take over a local
	// account; with it off, not even a verified one.
	for _, tc := range []struct {
		name             string
		linkByEmail, ver bool
	}{{"unverified", true, false}, {"flag off", false, true}} {
		e := setupSSO(t, tc.linkByEmail, true)
		e.idp.email, e.idp.emailVerified = "local@kore.test", tc.ver
		q, fc := e.startLogin(t, "/api/auth/oidc/login")
		e.idp.nonce = q.Get("nonce")
		rec := e.callback(q, "c", fc)
		if rec.Header().Get("Location") != pubURL+"/login?error=sso_email_in_use" || cookie(rec, auth.CookieName) != nil {
			t.Fatalf("%s: %d %s", tc.name, rec.Code, rec.Header().Get("Location"))
		}
		if _, err := auth.UserBySub(context.Background(), e.db, e.idp.sub); err == nil {
			t.Fatalf("%s: subject got linked", tc.name)
		}
	}
}

func TestSSOLinkByVerifiedEmailIsDefault(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := users.Create(context.Background(), db, "local@kore.test", "admin", 7); err != nil {
		t.Fatal(err)
	}
	idp := newFakeID(t)
	var cfg config.Config // link_by_email left unset: the default applies
	cfg.PublicURL, cfg.OIDC.Issuer, cfg.OIDC.ClientID = pubURL, idp.srv.URL, "kore"
	if !cfg.OIDC.LinkByEmailEnabled() {
		t.Fatal("link_by_email must default to on")
	}
	e := &ssoEnv{h: New(db, t.TempDir(), WithConfig(cfg)), db: db, idp: idp}
	idp.email, idp.emailVerified = "LOCAL@kore.test", true
	q, fc := e.startLogin(t, "/api/auth/oidc/login")
	idp.nonce = q.Get("nonce")
	sess := cookie(e.callback(q, "c", fc), auth.CookieName)
	if sess == nil {
		t.Fatal("verified email did not link by default")
	}
	u, _ := auth.UserForToken(context.Background(), db, sess.Value)
	if u.Role != "admin" || u.QuotaBytes != 7 {
		t.Fatalf("expected the existing admin account, got %+v", u)
	}
}

func TestSSOLinkByEmailWhenEnabled(t *testing.T) {
	e := setupSSO(t, true, true)
	e.idp.email, e.idp.emailVerified = "local@kore.test", true
	q, fc := e.startLogin(t, "/api/auth/oidc/login")
	e.idp.nonce = q.Get("nonce")
	rec := e.callback(q, "c", fc)
	sess := cookie(rec, auth.CookieName)
	if sess == nil {
		t.Fatalf("no session: %s", rec.Header().Get("Location"))
	}
	u, _ := auth.UserForToken(context.Background(), e.db, sess.Value)
	if u.Role != "admin" || u.Email != "local@kore.test" || u.QuotaBytes != 7 {
		t.Fatalf("expected the existing admin account, got %+v", u)
	}
	// A different subject with that email can no longer take it over.
	e.idp.sub = "22222222-2222-4222-8222-222222222222"
	q, fc = e.startLogin(t, "/api/auth/oidc/login")
	e.idp.nonce = q.Get("nonce")
	if rec := e.callback(q, "c", fc); !strings.HasSuffix(rec.Header().Get("Location"), "sso_email_in_use") {
		t.Fatalf("second subject: %s", rec.Header().Get("Location"))
	}
}

func TestSSONoAutoProvision(t *testing.T) {
	e := setupSSO(t, false, false)
	q, fc := e.startLogin(t, "/api/auth/oidc/login")
	e.idp.nonce = q.Get("nonce")
	if rec := e.callback(q, "c", fc); !strings.HasSuffix(rec.Header().Get("Location"), "sso_not_provisioned") {
		t.Fatalf("%s", rec.Header().Get("Location"))
	}
}

func TestSSOLinkFlowFromSignedInAccount(t *testing.T) {
	e := setupSSO(t, false, true)
	local := sessionCookie(t, e.db, "local@kore.test")
	// Anonymous link attempts go to the login page.
	if r := e.do("GET", "/api/auth/oidc/login?link=1", nil); r.Header().Get("Location") != pubURL+"/login" {
		t.Fatalf("anonymous link: %s", r.Header().Get("Location"))
	}
	q, fc := e.startLogin(t, "/api/auth/oidc/login?link=1", local)
	if q.Get("prompt") != "login" {
		t.Fatalf("link must force re-authentication: %v", q)
	}
	e.idp.nonce = q.Get("nonce")
	r := e.callback(q, "c", fc, local)
	if r.Header().Get("Location") != pubURL+"/account?sso=linked" {
		t.Fatalf("%s", r.Header().Get("Location"))
	}
	// Now SSO login lands on the original admin account.
	q, fc = e.startLogin(t, "/api/auth/oidc/login")
	e.idp.nonce = q.Get("nonce")
	r = e.callback(q, "c", fc)
	u, _ := auth.UserForToken(context.Background(), e.db, cookie(r, auth.CookieName).Value)
	if u.Role != "admin" {
		t.Fatalf("%+v", u)
	}
	// The callback of a link flow is useless in another browser session.
	q, fc = e.startLogin(t, "/api/auth/oidc/login?link=1", local)
	e.idp.nonce = q.Get("nonce")
	if r := e.callback(q, "c", fc); !strings.Contains(r.Header().Get("Location"), "sso=sso_failed") {
		t.Fatalf("link callback without the session: %s", r.Header().Get("Location"))
	}
}

func TestAuthConfigWithoutLocalLogin(t *testing.T) {
	e := setupSSO(t, false, true)
	var cfg struct {
		OIDC   bool              `json:"oidc"`
		Issuer string            `json:"issuer"`
		Apps   map[string]string `json:"apps"`
	}
	if err := json.Unmarshal(e.do("GET", "/api/auth/config", nil).Body.Bytes(), &cfg); err != nil {
		t.Fatal(err)
	}
	if !cfg.OIDC || cfg.Issuer == "" || cfg.Apps["kore"] == "" {
		t.Fatalf("%+v", cfg)
	}
}

func TestOIDCOwnerEmailCreatesTheFirstAdministrator(t *testing.T) {
	t.Run("owner email, verified, fresh database", func(t *testing.T) {
		e := setupSSOEmpty(t, "New@Kore.Test")
		e.idp.emailVerified = true
		rec := e.signIn(t)
		if rec.Code != 302 || rec.Header().Get("Location") != pubURL+defaultNext {
			t.Fatalf("callback: %d %s", rec.Code, rec.Header().Get("Location"))
		}
		var email, role string
		if err := e.db.QueryRow(`SELECT email,role FROM users`).Scan(&email, &role); err != nil {
			t.Fatal(err)
		}
		if email != "new@kore.test" || role != "admin" {
			t.Fatalf("user: %q %q", email, role)
		}
	})
	t.Run("a different email is refused", func(t *testing.T) {
		e := setupSSOEmpty(t, "owner@example.com")
		e.idp.emailVerified = true
		if rec := e.signIn(t); !strings.HasSuffix(rec.Header().Get("Location"), "/login?error=sso_no_admin") {
			t.Fatalf("redirected to %q", rec.Header().Get("Location"))
		}
		var n int
		e.db.QueryRow(`SELECT count(*) FROM users`).Scan(&n)
		if n != 0 {
			t.Fatalf("%d users", n)
		}
	})
	t.Run("the owner email must be verified", func(t *testing.T) {
		e := setupSSOEmpty(t, "new@kore.test")
		e.idp.emailVerified = false
		if rec := e.signIn(t); !strings.HasSuffix(rec.Header().Get("Location"), "/login?error=sso_no_admin") {
			t.Fatalf("redirected to %q", rec.Header().Get("Location"))
		}
		var n int
		e.db.QueryRow(`SELECT count(*) FROM users`).Scan(&n)
		if n != 0 {
			t.Fatalf("%d users", n)
		}
	})
	t.Run("no promotion once an account exists", func(t *testing.T) {
		e := setupSSOEmpty(t, "new@kore.test")
		if _, err := users.Create(context.Background(), e.db, "local@kore.test", "admin", 7); err != nil {
			t.Fatal(err)
		}
		e.idp.emailVerified = true
		e.signIn(t)
		var role string
		e.db.QueryRow(`SELECT role FROM users WHERE email='new@kore.test'`).Scan(&role)
		if role != "user" {
			t.Fatalf("role %q", role)
		}
	})
}

func TestAuthConfigFirstUserSSO(t *testing.T) {
	for name, owner := range map[string]string{"unset": "", "set": "owner@example.com"} {
		e := newSSOEnv(t, false, true, owner)
		var cfg struct {
			FirstUserSSO bool `json:"first_user_sso"`
		}
		if err := json.Unmarshal(e.do("GET", "/api/auth/config", nil).Body.Bytes(), &cfg); err != nil {
			t.Fatal(err)
		}
		if cfg.FirstUserSSO != (owner != "") {
			t.Errorf("%s: first_user_sso = %v", name, cfg.FirstUserSSO)
		}
	}
}

func TestAuthConfigDefaultWithoutSSO(t *testing.T) {
	h := setup(t)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/auth/config", nil))
	if strings.TrimSpace(rec.Body.String()) != `{"oidc":false,"first_user_sso":false}` {
		t.Fatal(rec.Body.String())
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/auth/oidc/login", nil))
	if rec.Code != 404 {
		t.Fatalf("oidc routes must not exist when unconfigured: %d", rec.Code)
	}
}

func TestSSOBearerToken(t *testing.T) {
	e := setupSSO(t, false, true)
	bearer := func(tok string) int {
		return e.do("GET", "/api/me/usage", map[string]string{"Authorization": "Bearer " + tok}).Code
	}
	access := e.idp.access(map[string]any{})
	if c := bearer(access); c != 200 {
		t.Fatalf("access token: %d", c)
	}
	if c := bearer(e.idp.signTyp("application/at+jwt", map[string]any{"iss": e.idp.srv.URL, "aud": "kore", "sub": e.idp.sub,
		"exp": time.Now().Add(time.Minute).Unix()}, nil)); c != 200 {
		t.Fatalf("application/at+jwt: %d", c)
	}
	if c := bearer(e.idp.access(map[string]any{"aud": "koremind"})); c != 401 {
		t.Fatalf("other app's token: %d", c)
	}
	if c := bearer(e.idp.token(map[string]any{})); c != 401 {
		t.Fatalf("id token (typ JWT) accepted as bearer: %d", c)
	}
	if c := bearer(e.idp.token(map[string]any{"scope": "openid"})); c != 401 {
		t.Fatalf("typ JWT with a scope claim accepted as bearer: %d", c)
	}
	if c := bearer(e.idp.signTyp("", map[string]any{"iss": e.idp.srv.URL, "aud": "kore", "sub": e.idp.sub, "scope": "openid",
		"exp": time.Now().Add(time.Minute).Unix()}, nil)); c != 401 {
		t.Fatalf("token without typ accepted as bearer: %d", c)
	}
	if c := bearer(e.idp.logout("j-bearer", nil)); c != 401 {
		t.Fatalf("logout token accepted as bearer: %d", c)
	}
	if c := bearer(e.idp.access(map[string]any{"exp": time.Now().Add(-time.Hour).Unix()})); c != 401 {
		t.Fatalf("expired: %d", c)
	}
	if c := bearer("junk"); c != 401 {
		t.Fatalf("junk: %d", c)
	}
	// Admin-only routes stay admin-only for provisioned users.
	if c := e.do("GET", "/api/admin/users", map[string]string{"Authorization": "Bearer " + access}).Code; c != 403 {
		t.Fatalf("admin route: %d", c)
	}
}

func ssoSession(t *testing.T, e *ssoEnv) *http.Cookie {
	t.Helper()
	q, fc := e.startLogin(t, "/api/auth/oidc/login")
	e.idp.nonce = q.Get("nonce")
	return cookie(e.callback(q, "c", fc), auth.CookieName)
}

func ageSession(t *testing.T, e *ssoEnv, c *http.Cookie) {
	t.Helper()
	if _, err := e.db.Exec(`UPDATE sessions SET checked_at=? WHERE token_hash=?`, time.Now().Add(-time.Hour).Unix(), auth.HashToken(c.Value)); err != nil {
		t.Fatal(err)
	}
}

func TestSSOSessionRefreshAndRevocation(t *testing.T) {
	e := setupSSO(t, false, true)
	sess := ssoSession(t, e)
	if e.do("GET", "/api/auth/me", nil, sess).Code != 200 {
		t.Fatal("fresh session rejected")
	}
	if e.idp.refreshes != 0 {
		t.Fatal("refreshed a session that was just checked")
	}
	ageSession(t, e, sess)
	if e.do("GET", "/api/auth/me", nil, sess).Code != 200 || e.idp.refreshes != 1 {
		t.Fatalf("refresh not redeemed (%d)", e.idp.refreshes)
	}
	ss, _ := auth.SSOSessionFor(context.Background(), e.db, sess.Value)
	if ss.RefreshToken != "rt-next" {
		t.Fatalf("rotated refresh token not stored: %q", ss.RefreshToken)
	}
	e.do("GET", "/api/auth/me", nil, sess)
	if e.idp.refreshes != 1 {
		t.Fatal("refreshed again within the interval")
	}
	// Provider outage keeps the session and backs off.
	ageSession(t, e, sess)
	e.idp.refreshErr = "boom"
	if e.do("GET", "/api/auth/me", nil, sess).Code != 200 {
		t.Fatal("transient provider error ended the session")
	}
	n := e.idp.refreshes
	e.do("GET", "/api/auth/me", nil, sess)
	if e.idp.refreshes != n {
		t.Fatal("no back-off after provider failure")
	}
	// Refresh token revoked at Kore ID (sign out everywhere): the session dies.
	ageSession(t, e, sess)
	e.idp.refreshErr = "invalid_grant"
	if c := e.do("GET", "/api/auth/me", nil, sess).Code; c != 401 {
		t.Fatalf("revoked session still valid: %d", c)
	}
	if e.do("GET", "/api/auth/me", nil, sess).Code != 401 {
		t.Fatal("session came back")
	}
}

func TestSSOParallelRequestsRefreshOnce(t *testing.T) {
	e := setupSSO(t, false, true)
	sess := ssoSession(t, e)
	ageSession(t, e, sess)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if c := e.do("GET", "/api/auth/me", nil, sess).Code; c != 200 {
				t.Errorf("status %d", c)
			}
		}()
	}
	wg.Wait()
	if e.idp.refreshes != 1 {
		t.Fatalf("%d refresh redemptions for one stale session (rotation would flag reuse)", e.idp.refreshes)
	}
}

func TestSSOLogoutRedirectsToEndSession(t *testing.T) {
	e := setupSSO(t, false, true)
	sess := ssoSession(t, e)
	rec := e.do("POST", "/api/auth/logout", nil, sess)
	if rec.Code != 200 {
		t.Fatalf("%d", rec.Code)
	}
	var out struct{ Redirect string }
	json.Unmarshal(rec.Body.Bytes(), &out)
	u, err := url.Parse(out.Redirect)
	if err != nil || u.Path != "/logout" || u.Query().Get("post_logout_redirect_uri") != pubURL+"/login" || strings.Count(u.Query().Get("id_token_hint"), ".") != 2 {
		t.Fatalf("redirect %q", out.Redirect)
	}
	if e.do("GET", "/api/auth/me", nil, sess).Code != 401 {
		t.Fatal("session survived logout")
	}
	// A plain session (no provider tokens) still logs out with 204.
	local := sessionCookie(t, e.db, "local@kore.test")
	if c := e.do("POST", "/api/auth/logout", nil, local).Code; c != 204 {
		t.Fatalf("local logout %d", c)
	}
}

func TestSafeNext(t *testing.T) {
	for in, want := range map[string]string{
		"/trash": "/trash", "/files/a?b=1": "/files/a?b=1", "": "/files", "//evil.com": "/files", "https://evil.com": "/files",
		"/\\evil.com": "/files", "/a b": "/files", "/login": "/files", "/login/x": "/files", "/\t/evil.com": "/files",
	} {
		if got := safeNext(in); got != want {
			t.Errorf("safeNext(%q)=%q want %q", in, got, want)
		}
	}
}
