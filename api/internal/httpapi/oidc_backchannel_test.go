package httpapi

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/qarasky/kore/api/internal/auth"
)

func (e *ssoEnv) backchannel(form url.Values) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", backchannelPath, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.RemoteAddr = "9.9.9.9:443"
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	return rec
}

func (e *ssoEnv) logoutWith(tok string) *httptest.ResponseRecorder {
	return e.backchannel(url.Values{"logout_token": {tok}})
}

func alive(e *ssoEnv, c *http.Cookie) bool { return e.do("GET", "/api/auth/me", nil, c).Code == 200 }

func TestSSOLoginStoresSid(t *testing.T) {
	e := setupSSO(t, false, true)
	e.idp.sid = "sid-abc"
	sess := ssoSession(t, e)
	var sid string
	if err := e.db.QueryRow(`SELECT sid FROM sessions WHERE token_hash=?`, auth.HashToken(sess.Value)).Scan(&sid); err != nil || sid != "sid-abc" {
		t.Fatalf("sid %q err %v", sid, err)
	}
	// Password sessions have none.
	local := sessionCookie(t, e.db, "local@kore.test")
	var n int
	e.db.QueryRow(`SELECT count(*) FROM sessions WHERE token_hash=? AND sid IS NULL`, auth.HashToken(local.Value)).Scan(&n)
	if n != 1 {
		t.Fatal("password session got a sid")
	}
}

func TestBackchannelLogoutBySid(t *testing.T) {
	e := setupSSO(t, false, true)
	e.idp.sid = "sid-A"
	a1, a2 := ssoSession(t, e), ssoSession(t, e)
	e.idp.sid = "sid-B"
	b := ssoSession(t, e)
	e.idp.sid = "sid-A"
	rec := e.logoutWith(e.idp.logout("jti-1", nil))
	if rec.Code != 200 || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %q %s", rec.Code, rec.Header().Get("Cache-Control"), rec.Body)
	}
	if alive(e, a1) || alive(e, a2) {
		t.Fatal("sessions of the ended Kore ID session survived")
	}
	if !alive(e, b) {
		t.Fatal("another Kore ID session of the same user was ended")
	}
	// Nothing left to end: still 200.
	if rec := e.logoutWith(e.idp.logout("jti-2", map[string]any{"sid": "sid-unknown"})); rec.Code != 200 {
		t.Fatalf("no matching sessions: %d", rec.Code)
	}
}

func TestBackchannelLogoutBySub(t *testing.T) {
	e := setupSSO(t, false, true)
	e.idp.sid = "sid-A"
	a := ssoSession(t, e)
	e.idp.sid = "sid-B"
	b := ssoSession(t, e)
	other := sessionCookie(t, e.db, "local@kore.test")
	rec := e.logoutWith(e.idp.logout("jti-sub", map[string]any{"sid": nil}))
	if rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if alive(e, a) || alive(e, b) {
		t.Fatal("sub-only logout left sessions of the user")
	}
	if !alive(e, other) {
		t.Fatal("sub-only logout ended another user's session")
	}
}

func TestBackchannelLogoutRejects(t *testing.T) {
	e := setupSSO(t, false, true)
	sess := ssoSession(t, e)
	_, otherKey, _ := ed25519.GenerateKey(rand.Reader)
	forged := func() string {
		good := e.idp.logout("jti-forged", nil)
		parts := strings.Split(good, ".")
		return parts[0] + "." + parts[1] + "." + b64.EncodeToString(ed25519.Sign(otherKey, []byte(parts[0]+"."+parts[1])))
	}
	for name, tok := range map[string]string{
		"bad signature":    forged(),
		"wrong iss":        e.idp.logout("j1", map[string]any{"iss": "https://evil.example"}),
		"wrong aud":        e.idp.logout("j2", map[string]any{"aud": "koremind"}),
		"typ JWT":          e.idp.signTyp("JWT", map[string]any{}, mapOf(e.idp.logout("j3", nil))),
		"typ at+jwt":       e.idp.signTyp("at+jwt", map[string]any{}, mapOf(e.idp.logout("j4", nil))),
		"missing events":   e.idp.logout("j5", map[string]any{"events": nil}),
		"wrong event":      e.idp.logout("j6", map[string]any{"events": map[string]any{"urn:other": map[string]any{}}}),
		"events not obj":   e.idp.logout("j7", map[string]any{"events": "http://schemas.openid.net/event/backchannel-logout"}),
		"nonce present":    e.idp.logout("j8", map[string]any{"nonce": "n"}),
		"expired":          e.idp.logout("j9", map[string]any{"exp": time.Now().Add(-time.Hour).Unix()}),
		"missing exp":      e.idp.logout("j10", map[string]any{"exp": nil}),
		"missing iat":      e.idp.logout("j11", map[string]any{"iat": nil}),
		"missing jti":      e.idp.logout("", map[string]any{"jti": nil}),
		"no sid or sub":    e.idp.logout("j12", map[string]any{"sid": nil, "sub": nil}),
		"empty token":      "",
		"junk":             "a.b.c",
		"id token instead": e.idp.token(map[string]any{}),
	} {
		rec := e.logoutWith(tok)
		var body map[string]string
		json.Unmarshal(rec.Body.Bytes(), &body)
		if rec.Code != 400 || body["error"] == "" || rec.Header().Get("Cache-Control") != "no-store" {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body)
		}
	}
	if !alive(e, sess) {
		t.Fatal("a rejected logout token ended the session")
	}
	// The token must come in the form body, not the query string.
	tok := e.idp.logout("j-query", nil)
	req := httptest.NewRequest("POST", backchannelPath+"?logout_token="+tok, nil)
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	if rec.Code != 400 || !alive(e, sess) {
		t.Fatalf("query-string token: %d", rec.Code)
	}
	// Replay: the first delivery works, the second is refused.
	if rec := e.logoutWith(e.idp.logout("j-replay", nil)); rec.Code != 200 || alive(e, sess) {
		t.Fatalf("first delivery: %d", rec.Code)
	}
	sess = ssoSession(t, e)
	if rec := e.logoutWith(e.idp.logout("j-replay", nil)); rec.Code != 400 || !alive(e, sess) {
		t.Fatalf("replayed jti: %d", rec.Code)
	}
}

// mapOf returns the claims of a JWT (to re-sign them under another typ).
func mapOf(tok string) map[string]any {
	var c map[string]any
	b, _ := b64.DecodeString(strings.Split(tok, ".")[1])
	json.Unmarshal(b, &c)
	return c
}

func TestBackchannelLogoutBypassesSessionAndNeedsSSO(t *testing.T) {
	e := setupSSO(t, false, true)
	sess := ssoSession(t, e)
	// A browser cookie on the request changes nothing (no session, no CSRF gate).
	req := httptest.NewRequest("POST", backchannelPath, strings.NewReader(url.Values{"logout_token": {e.idp.logout("j-c", nil)}}.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	if rec.Code != 200 || alive(e, sess) {
		t.Fatalf("%d", rec.Code)
	}
	if _, err := auth.UserForToken(context.Background(), e.db, sess.Value); err == nil {
		t.Fatal("session row still there")
	}
	// Without Kore ID configured the route does not exist.
	h := setup(t)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", backchannelPath, strings.NewReader("logout_token=x")))
	if rec.Code != 404 {
		t.Fatalf("without SSO: %d", rec.Code)
	}
}
