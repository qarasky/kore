package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

const secretToken = "s3cr3t-push-token_ABC"

// A server that accepts the connection and drops it, so the HTTP client fails
// with a *url.Error, whose text includes the request URL.
func droppingServer(t *testing.T) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, _, err := w.(http.Hijacker).Hijack()
		if err == nil {
			conn.Close()
		}
	}))
	t.Cleanup(server.Close)
	return server.URL
}

func TestPushErrorsDoNotCarryTheToken(t *testing.T) {
	cfg := &Config{ServerURL: droppingServer(t), PushToken: secretToken, IntervalSeconds: 60, AllowInsecure: true}
	err := newPushClient(cfg).push(&Payload{V: 1})
	if err == nil {
		t.Fatal("want an error from a dropped connection")
	}
	if strings.Contains(err.Error(), secretToken) {
		t.Fatalf("push error leaks the token: %v", err)
	}
	var nerr net.Error
	_ = errors.As(err, &nerr) // the original error stays reachable for callers
}

func TestUpdateErrorsDoNotCarryTheToken(t *testing.T) {
	cfg := &Config{ServerURL: droppingServer(t), PushToken: secretToken, AllowInsecure: true}
	if _, err := fetchManifest(context.Background(), cfg); err == nil || strings.Contains(err.Error(), secretToken) {
		t.Fatalf("manifest error: %v", err)
	}
	err := downloadAsset(context.Background(), cfg, &updateAsset{File: "superboard-x", SHA256: "00"}, filepath.Join(t.TempDir(), "x"))
	if err == nil || strings.Contains(err.Error(), secretToken) {
		t.Fatalf("download error: %v", err)
	}
}

func TestRedactTokenKeepsTheRestOfTheMessage(t *testing.T) {
	err := redactToken(errors.New(`Post "https://m.example/api/push/`+secretToken+`?telemetry=1": EOF`), secretToken)
	if strings.Contains(err.Error(), secretToken) || !strings.Contains(err.Error(), "/api/push/<token>") || !strings.Contains(err.Error(), "EOF") {
		t.Fatalf("got %q", err)
	}
	if redactToken(nil, secretToken) != nil {
		t.Fatal("nil stays nil")
	}
}
