package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/nodes"
)

// from sends an anonymous request from remote, with extra headers.
func (e *shareEnv) from(remote, method, path, body string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.RemoteAddr = remote
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	return rec
}

func TestLimitKeyGroupsIPv6By64(t *testing.T) {
	key := func(remote string) string {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = remote
		return limitKey(r)
	}
	if a, b := key("[2001:db8:1:2::1]:1"), key("[2001:db8:1:2:ffff:ffff:ffff:ffff]:1"); a != b || a != "2001:db8:1:2::/64" {
		t.Fatalf("same /64: %s %s", a, b)
	}
	if key("[2001:db8:1:3::1]:1") == key("[2001:db8:1:2::1]:1") {
		t.Fatal("different /64 merged")
	}
	if k := key("8.8.8.8:1"); k != "8.8.8.8" {
		t.Fatalf("v4 %s", k)
	}
	if k := key("[::ffff:8.8.4.4]:1"); k != "8.8.4.4" {
		t.Fatalf("v4-mapped %s", k)
	}
}

func TestLoginLimitGroupsIPv6By64(t *testing.T) {
	h := setup(t)
	for i := 0; i < 5; i++ {
		// A fresh address in the same /64 for every attempt.
		if rec := loginFrom(h, "[2001:db8:9:9::"+string(rune('a'+i))+"]:1", "a@b.c", "bad"); rec.Code != 401 {
			t.Fatalf("attempt %d: %d", i, rec.Code)
		}
	}
	if rec := loginFrom(h, "[2001:db8:9:9::ff]:1", "a@b.c", "right-pw"); rec.Code != 429 {
		t.Fatalf("same /64 not limited: %d", rec.Code)
	}
	if rec := loginFrom(h, "[2001:db8:9:a::1]:1", "a@b.c", "right-pw"); rec.Code != 200 {
		t.Fatalf("other /64: %d", rec.Code)
	}
}

func TestPublicLimitPerForwardedClient(t *testing.T) {
	e := newShareEnv(t)
	f := e.put(t, e.user, nodes.Space{}, nil, "a.txt", []byte("A"))
	tok := e.share(t, e.user, `{"node_id":"`+f.ID+`"}`)["token"].(string)
	e.s.publicLimit = auth.NewLimiter(3, time.Minute)
	// The SSR web container is a private peer forwarding the visitor.
	web := "172.18.0.5:40000"
	asA := map[string]string{"CF-Connecting-IP": "198.51.100.10"}
	asB := map[string]string{"CF-Connecting-IP": "198.51.100.20"}
	viaXFF := map[string]string{"X-Forwarded-For": "198.51.100.30"}
	// Client A burns its budget on junk tokens...
	for i := 0; i < 3; i++ {
		code(t, e.from(web, "GET", pubPath(strings.Repeat("Z", 43)), "", asA), 404, "not_found")
	}
	code(t, e.from(web, "GET", pubPath(tok), "", asA), 429, "rate_limited")
	// ...which costs B, a third client and the web peer's own address nothing.
	code(t, e.from(web, "GET", pubPath(tok), "", asB), 200, "")
	code(t, e.from(web, "GET", pubPath(tok), "", viaXFF), 200, "")
	code(t, e.from(web, "GET", pubPath(tok), "", nil), 200, "")
	// A public peer can't pick its address with the header.
	code(t, e.from("203.0.113.50:1", "GET", pubPath(tok), "", asA), 200, "")
}

func TestShareUnlockPerShareBudget(t *testing.T) {
	e := newShareEnv(t)
	f := e.put(t, e.user, nodes.Space{}, nil, "a.txt", []byte("A"))
	tok := e.share(t, e.user, `{"node_id":"`+f.ID+`","password":"right-pass"}`)["token"].(string)
	other := e.share(t, e.user, `{"node_id":"`+f.ID+`","password":"right-pass"}`)["token"].(string)
	e.s.shareFail = auth.NewLimiter(3, time.Hour)
	// A success doesn't reset (or use up) the budget.
	code(t, e.from("198.51.100.1:1", "POST", pubPath(tok)+"/unlock", `{"password":"right-pass"}`, nil), 204, "")
	// Wrong guesses from three different addresses use up the link's budget.
	for i, ip := range []string{"198.51.100.2:1", "198.51.100.3:1", "[2001:db8::1]:1"} {
		if rec := e.from(ip, "POST", pubPath(tok)+"/unlock", `{"password":"nope"}`, nil); rec.Code != 403 {
			t.Fatalf("guess %d: %d", i, rec.Code)
		}
	}
	// Now everyone is refused on this link, even with the right password...
	code(t, e.from("198.51.100.9:1", "POST", pubPath(tok)+"/unlock", `{"password":"right-pass"}`, nil), 429, "too_many_attempts")
	// ...but other links are unaffected, and the window passing reopens it.
	code(t, e.from("198.51.100.9:1", "POST", pubPath(other)+"/unlock", `{"password":"right-pass"}`, nil), 204, "")
	e.s.shareFail = auth.NewLimiterClock(3, time.Hour, func() time.Time { return time.Now().Add(2 * time.Hour) })
	code(t, e.from("198.51.100.9:1", "POST", pubPath(tok)+"/unlock", `{"password":"right-pass"}`, nil), 204, "")
}

func TestShareUnlockKeysSeparateFromLogin(t *testing.T) {
	e := newShareEnv(t)
	f := e.put(t, e.user, nodes.Space{}, nil, "a.txt", []byte("A"))
	tok := e.share(t, e.user, `{"node_id":"`+f.ID+`","password":"right-pass"}`)["token"].(string)
	// Exhaust the per-IP login bucket from one address.
	for i := 0; i < 30; i++ {
		e.s.ipLimit.Attempt("ip|198.51.100.77")
	}
	code(t, e.from("198.51.100.77:1", "POST", pubPath(tok)+"/unlock", `{"password":"right-pass"}`, nil), 204, "")
}

func TestSharePasswordMinLength(t *testing.T) {
	e := newShareEnv(t)
	f := e.put(t, e.user, nodes.Space{}, nil, "a.txt", []byte("A"))
	code(t, e.do(t, &e.user, "POST", "/api/shares", `{"node_id":"`+f.ID+`","password":"1234567"}`), 400, "password_too_short")
	sh := e.share(t, e.user, `{"node_id":"`+f.ID+`","password":"12345678"}`)
	code(t, e.do(t, &e.user, "PATCH", "/api/shares/"+sh["id"].(string), `{"password":"short"}`), 400, "password_too_short")
	// A link made before the rule, with a 4-character password, still opens.
	h, _ := auth.HashPassword("abcd")
	e.db.Exec(`UPDATE shares SET password_hash=? WHERE id=?`, h, sh["id"])
	code(t, e.pub("POST", pubPath(sh["token"].(string))+"/unlock", `{"password":"abcd"}`), 204, "")
}

func TestShareMutationsRequireJSON(t *testing.T) {
	e := newShareEnv(t)
	f := e.put(t, e.user, nodes.Space{}, nil, "a.txt", []byte("A"))
	sh := e.share(t, e.user, `{"node_id":"`+f.ID+`","password":"right-pass"}`)
	send := func(method, path, body, ctype string, as bool) int {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if ctype != "" {
			req.Header.Set("Content-Type", ctype)
		}
		if as {
			tok, _ := auth.NewSession(context.Background(), e.db, e.user.ID, time.Hour)
			req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: tok})
		}
		rec := httptest.NewRecorder()
		e.h.ServeHTTP(rec, req)
		return rec.Code
	}
	for _, ct := range []string{"", "text/plain", "application/x-www-form-urlencoded"} {
		if c := send("POST", "/api/shares", `{"node_id":"`+f.ID+`"}`, ct, true); c != 415 {
			t.Fatalf("create %q: %d", ct, c)
		}
		if c := send("PATCH", "/api/shares/"+sh["id"].(string), `{"revoked":true}`, ct, true); c != 415 {
			t.Fatalf("patch %q: %d", ct, c)
		}
		if c := send("POST", pubPath(sh["token"].(string))+"/unlock", `{"password":"right-pass"}`, ct, false); c != 415 {
			t.Fatalf("unlock %q: %d", ct, c)
		}
	}
	if c := send("POST", "/api/shares", `{"node_id":"`+f.ID+`"}`, "application/json; charset=utf-8", true); c != 201 {
		t.Fatalf("json with charset: %d", c)
	}
}

func TestPublicZipOnePerClient(t *testing.T) {
	e := newShareEnv(t)
	d := e.folder(t, e.user, nodes.Space{}, nil, "d")
	tok := e.share(t, e.user, `{"node_id":"`+d.ID+`"}`)["token"].(string)
	e.s.zipByIP["203.0.113.7"] = 1 // e.pub's address has a zip running
	code(t, e.pub("GET", pubPath(tok)+"/zip", ""), 503, "busy")
	code(t, e.from("198.51.100.4:1", "GET", pubPath(tok)+"/zip", "", nil), 200, "")
	delete(e.s.zipByIP, "203.0.113.7")
	code(t, e.pub("GET", pubPath(tok)+"/zip", ""), 200, "")
	if len(e.s.zipByIP) != 0 || len(e.s.zipSlots) != 0 {
		t.Fatalf("zip accounting leaked: %v %d", e.s.zipByIP, len(e.s.zipSlots))
	}
}

func TestPublicFolderTotalCached(t *testing.T) {
	e := newShareEnv(t)
	d := e.folder(t, e.user, nodes.Space{}, nil, "d")
	e.put(t, e.user, nodes.Space{}, &d.ID, "a.txt", []byte("AAA"))
	tok := e.share(t, e.user, `{"node_id":"`+d.ID+`"}`)["token"].(string)
	size := func() any { return jsonBody(t, e.pub("GET", pubPath(tok), ""))["size"] }
	if s := size(); s != float64(3) {
		t.Fatalf("size %v", s)
	}
	e.put(t, e.user, nodes.Space{}, &d.ID, "b.txt", []byte("BB"))
	if s := size(); s != float64(3) {
		t.Fatalf("not cached: %v", s)
	}
	e.clock = e.clock.Add(61 * time.Second)
	if s := size(); s != float64(5) {
		t.Fatalf("not refreshed: %v", s)
	}
}

func TestShareAncestorMovedIntoOthersPersonalSpace(t *testing.T) {
	e := newShareEnv(t)
	ctx := context.Background()
	dir := e.folder(t, e.other, nodes.Space{}, nil, "team")
	sub := e.folder(t, e.other, nodes.Space{}, &dir.ID, "sub")
	f := e.put(t, e.other, nodes.Space{}, &sub.ID, "a.txt", []byte("A"))
	fileTok := e.share(t, e.user, `{"node_id":"`+f.ID+`"}`)["token"].(string)
	dirTok := e.share(t, e.user, `{"node_id":"`+sub.ID+`"}`)["token"].(string)
	code(t, e.pub("GET", pubPath(fileTok)+"/download", ""), 200, "")
	// The other user moves the top folder into their personal space.
	if _, err := nodes.MoveTo(ctx, e.db, e.other, dir.ID, &nodes.Space{Owner: &e.other.ID}, nil); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{pubPath(fileTok), pubPath(fileTok) + "/download", pubPath(dirTok) + "/children",
		pubPath(dirTok) + "/zip", pubPath(dirTok) + "/download?node=" + f.ID} {
		rec := e.pub("GET", p, "")
		if rec.Code != 410 && rec.Code != 404 {
			t.Fatalf("%s: %d %s", p, rec.Code, rec.Body)
		}
	}
}
