package httpapi_test

import (
	"database/sql"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/config"
	"github.com/qarasky/korecalendar/api/internal/httpapi"
	"github.com/qarasky/korecalendar/api/internal/oidc"
	"github.com/qarasky/korecalendar/api/internal/oidc/oidctest"
	"github.com/qarasky/korecalendar/api/internal/sso"
	"github.com/qarasky/korecalendar/api/internal/testsrv"
	"github.com/qarasky/korecalendar/api/internal/testutil"
)

const adaSub = "11111111-1111-4111-8111-111111111111"

type ssoEnv struct {
	srv  *httptest.Server
	kore *oidctest.Server
	db   *sql.DB
}

// newSSO runs the API against a fake Kore ID.
func newSSO(t *testing.T, mut func(*config.OIDC)) *ssoEnv {
	t.Helper()
	db := testutil.NewDB(t)
	kore := oidctest.New(t, "korecalendar", "s3cret")
	var h http.Handler
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { h.ServeHTTP(w, r) }))
	t.Cleanup(srv.Close)
	cfg := config.OIDC{Issuer: kore.URL, ClientID: "korecalendar", AutoProvision: true, LinkByEmail: "verified", Name: "Kore ID"}
	if mut != nil {
		mut(&cfg)
	}
	p, err := oidc.New(oidc.Config{Issuer: kore.URL, ClientID: "korecalendar", ClientSecret: "s3cret",
		RedirectURL: srv.URL + "/api/auth/oidc/callback", Audiences: cfg.ExtraAudiences})
	if err != nil {
		t.Fatal(err)
	}
	h = httpapi.NewWithOptions(db, t.TempDir(), httpapi.Options{ButtonName: "Kore ID",
		PublicURL: srv.URL, SSO: &sso.Service{DB: db, Provider: p, Cfg: cfg}})
	return &ssoEnv{srv: srv, kore: kore, db: db}
}

// browser is a cookie-keeping client that does not follow redirects by itself.
type browser struct {
	t *testing.T
	c *http.Client
}

func newBrowser(t *testing.T) *browser {
	jar, _ := cookiejar.New(nil)
	return &browser{t: t, c: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func (b *browser) get(u string) *http.Response {
	b.t.Helper()
	res, err := b.c.Get(u)
	if err != nil {
		b.t.Fatal(err)
	}
	res.Body.Close()
	return res
}

// signIn performs the whole redirect dance and returns where the callback sent the browser.
func (b *browser) signIn(e *ssoEnv, next string) string {
	b.t.Helper()
	res := b.get(e.srv.URL + "/api/auth/oidc/login?next=" + url.QueryEscape(next))
	if res.StatusCode != 302 {
		b.t.Fatalf("login: %d", res.StatusCode)
	}
	res = b.get(res.Header.Get("Location")) // Kore ID signs us in at once
	return b.get(res.Header.Get("Location")).Header.Get("Location")
}

func (b *browser) cookie(e *ssoEnv, name string) string {
	u, _ := url.Parse(e.srv.URL)
	for _, c := range b.c.Jar.Cookies(u) {
		if c.Name == name {
			return c.Value
		}
	}
	return ""
}

func (b *browser) me(e *ssoEnv) testsrv.Resp {
	b.t.Helper()
	return testsrv.Do(b.t, e.srv, "", "GET", "/api/me", nil, "Cookie", "korecal_session="+b.cookie(e, "korecal_session"))
}

func TestOIDCLoginProvisionsAndCreatesASession(t *testing.T) {
	e := newSSO(t, func(c *config.OIDC) { c.AdminSubs = []string{adaSub} })
	b := newBrowser(t)
	if loc := b.signIn(e, "/calendar/week"); loc != "/calendar/week" {
		t.Fatalf("redirected to %q", loc)
	}
	r := b.me(e)
	var me struct{ Email, Role string }
	r.Decode(t, &me)
	if r.Status != 200 || me.Email != "ada@example.com" || me.Role != "admin" {
		t.Fatalf("me: %d %s", r.Status, r.Body)
	}
	// The same subject signs in to the same account the next time.
	b2 := newBrowser(t)
	b2.signIn(e, "/")
	var n int
	e.db.QueryRow(`SELECT count(*) FROM users`).Scan(&n)
	if n != 1 {
		t.Fatalf("%d users after two logins", n)
	}
	// A default calendar exists for the new account.
	cal := testsrv.Do(t, e.srv, "", "GET", "/api/calendars", nil, "Cookie", "korecal_session="+b.cookie(e, "korecal_session"))
	if cal.Status != 200 || !strings.Contains(string(cal.Body), "Personal") {
		t.Fatalf("calendars: %d %s", cal.Status, cal.Body)
	}
}

func TestOIDCCallbackRejectsBadState(t *testing.T) {
	e := newSSO(t, func(c *config.OIDC) { c.AdminSubs = []string{adaSub} })

	// No flow cookie: a callback forged by another site cannot finish a login.
	b := newBrowser(t)
	res := b.get(e.srv.URL + "/api/auth/oidc/login")
	authURL := res.Header.Get("Location")
	cb := b.get(authURL).Header.Get("Location")
	fresh := newBrowser(t)
	if loc := fresh.get(cb).Header.Get("Location"); loc != "/login?error=invalid_state" {
		t.Fatalf("callback without the flow cookie: %q", loc)
	}
	// The original browser still can (the flow was not consumed by the forgery)...
	// ... but only once: a replay finds nothing.
	if loc := b.get(cb).Header.Get("Location"); loc != "/" {
		t.Fatalf("legit callback: %q", loc)
	}
	b3 := newBrowser(t)
	b3.get(e.srv.URL + "/api/auth/oidc/login")
	if loc := b3.get(cb).Header.Get("Location"); loc != "/login?error=invalid_state" {
		t.Fatalf("replayed callback: %q", loc)
	}
	// A guessed state with a matching cookie but no stored flow.
	b4 := newBrowser(t)
	u, _ := url.Parse(e.srv.URL)
	b4.c.Jar.SetCookies(u, []*http.Cookie{{Name: "korecal_oidc", Value: "guess", Path: "/api/auth/oidc"}})
	if loc := b4.get(e.srv.URL + "/api/auth/oidc/callback?state=guess&code=x").Header.Get("Location"); loc != "/login?error=invalid_state" {
		t.Fatalf("guessed state: %q", loc)
	}
}

func TestOIDCCallbackProviderErrorsAndIssuer(t *testing.T) {
	e := newSSO(t, nil)
	b := newBrowser(t)
	start := func() string {
		a := b.get(e.srv.URL + "/api/auth/oidc/login").Header.Get("Location")
		au, _ := url.Parse(a)
		return au.Query().Get("state")
	}
	st := start()
	if loc := b.get(e.srv.URL + "/api/auth/oidc/callback?error=access_denied&state=" + st).Header.Get("Location"); loc != "/login?error=provider_access_denied" {
		t.Fatalf("%q", loc)
	}
	st = start()
	if loc := b.get(e.srv.URL + "/api/auth/oidc/callback?code=x&iss=https://evil.example&state=" + st).Header.Get("Location"); loc != "/login?error=invalid_issuer" {
		t.Fatalf("%q", loc)
	}
}

func TestOIDCNextIsNeverAnOpenRedirect(t *testing.T) {
	e := newSSO(t, func(c *config.OIDC) { c.AdminSubs = []string{adaSub} })
	for _, next := range []string{"https://evil.example", "//evil.example", "/\\evil.example", "/login", "/setup?x=1", "calendar"} {
		if loc := newBrowser(t).signIn(e, next); loc != "/" {
			t.Errorf("next %q -> %q", next, loc)
		}
	}
}

func TestOIDCFirstUserNeedsToBeNamedAdmin(t *testing.T) {
	e := newSSO(t, nil) // no admin_subs, empty database
	loc := newBrowser(t).signIn(e, "/")
	if loc != "/login?error=no_admin" {
		t.Fatalf("%q", loc)
	}
	// Once an account exists, a Kore ID user is provisioned as a normal user.
	testsrv.CreateUser(t, e.db, testsrv.AdminEmail, "admin")
	b := newBrowser(t)
	b.signIn(e, "/")
	var me struct{ Role string }
	b.me(e).Decode(t, &me)
	if me.Role != "user" {
		t.Fatalf("role %q", me.Role)
	}
}

func TestOIDCOwnerEmailCanCreateTheFirstAdministrator(t *testing.T) {
	t.Run("owner email, verified, fresh database", func(t *testing.T) {
		e := newSSO(t, func(c *config.OIDC) { c.OwnerEmail = "ada@example.com" })
		b := newBrowser(t)
		if loc := b.signIn(e, "/"); loc != "/" {
			t.Fatalf("redirected to %q", loc)
		}
		var me struct{ Email, Role string }
		b.me(e).Decode(t, &me)
		if me.Email != "ada@example.com" || me.Role != "admin" {
			t.Fatalf("me: %+v", me)
		}
		var n int
		e.db.QueryRow(`SELECT count(*) FROM users`).Scan(&n)
		if n != 1 {
			t.Fatalf("%d users", n)
		}
	})
	t.Run("a different email is still refused", func(t *testing.T) {
		e := newSSO(t, func(c *config.OIDC) { c.OwnerEmail = "owner@example.com" })
		if loc := newBrowser(t).signIn(e, "/"); loc != "/login?error=no_admin" {
			t.Fatalf("%q", loc)
		}
		var n int
		e.db.QueryRow(`SELECT count(*) FROM users`).Scan(&n)
		if n != 0 {
			t.Fatalf("%d users", n)
		}
	})
	t.Run("the owner email must be verified", func(t *testing.T) {
		e := newSSO(t, func(c *config.OIDC) { c.OwnerEmail = "ada@example.com" })
		e.kore.User["email_verified"] = false
		if loc := newBrowser(t).signIn(e, "/"); loc != "/login?error=no_admin" {
			t.Fatalf("%q", loc)
		}
		var n int
		e.db.QueryRow(`SELECT count(*) FROM users`).Scan(&n)
		if n != 0 {
			t.Fatalf("%d users", n)
		}
	})
	t.Run("no promotion once an account exists", func(t *testing.T) {
		e := newSSO(t, func(c *config.OIDC) { c.OwnerEmail = "ada@example.com" })
		testsrv.CreateUser(t, e.db, testsrv.AdminEmail, "admin")
		b := newBrowser(t)
		b.signIn(e, "/")
		var me struct{ Role string }
		b.me(e).Decode(t, &me)
		if me.Role != "user" {
			t.Fatalf("role %q", me.Role)
		}
	})
}

func TestOIDCAutoProvisionOff(t *testing.T) {
	e := newSSO(t, func(c *config.OIDC) { c.AutoProvision = false })
	testsrv.CreateUser(t, e.db, testsrv.AdminEmail, "admin")
	if loc := newBrowser(t).signIn(e, "/"); loc != "/login?error=no_account" {
		t.Fatalf("%q", loc)
	}
}

func TestOIDCEmailLinking(t *testing.T) {
	setupWithAda := func(e *ssoEnv) string {
		// An existing local account that owns ada@example.com (from before Kore ID).
		return testsrv.CreateUser(t, e.db, "ada@example.com", "admin").ID
	}
	t.Run("off: never links, the email is not enough", func(t *testing.T) {
		e := newSSO(t, func(c *config.OIDC) { c.LinkByEmail = "off" })
		setupWithAda(e)
		if loc := newBrowser(t).signIn(e, "/"); loc != "/login?error=email_in_use" {
			t.Fatalf("%q", loc)
		}
		var sub sql.NullString
		e.db.QueryRow(`SELECT oidc_sub FROM users`).Scan(&sub)
		if sub.Valid {
			t.Fatal("linked despite link_by_email=off")
		}
	})
	t.Run("verified (the default): needs email_verified", func(t *testing.T) {
		e := newSSO(t, nil)
		setupWithAda(e)
		e.kore.User["email_verified"] = false
		if loc := newBrowser(t).signIn(e, "/"); loc != "/login?error=email_in_use" {
			t.Fatalf("unverified: %q", loc)
		}
		e.kore.User["email_verified"] = true
		b := newBrowser(t)
		if loc := b.signIn(e, "/"); loc != "/" {
			t.Fatalf("verified: %q", loc)
		}
		var n int
		e.db.QueryRow(`SELECT count(*) FROM users`).Scan(&n)
		if n != 1 {
			t.Fatalf("%d users: the existing account was not reused", n)
		}
	})
	t.Run("an account linked to someone else is never taken over", func(t *testing.T) {
		e := newSSO(t, func(c *config.OIDC) { c.LinkByEmail = "trusted" })
		setupWithAda(e)
		newBrowser(t).signIn(e, "/") // links sub 1111...
		e.kore.User["sub"] = "22222222-2222-4222-8222-222222222222"
		if loc := newBrowser(t).signIn(e, "/"); loc != "/login?error=email_in_use" {
			t.Fatalf("%q", loc)
		}
	})
}

func TestKoreIDAccessTokenAsBearer(t *testing.T) {
	e := newSSO(t, func(c *config.OIDC) {
		c.AdminSubs = []string{adaSub}
		c.ExtraAudiences = []string{"korecalendar-android"}
	})
	for _, aud := range []string{"korecalendar", "korecalendar-android"} {
		r := testsrv.Do(t, e.srv, e.kore.AccessToken(aud), "GET", "/api/me", nil)
		if r.Status != 200 {
			t.Fatalf("aud %s: %d %s", aud, r.Status, r.Body)
		}
	}
	// Another app's token, an id token, a token without typ at+jwt and a tampered token are all 401.
	for name, tok := range map[string]string{
		"other app": e.kore.AccessToken("koremind"),
		"id token":  e.kore.IDToken(""),
		"tampered":  e.kore.AccessToken("korecalendar") + "x",
		// An access token's claims without the at+jwt header (the old "has a scope" heuristic is not enough).
		"no typ":     e.kore.MintTyp(map[string]any{"aud": "korecalendar", "sub": adaSub, "scope": "openid email"}, "EdDSA", "", ""),
		"typ JWT":    e.kore.MintTyp(map[string]any{"aud": "korecalendar", "sub": adaSub, "scope": "openid email"}, "EdDSA", "", "JWT"),
		"logout+jwt": e.kore.LogoutToken("sid-1", adaSub, nil),
	} {
		if r := testsrv.Do(t, e.srv, tok, "GET", "/api/me", nil); r.Status != 401 {
			t.Errorf("%s: %d", name, r.Status)
		}
	}
	// It is a session-class credential: it can mint an agent token...
	r := testsrv.Do(t, e.srv, e.kore.AccessToken("korecalendar"), "POST", "/api/tokens", map[string]string{"name": "Android"})
	var tok struct{ Token string }
	r.Decode(t, &tok)
	if r.Status != 201 || !strings.HasPrefix(tok.Token, "kcal_") {
		t.Fatalf("mint: %d %s", r.Status, r.Body)
	}
	// ...and that agent token keeps working exactly as before, but cannot mint more.
	if r := testsrv.Do(t, e.srv, tok.Token, "GET", "/api/calendars", nil); r.Status != 200 {
		t.Fatalf("kcal token: %d", r.Status)
	}
	if r := testsrv.Do(t, e.srv, tok.Token, "POST", "/api/tokens", map[string]string{"name": "x"}); r.Status != 403 {
		t.Fatalf("kcal token minted a token: %d", r.Status)
	}
	// Without the extra audience configured the Android client id is refused.
	e2 := newSSO(t, func(c *config.OIDC) { c.AdminSubs = []string{adaSub} })
	if r := testsrv.Do(t, e2.srv, e2.kore.AccessToken("korecalendar-android"), "GET", "/api/me", nil); r.Status != 401 {
		t.Fatalf("unconfigured audience: %d", r.Status)
	}
}

func TestKoreIDBearerNotOfferedWithoutSSO(t *testing.T) {
	srv, _ := testsrv.New(t)
	if r := testsrv.Do(t, srv, "eyJhbGciOiJFZERTQSJ9.e30.sig", "GET", "/api/me", nil); r.Status != 401 {
		t.Fatalf("%d", r.Status)
	}
}

func TestKoreIDOnlySignIn(t *testing.T) {
	e := newSSO(t, func(c *config.OIDC) { c.AdminSubs = []string{adaSub} })
	// Kore ID works...
	b := newBrowser(t)
	b.signIn(e, "/")
	if r := b.me(e); r.Status != 200 {
		t.Fatalf("me: %d", r.Status)
	}
	// ...and the sign-in config advertises only it.
	var cfg map[string]any
	testsrv.Do(t, e.srv, "", "GET", "/api/auth/config", nil).Decode(t, &cfg)
	if _, ok := cfg["password_login"]; ok {
		t.Fatalf("password_login still advertised: %v", cfg)
	}
	oidc, _ := cfg["oidc"].(map[string]any)
	if oidc["name"] != "Kore ID" || oidc["login_url"] != "/api/auth/oidc/login" {
		t.Fatalf("config %+v", cfg)
	}
}

func TestAuthConfigFirstUserSSO(t *testing.T) {
	var cfg struct {
		FirstUserSSO bool `json:"first_user_sso"`
	}
	for name, owner := range map[string]string{"unset": "", "set": "ada@example.com"} {
		e := newSSO(t, func(c *config.OIDC) { c.OwnerEmail = owner })
		testsrv.Do(t, e.srv, "", "GET", "/api/auth/config", nil).Decode(t, &cfg)
		if cfg.FirstUserSSO != (owner != "") {
			t.Errorf("%s: first_user_sso = %v", name, cfg.FirstUserSSO)
		}
	}
}

func TestAuthConfigWithoutSSO(t *testing.T) {
	srv, _ := testsrv.New(t)
	r := testsrv.Do(t, srv, "", "GET", "/api/auth/config", nil)
	if r.Status != 200 || string(r.Body) != "{\"first_user_sso\":false,\"oidc\":null}\n" {
		t.Fatalf("%d %q", r.Status, r.Body)
	}
	if r := testsrv.Do(t, srv, "", "GET", "/api/auth/oidc/login", nil); r.Status != 404 {
		t.Fatalf("login without sso: %d", r.Status)
	}
}

func TestLogoutEndsTheKoreIDSessionToo(t *testing.T) {
	e := newSSO(t, func(c *config.OIDC) { c.AdminSubs = []string{adaSub} })
	b := newBrowser(t)
	b.signIn(e, "/")
	sess := b.cookie(e, "korecal_session")
	// A token session on the same server logs out as before: 204.
	bob := testsrv.CreateUser(t, e.db, "bob@example.com", "user")
	pwTok := testsrv.Session(t, e.db, bob.ID)
	if r := testsrv.Do(t, e.srv, pwTok, "POST", "/api/logout", nil); r.Status != 204 {
		t.Fatalf("token logout: %d", r.Status)
	}
	r := testsrv.Do(t, e.srv, sess, "POST", "/api/logout", nil)
	var out struct {
		URL string `json:"end_session_url"`
	}
	r.Decode(t, &out)
	u, _ := url.Parse(out.URL)
	if r.Status != 200 || !strings.HasPrefix(out.URL, e.kore.URL+"/logout?") || u.Query().Get("id_token_hint") == "" ||
		u.Query().Get("post_logout_redirect_uri") != e.srv.URL+"/login" {
		t.Fatalf("logout: %d %s", r.Status, r.Body)
	}
	if r := testsrv.Do(t, e.srv, sess, "GET", "/api/me", nil); r.Status != 401 {
		t.Fatalf("session survived logout: %d", r.Status)
	}
}
