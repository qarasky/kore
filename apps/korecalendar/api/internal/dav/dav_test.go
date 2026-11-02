package dav_test

import (
	"bytes"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/testsrv"
)

type resp struct {
	status int
	hdr    http.Header
	body   string
}

// raw sends a request with any method; a non-empty user means HTTP Basic.
func raw(t *testing.T, srv *httptest.Server, user, pass, method, path, body string, hdr ...string) resp {
	t.Helper()
	req, err := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if user != "" || pass != "" {
		req.SetBasicAuth(user, pass)
	}
	if body != "" && strings.HasPrefix(body, "<?xml") {
		req.Header.Set("Content-Type", "application/xml")
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return resp{res.StatusCode, res.Header, string(b)}
}

type account struct{ id, email, session, token string }

// accessToken creates a named access token for the session's user.
func accessToken(t *testing.T, srv *httptest.Server, session, name string) (id, secret string) {
	t.Helper()
	r := testsrv.Do(t, srv, session, "POST", "/api/tokens", map[string]string{"name": name})
	var out struct{ ID, Token string }
	r.Decode(t, &out)
	if out.Token == "" {
		t.Fatalf("no token: %d %s", r.Status, r.Body)
	}
	return out.ID, out.Token
}

func userID(t *testing.T, srv *httptest.Server, session string) string {
	t.Helper()
	var me struct{ ID string }
	testsrv.Do(t, srv, session, "GET", "/api/me", nil).Decode(t, &me)
	return me.ID
}

// two returns the admin and a second user, each with an access token.
func two(t *testing.T) (*httptest.Server, account, account) {
	t.Helper()
	srv, _ := testsrv.New(t)
	adminSession := testsrv.Login(t, srv)
	bSession := testsrv.AddUser(t, srv, adminSession, "bea@example.com")
	_, at := accessToken(t, srv, adminSession, "agent")
	_, bt := accessToken(t, srv, bSession, "bea-agent")
	a := account{userID(t, srv, adminSession), testsrv.AdminEmail, adminSession, at}
	b := account{userID(t, srv, bSession), "bea@example.com", bSession, bt}
	return srv, a, b
}

const principalProp = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`

func TestWellKnownRedirectsWithoutCredentials(t *testing.T) {
	srv, _, _ := two(t)
	c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := c.Get(srv.URL + "/.well-known/caldav")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 301 || res.Header.Get("Location") != "/dav/" {
		t.Fatalf("got %d %q", res.StatusCode, res.Header.Get("Location"))
	}
}

func TestUnauthenticatedIs401WithChallenge(t *testing.T) {
	srv, a, _ := two(t)
	r := raw(t, srv, "", "", "PROPFIND", "/dav/", principalProp, "Depth", "0")
	if r.status != 401 || !strings.HasPrefix(r.hdr.Get("WWW-Authenticate"), `Basic realm="KoreCalendar"`) {
		t.Fatalf("got %d %q", r.status, r.hdr.Get("WWW-Authenticate"))
	}
	if strings.Contains(r.body, a.id) || strings.Contains(r.body, a.email) {
		t.Fatalf("the challenge leaks data: %s", r.body)
	}
}

func TestOnlyAnAccessTokenIsAPassword(t *testing.T) {
	srv, a, b := two(t)
	ok := raw(t, srv, a.email, a.token, "PROPFIND", "/dav/", principalProp, "Depth", "0")
	if ok.status != 207 || !strings.Contains(ok.body, "/dav/"+a.id+"/") {
		t.Fatalf("token should work: %d %s", ok.status, ok.body)
	}
	revokedID, revoked := accessToken(t, srv, a.session, "temp")
	testsrv.Do(t, srv, a.session, "DELETE", "/api/tokens/"+revokedID, nil)
	cases := map[string]resp{
		"account password": raw(t, srv, a.email, testsrv.AdminPassword, "PROPFIND", "/dav/", principalProp, "Depth", "0"),
		"session token":    raw(t, srv, a.email, a.session, "PROPFIND", "/dav/", principalProp, "Depth", "0"),
		"revoked token":    raw(t, srv, a.email, revoked, "PROPFIND", "/dav/", principalProp, "Depth", "0"),
		"other user email": raw(t, srv, b.email, a.token, "PROPFIND", "/dav/", principalProp, "Depth", "0"),
		"empty password":   raw(t, srv, a.email, "", "PROPFIND", "/dav/", principalProp, "Depth", "0"),
		"session cookie":   raw(t, srv, "", "", "PROPFIND", "/dav/", principalProp, "Depth", "0", "Cookie", "korecal_session="+a.session),
	}
	for name, r := range cases {
		if r.status != 401 || r.hdr.Get("WWW-Authenticate") == "" {
			t.Errorf("%s: got %d, want 401 with a challenge", name, r.status)
		}
	}
	// the email is matched without regard to case
	if r := raw(t, srv, strings.ToUpper(a.email), a.token, "PROPFIND", "/dav/", principalProp, "Depth", "0"); r.status != 207 {
		t.Errorf("upper-case email: %d", r.status)
	}
}

func TestOptionsAdvertisesCalendarAccess(t *testing.T) {
	srv, a, _ := two(t)
	r := raw(t, srv, a.email, a.token, "OPTIONS", "/dav/"+a.id+"/calendars/", "")
	if (r.status != 200 && r.status != 204) || !strings.Contains(r.hdr.Get("DAV"), "calendar-access") {
		t.Fatalf("got %d DAV=%q", r.status, r.hdr.Get("DAV"))
	}
}

func TestAnotherUsersPathIs404ForEveryMethod(t *testing.T) {
	srv, a, b := two(t)
	paths := []string{"/dav/" + b.id + "/", "/dav/" + b.id + "/calendars/", "/dav/" + b.id + "/calendars/abc/x.ics"}
	for _, p := range paths {
		for _, m := range []string{"PROPFIND", "REPORT", "GET", "HEAD", "PUT", "DELETE", "OPTIONS", "MKCOL"} {
			r := raw(t, srv, a.email, a.token, m, p, "", "Content-Type", "text/calendar")
			if r.status != 404 {
				t.Errorf("%s %s: %d, want 404 (never 403)", m, p, r.status)
			}
		}
	}
}

func TestFailedLoginsAreRateLimited(t *testing.T) {
	srv, a, b := two(t)
	var last resp
	for i := 0; i < 6; i++ {
		last = raw(t, srv, a.email, "kcal_wrong", "PROPFIND", "/dav/", principalProp, "Depth", "0")
		if i < 5 && last.status != 401 {
			t.Fatalf("attempt %d: %d", i, last.status)
		}
	}
	if last.status != 429 || last.hdr.Get("Retry-After") == "" {
		t.Fatalf("6th attempt: %d Retry-After=%q", last.status, last.hdr.Get("Retry-After"))
	}
	if r := raw(t, srv, b.email, b.token, "PROPFIND", "/dav/", principalProp, "Depth", "0"); r.status != 207 {
		t.Fatalf("another account is locked out too: %d", r.status)
	}
}

func TestSuccessfulRequestsDoNotUseUpTheBudget(t *testing.T) {
	srv, a, _ := two(t)
	for i := 0; i < 80; i++ { // a client sends credentials on every request
		if r := raw(t, srv, a.email, a.token, "PROPFIND", "/dav/", principalProp, "Depth", "0"); r.status != 207 {
			t.Fatalf("request %d: %d", i, r.status)
		}
	}
}

func TestBodyOverFiveMiBIs413(t *testing.T) {
	srv, a, _ := two(t)
	big := strings.Repeat("x", 6<<20)
	r := raw(t, srv, a.email, a.token, "PUT", "/dav/"+a.id+"/calendars/abc/x.ics", big, "Content-Type", "text/calendar")
	if r.status != 413 {
		t.Fatalf("got %d", r.status)
	}
}

func TestNothingSecretInTheLog(t *testing.T) {
	srv, a, _ := two(t)
	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(io.Discard)
	raw(t, srv, a.email, "kcal_supersecretvalue", "PROPFIND", "/dav/", principalProp, "Depth", "0")
	raw(t, srv, a.email, a.token, "PROPFIND", "/dav/", principalProp, "Depth", "0")
	if s := buf.String(); strings.Contains(s, "supersecretvalue") || strings.Contains(s, a.token) {
		t.Fatalf("a credential reached the log: %s", s)
	}
}
