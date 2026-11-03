package httpapi_test

import (
	"net/url"
	"testing"
	"time"

	"github.com/qarasky/korecalendar/api/internal/config"
	"github.com/qarasky/korecalendar/api/internal/testsrv"
)

func (e *ssoEnv) backchannel(t *testing.T, logoutToken string) testsrv.Resp {
	t.Helper()
	return testsrv.DoRaw(t, e.srv, "", "POST", "/api/auth/oidc/backchannel-logout", "application/x-www-form-urlencoded",
		[]byte(url.Values{"logout_token": {logoutToken}}.Encode()))
}

func sessionWorks(t *testing.T, e *ssoEnv, tok string) bool {
	t.Helper()
	return testsrv.Do(t, e.srv, tok, "GET", "/api/me", nil).Status == 200
}

func TestOIDCSessionStoresSid(t *testing.T) {
	e := newSSO(t, func(c *config.OIDC) { c.AdminSubs = []string{adaSub} })
	e.kore.Sid = "kore-session-7"
	newBrowser(t).signIn(e, "/")
	var sid string
	if err := e.db.QueryRow(`SELECT oidc_sid FROM sessions`).Scan(&sid); err != nil || sid != "kore-session-7" {
		t.Fatalf("stored sid %q %v", sid, err)
	}
}

func TestBackchannelLogoutEndsSessionsOfThatSid(t *testing.T) {
	e := newSSO(t, func(c *config.OIDC) {
		c.AdminSubs = []string{adaSub}
		c.ExtraAudiences = []string{"korecalendar-android"}
	})
	// Two browsers in Kore ID session A, one in session B, all the same user.
	e.kore.Sid = "A"
	a1, a2 := newBrowser(t), newBrowser(t)
	a1.signIn(e, "/")
	a2.signIn(e, "/")
	e.kore.Sid = "B"
	b := newBrowser(t)
	b.signIn(e, "/")
	sA1, sA2, sB := a1.cookie(e, "korecal_session"), a2.cookie(e, "korecal_session"), b.cookie(e, "korecal_session")
	// An agent token minted from session A (as the Android app does) and a password session of another user.
	r := testsrv.Do(t, e.srv, sA1, "POST", "/api/tokens", map[string]string{"name": "agent"})
	var kcal struct{ Token string }
	r.Decode(t, &kcal)
	bobUser := testsrv.CreateUser(t, e.db, "bob@example.com", "user")
	bob := testsrv.Session(t, e.db, bobUser.ID)
	e.kore.Sid = "A"
	bearerA := e.kore.AccessToken("korecalendar-android")
	if !sessionWorks(t, e, bearerA) {
		t.Fatal("bearer before logout")
	}

	tok := e.kore.LogoutToken("A", adaSub, nil)
	if r := e.backchannel(t, tok); r.Status != 200 || r.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("logout: %d %s", r.Status, r.Body)
	}
	if sessionWorks(t, e, sA1) || sessionWorks(t, e, sA2) {
		t.Fatal("a session of the ended Kore ID session survived")
	}
	if !sessionWorks(t, e, sB) || !sessionWorks(t, e, bob) {
		t.Fatal("an unrelated session was ended")
	}
	if !sessionWorks(t, e, kcal.Token) {
		t.Fatal("the kcal_ access token was revoked; it is not a session")
	}
	// Access tokens of the ended Kore ID session are refused too (they live 10 more minutes at Kore ID).
	if sessionWorks(t, e, bearerA) {
		t.Fatal("bearer token of an ended Kore ID session still works")
	}
	e.kore.Sid = "B"
	if !sessionWorks(t, e, e.kore.AccessToken("korecalendar")) {
		t.Fatal("bearer of another Kore ID session refused")
	}
	// The same token again is a replay.
	if r := e.backchannel(t, tok); r.Status != 400 || r.ErrorCode() != "invalid_request" {
		t.Fatalf("replay: %d %s", r.Status, r.Body)
	}
}

func TestBackchannelLogoutBySubWithoutSid(t *testing.T) {
	e := newSSO(t, func(c *config.OIDC) { c.AdminSubs = []string{adaSub} })
	e.kore.Sid = "A"
	a := newBrowser(t)
	a.signIn(e, "/")
	e.kore.Sid = "" // a provider that sends no sid
	n := newBrowser(t)
	n.signIn(e, "/")
	sA, sN := a.cookie(e, "korecal_session"), n.cookie(e, "korecal_session")
	bobUser := testsrv.CreateUser(t, e.db, "bob@example.com", "user")
	bob := testsrv.Session(t, e.db, bobUser.ID)
	if r := e.backchannel(t, e.kore.LogoutToken("", adaSub, nil)); r.Status != 200 {
		t.Fatalf("logout: %d %s", r.Status, r.Body)
	}
	if sessionWorks(t, e, sA) || sessionWorks(t, e, sN) {
		t.Fatal("a session of that subject survived")
	}
	if !sessionWorks(t, e, bob) {
		t.Fatal("another user's session ended")
	}
	// Unknown subject or sid: nothing to do, still 200.
	if r := e.backchannel(t, e.kore.LogoutToken("nope", "", nil)); r.Status != 200 {
		t.Fatalf("unknown sid: %d", r.Status)
	}
}

func TestBackchannelLogoutRejectsBadTokens(t *testing.T) {
	e := newSSO(t, func(c *config.OIDC) {
		c.AdminSubs = []string{adaSub}
		c.ExtraAudiences = []string{"korecalendar-android"}
	})
	e.kore.Sid = "A"
	b := newBrowser(t)
	b.signIn(e, "/")
	sess := b.cookie(e, "korecal_session")
	ev := map[string]any{"http://schemas.openid.net/event/backchannel-logout": map[string]any{}}
	for name, tok := range map[string]string{
		"empty":                  "",
		"not a jwt":              "hello",
		"wrong audience":         e.kore.LogoutToken("A", adaSub, map[string]any{"aud": "koremind"}),
		"android audience":       e.kore.LogoutToken("A", adaSub, map[string]any{"aud": "korecalendar-android"}),
		"wrong issuer":           e.kore.LogoutToken("A", adaSub, map[string]any{"iss": "https://evil.example"}),
		"wrong typ":              e.kore.LogoutToken("A", adaSub, map[string]any{"typ": "JWT"}),
		"missing events":         e.kore.LogoutToken("A", adaSub, map[string]any{"events": nil}),
		"nonce present":          e.kore.LogoutToken("A", adaSub, map[string]any{"nonce": "n"}),
		"expired":                e.kore.LogoutToken("A", adaSub, map[string]any{"exp": time.Now().Add(-time.Hour).Unix()}),
		"bad signature":          e.kore.LogoutToken("A", adaSub, nil) + "x",
		"id token":               e.kore.IDToken(""),
		"access token":           e.kore.AccessToken("korecalendar"),
		"HS256 with public key":  e.kore.MintTyp(map[string]any{"aud": "korecalendar", "sid": "A", "jti": "j1", "events": ev}, "HS256", "", "logout+jwt"),
		"neither sid nor sub":    e.kore.LogoutToken("", "", nil),
		"no jti":                 e.kore.LogoutToken("A", adaSub, map[string]any{"jti": nil}),
		"unknown signing key id": e.kore.MintTyp(map[string]any{"aud": "korecalendar", "sid": "A", "jti": "j2", "events": ev}, "EdDSA", "other", "logout+jwt"),
	} {
		r := e.backchannel(t, tok)
		if r.Status != 400 || r.ErrorCode() != "invalid_request" {
			t.Errorf("%s: %d %s", name, r.Status, r.Body)
		}
	}
	if !sessionWorks(t, e, sess) {
		t.Fatal("a rejected logout token ended the session")
	}
	// GET is not a logout.
	if r := testsrv.Do(t, e.srv, "", "GET", "/api/auth/oidc/backchannel-logout", nil); r.Status == 200 {
		t.Fatal("GET accepted")
	}
}

func TestBackchannelLogoutWithoutSSO(t *testing.T) {
	srv, _ := testsrv.New(t)
	r := testsrv.DoRaw(t, srv, "", "POST", "/api/auth/oidc/backchannel-logout", "application/x-www-form-urlencoded", []byte("logout_token=a.b.c"))
	if r.Status != 404 {
		t.Fatalf("%d", r.Status)
	}
}

func TestAuthConfigAccountURLAndApps(t *testing.T) {
	e := newSSO(t, nil)
	var cfg struct {
		OIDC struct {
			AccountURL string            `json:"account_url"`
			Apps       map[string]string `json:"apps"`
		} `json:"oidc"`
	}
	testsrv.Do(t, e.srv, "", "GET", "/api/auth/config", nil).Decode(t, &cfg)
	if cfg.OIDC.AccountURL != e.kore.URL+"/account" || cfg.OIDC.Apps["korecalendar"] != e.srv.URL+"/" {
		t.Fatalf("%+v", cfg)
	}
}
