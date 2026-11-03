package oidc

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

var b64 = base64.RawURLEncoding

type fakeIDP struct {
	srv   *httptest.Server
	priv  ed25519.PrivateKey
	kid   string
	jwks  atomic.Int32
	extra []ed25519.PublicKey
}

func newIDP(t *testing.T) *fakeIDP {
	t.Helper()
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	f := &fakeIDP{priv: priv, kid: "k1"}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"issuer": f.srv.URL, "authorization_endpoint": f.srv.URL + "/authorize", "token_endpoint": f.srv.URL + "/token",
			"jwks_uri": f.srv.URL + "/jwks", "end_session_endpoint": f.srv.URL + "/logout",
			"code_challenge_methods_supported": []string{"S256"},
		})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, r *http.Request) {
		f.jwks.Add(1)
		keys := []map[string]string{{"kty": "OKP", "crv": "Ed25519", "kid": f.kid, "use": "sig", "alg": "EdDSA", "x": b64.EncodeToString(pub)}}
		json.NewEncoder(w).Encode(map[string]any{"keys": keys})
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeIDP) sign(t *testing.T, key ed25519.PrivateKey, kid, alg string, claims map[string]any) string {
	t.Helper()
	h, _ := json.Marshal(map[string]string{"alg": alg, "kid": kid, "typ": "JWT"})
	c, _ := json.Marshal(claims)
	in := b64.EncodeToString(h) + "." + b64.EncodeToString(c)
	return in + "." + b64.EncodeToString(ed25519.Sign(key, []byte(in)))
}

func (f *fakeIDP) claims(over map[string]any) map[string]any {
	c := map[string]any{"iss": f.srv.URL, "aud": "kore", "sub": "u-1", "exp": time.Now().Add(time.Minute).Unix(), "email": "a@b.c"}
	for k, v := range over {
		c[k] = v
	}
	return c
}

func (f *fakeIDP) provider() *Provider {
	return New(Config{Issuer: f.srv.URL, ClientID: "kore", ClientSecret: "s", RedirectURL: "http://app/cb"})
}

func TestVerify(t *testing.T) {
	f := newIDP(t)
	p := f.provider()
	ctx := context.Background()
	_, otherPriv, _ := ed25519.GenerateKey(rand.Reader)

	cases := []struct {
		name  string
		token string
		ok    bool
	}{
		{"valid", f.sign(t, f.priv, "k1", "EdDSA", f.claims(nil)), true},
		{"aud array", f.sign(t, f.priv, "k1", "EdDSA", f.claims(map[string]any{"aud": []string{"x", "kore"}})), true},
		{"wrong audience", f.sign(t, f.priv, "k1", "EdDSA", f.claims(map[string]any{"aud": "koremind"})), false},
		{"wrong issuer", f.sign(t, f.priv, "k1", "EdDSA", f.claims(map[string]any{"iss": "https://evil"})), false},
		{"expired", f.sign(t, f.priv, "k1", "EdDSA", f.claims(map[string]any{"exp": time.Now().Add(-time.Hour).Unix()})), false},
		{"no exp", f.sign(t, f.priv, "k1", "EdDSA", func() map[string]any { c := f.claims(nil); delete(c, "exp"); return c }()), false},
		{"not yet valid", f.sign(t, f.priv, "k1", "EdDSA", f.claims(map[string]any{"nbf": time.Now().Add(time.Hour).Unix()})), false},
		{"no sub", f.sign(t, f.priv, "k1", "EdDSA", f.claims(map[string]any{"sub": ""})), false},
		{"signed by another key", f.sign(t, otherPriv, "k1", "EdDSA", f.claims(nil)), false},
		{"alg none", b64.EncodeToString([]byte(`{"alg":"none","kid":"k1"}`)) + "." + b64.EncodeToString([]byte(`{"iss":"`+f.srv.URL+`","aud":"kore","sub":"x","exp":9999999999}`)) + ".", false},
		{"alg HS256", f.sign(t, f.priv, "k1", "HS256", f.claims(nil)), false},
		{"garbage", "a.b", false},
	}
	for _, c := range cases {
		_, err := p.Verify(ctx, c.token)
		if (err == nil) != c.ok {
			t.Errorf("%s: err=%v, want ok=%v", c.name, err, c.ok)
		}
		if err != nil && !errors.Is(err, ErrToken) {
			t.Errorf("%s: %v is not ErrToken", c.name, err)
		}
	}
}

func TestVerifyClaims(t *testing.T) {
	f := newIDP(t)
	c, err := f.provider().Verify(context.Background(), f.sign(t, f.priv, "k1", "EdDSA", f.claims(map[string]any{"nonce": "n", "name": "Ann", "scope": "openid email"})))
	if err != nil || c.Sub != "u-1" || c.Email != "a@b.c" || c.Nonce != "n" || c.Name != "Ann" || c.Scope != "openid email" {
		t.Fatalf("%+v %v", c, err)
	}
}

func TestUnknownKidRefetchIsRateLimited(t *testing.T) {
	f := newIDP(t)
	p := f.provider()
	now := time.Now()
	p.now = func() time.Time { return now }
	ctx := context.Background()
	tok := f.sign(t, f.priv, "rotated", "EdDSA", f.claims(nil))
	for i := 0; i < 5; i++ {
		if _, err := p.Verify(ctx, tok); err == nil {
			t.Fatal("unknown kid accepted")
		}
	}
	if n := f.jwks.Load(); n != 1 {
		t.Fatalf("%d JWKS fetches for repeated unknown kid, want 1", n)
	}
	// After key rotation at the provider, a refetch picks the new key up.
	f.kid = "rotated"
	now = now.Add(time.Minute)
	if _, err := p.Verify(ctx, tok); err != nil {
		t.Fatalf("after rotation: %v", err)
	}
}

func TestDiscoveryRejectsIssuerMismatch(t *testing.T) {
	f := newIDP(t)
	p := New(Config{Issuer: f.srv.URL + "/", ClientID: "kore"})
	if _, err := p.AuthURL(context.Background(), NewFlow(), nil); err != nil {
		t.Fatal(err) // trailing slash in config is normalised
	}
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"issuer":"https://other","authorization_endpoint":"a","token_endpoint":"t","jwks_uri":"j","code_challenge_methods_supported":["S256"]}`))
	}))
	defer bad.Close()
	if _, err := New(Config{Issuer: bad.URL}).AuthURL(context.Background(), NewFlow(), nil); err == nil {
		t.Fatal("issuer mismatch accepted")
	}
}

func TestAuthURLHasPKCEStateNonce(t *testing.T) {
	f := newIDP(t)
	fl := NewFlow()
	u, err := f.provider().AuthURL(context.Background(), fl, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"code_challenge_method=S256", "code_challenge=" + ChallengeS256(fl.Verifier), "state=" + fl.State, "nonce=" + fl.Nonce, "client_id=kore", "response_type=code"} {
		if !strings.Contains(u, want) {
			t.Errorf("%s missing from %s", want, u)
		}
	}
	if strings.Contains(u, fl.Verifier) {
		t.Error("verifier leaked into the authorization URL")
	}
	// RFC 7636 appendix B vector.
	if got := ChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"); got != "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" {
		t.Fatalf("challenge %s", got)
	}
}

func TestRefreshInvalidGrant(t *testing.T) {
	f := newIDP(t)
	mux := f.srv.Config.Handler.(*http.ServeMux)
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		if r.Form.Get("client_secret") != "s" || r.Form.Get("client_id") != "kore" {
			w.WriteHeader(401)
			return
		}
		if r.Form.Get("refresh_token") == "dead" {
			w.WriteHeader(400)
			w.Write([]byte(`{"error":"invalid_grant"}`))
			return
		}
		w.WriteHeader(500)
	})
	p := f.provider()
	if _, err := p.Refresh(context.Background(), "dead"); !errors.Is(err, ErrInvalidGrant) {
		t.Fatalf("got %v", err)
	}
	if _, err := p.Refresh(context.Background(), "alive"); err == nil || errors.Is(err, ErrInvalidGrant) {
		t.Fatalf("500 must be transient, got %v", err)
	}
}
