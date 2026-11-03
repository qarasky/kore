package oidc_test

import (
	"net/http"
	"strings"
)

// redirectTo returns a client that sends every request meant for `to` to `from`
// instead, so discovery for one issuer is answered by another provider.
func redirectTo(from, to string) *http.Client {
	return &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		u := strings.Replace(r.URL.String(), to, from, 1)
		req, _ := http.NewRequestWithContext(r.Context(), r.Method, u, r.Body)
		return http.DefaultTransport.RoundTrip(req)
	})}
}

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
