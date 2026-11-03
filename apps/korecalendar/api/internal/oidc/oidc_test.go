package oidc_test

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/qarasky/korecalendar/api/internal/oidc"
	"github.com/qarasky/korecalendar/api/internal/oidc/oidctest"
)

func setup(t *testing.T, extra ...string) (*oidctest.Server, *oidc.Provider) {
	t.Helper()
	f := oidctest.New(t, "korecalendar", "s3cret")
	p, err := oidc.New(oidc.Config{Issuer: f.URL, ClientID: "korecalendar", ClientSecret: "s3cret",
		RedirectURL: "http://localhost/api/auth/oidc/callback", Audiences: extra})
	if err != nil {
		t.Fatal(err)
	}
	return f, p
}

func TestNewRejectsPlainHTTPIssuerOffLoopback(t *testing.T) {
	for _, iss := range []string{"http://id.example.com", "id.example.com", "ftp://x", ""} {
		if _, err := oidc.New(oidc.Config{Issuer: iss, ClientID: "c", RedirectURL: "r"}); err == nil {
			t.Errorf("issuer %q accepted", iss)
		}
	}
	for _, iss := range []string{"https://id.example.com/", "http://localhost:4000", "http://127.0.0.1:4000"} {
		if _, err := oidc.New(oidc.Config{Issuer: iss, ClientID: "c", RedirectURL: "r"}); err != nil {
			t.Errorf("issuer %q: %v", iss, err)
		}
	}
}

func TestBeginUsesPKCEStateAndNonce(t *testing.T) {
	_, p := setup(t)
	a, err := p.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	b, _ := p.Begin(context.Background())
	u, _ := url.Parse(a.URL)
	q := u.Query()
	if q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "" || q.Get("response_type") != "code" ||
		q.Get("state") != a.State || q.Get("nonce") != a.Nonce || q.Get("client_id") != "korecalendar" ||
		q.Get("scope") != "openid profile email" || q.Get("redirect_uri") != "http://localhost/api/auth/oidc/callback" {
		t.Fatalf("authorize query %v", q)
	}
	if strings.Contains(a.URL, a.Verifier) {
		t.Fatal("verifier leaked into the URL")
	}
	if a.State == b.State || a.Nonce == b.Nonce || a.Verifier == b.Verifier {
		t.Fatal("flow secrets repeat")
	}
}

func TestExchangeVerifiesCodeAndIDToken(t *testing.T) {
	f, p := setup(t)
	flow, _ := p.Begin(context.Background())
	u, _ := url.Parse(flow.URL)
	// The fake authorize endpoint answers with a redirect carrying the code.
	code := authorizeCode(t, f, flow.URL)
	_ = u
	c, idt, err := p.Exchange(context.Background(), code, flow.Verifier, flow.Nonce)
	if err != nil {
		t.Fatal(err)
	}
	if c.Subject != f.User["sub"] || c.Email != "ada@example.com" || idt == "" {
		t.Fatalf("claims %+v", c)
	}
	// A wrong PKCE verifier is refused by the provider.
	code = authorizeCode(t, f, flow.URL)
	if _, _, err := p.Exchange(context.Background(), code, "not-the-verifier-not-the-verifier-not-the-verifier", flow.Nonce); err == nil {
		t.Fatal("wrong verifier accepted")
	}
	// A nonce other than ours is refused even with a valid signature.
	code = authorizeCode(t, f, flow.URL)
	if _, _, err := p.Exchange(context.Background(), code, flow.Verifier, "other-nonce"); err == nil {
		t.Fatal("nonce mismatch accepted")
	}
}

func authorizeCode(t *testing.T, f *oidctest.Server, authURL string) string {
	t.Helper()
	cl := f.Client()
	cl.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	res, err := cl.Get(authURL)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	loc, _ := url.Parse(res.Header.Get("Location"))
	return loc.Query().Get("code")
}

func TestVerifyIDTokenRejects(t *testing.T) {
	f, p := setup(t)
	ctx := context.Background()
	good := map[string]any{"aud": "korecalendar", "sub": "s", "nonce": "n"}
	if _, err := p.VerifyIDToken(ctx, f.Mint(good), "n"); err != nil {
		t.Fatalf("good token: %v", err)
	}
	with := func(k string, v any) map[string]any {
		m := map[string]any{}
		for a, b := range good {
			m[a] = b
		}
		m[k] = v
		return m
	}
	cases := map[string]string{
		"wrong audience":                   f.Mint(with("aud", "koremind")),
		"wrong issuer":                     f.Mint(with("iss", "https://evil.example")),
		"expired":                          f.Mint(with("exp", time.Now().Add(-time.Hour).Unix())),
		"no subject":                       f.Mint(with("sub", "")),
		"wrong nonce":                      f.Mint(with("nonce", "x")),
		"HS256 forged with the public key": f.MintWith(good, "HS256", ""),
		"unknown key id":                   f.MintWith(good, "EdDSA", "nope"),
		"garbage":                          "a.b.c",
	}
	for name, tok := range cases {
		if _, err := p.VerifyIDToken(ctx, tok, "n"); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	// No expiry at all is refused.
	if _, err := p.VerifyIDToken(ctx, f.Mint(with("exp", nil)), "n"); err == nil {
		t.Error("token without exp accepted")
	}
}

func TestAccessTokens(t *testing.T) {
	f, p := setup(t, "korecalendar-android")
	ctx := context.Background()
	for _, aud := range []string{"korecalendar", "korecalendar-android"} {
		c, err := p.VerifyAccessToken(ctx, f.AccessToken(aud))
		if err != nil || c.Subject == "" || c.Email != "ada@example.com" {
			t.Errorf("aud %s: %+v %v", aud, c, err)
		}
	}
	if _, err := p.VerifyAccessToken(ctx, f.AccessToken("koremind")); err == nil {
		t.Error("another app's token accepted")
	}
	// Kore ID signs id tokens with the same key: they must not work as bearer tokens.
	if _, err := p.VerifyAccessToken(ctx, f.IDToken("")); err == nil {
		t.Error("id token accepted as an access token")
	}
}

func TestKeyRotationRefetchesOnceAndIsThrottled(t *testing.T) {
	f, p := setup(t)
	ctx := context.Background()
	tok := func() string { return f.AccessToken("korecalendar") }
	if _, err := p.VerifyAccessToken(ctx, tok()); err != nil {
		t.Fatal(err)
	}
	hits := f.JWKSHits
	f.Rotate()
	// Inside the throttle window the new key is not fetched yet...
	if _, err := p.VerifyAccessToken(ctx, tok()); err == nil {
		t.Fatal("rotated key accepted without a refetch")
	}
	if f.JWKSHits != hits {
		t.Fatalf("keys refetched %d times inside the throttle window", f.JWKSHits-hits)
	}
}

func TestEndSessionURL(t *testing.T) {
	f, p := setup(t)
	u := p.EndSessionURL(context.Background(), "the.id.token", "https://cal.example/login")
	pu, _ := url.Parse(u)
	if !strings.HasPrefix(u, f.URL+"/logout?") || pu.Query().Get("id_token_hint") != "the.id.token" || pu.Query().Get("post_logout_redirect_uri") != "https://cal.example/login" {
		t.Fatalf("url %s", u)
	}
	if p.EndSessionURL(context.Background(), "", "x") != "" {
		t.Fatal("URL without an id token hint")
	}
}

func TestDiscoveryIssuerMustMatch(t *testing.T) {
	f := oidctest.New(t, "korecalendar", "")
	p, _ := oidc.New(oidc.Config{Issuer: f.URL + "/", ClientID: "korecalendar", RedirectURL: "http://localhost/cb"})
	if _, err := p.Begin(context.Background()); err != nil {
		t.Fatalf("trailing slash on the issuer: %v", err)
	}
	// A provider that announces a different issuer is refused.
	g := oidctest.New(t, "korecalendar", "")
	h, _ := oidc.New(oidc.Config{Issuer: g.URL, ClientID: "korecalendar", RedirectURL: "http://localhost/cb",
		HTTP: redirectTo(f.URL, g.URL)})
	if _, err := h.Begin(context.Background()); err == nil {
		t.Fatal("mismatched issuer accepted")
	}
}
