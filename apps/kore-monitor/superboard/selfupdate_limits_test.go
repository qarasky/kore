package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAssetNamesCannotLeaveTheUpdateDirectory(t *testing.T) {
	for _, bad := range []string{"../superboard", "/usr/local/bin/superboard", "a/b", `a\b`, "..", ".", ""} {
		if err := checkAssetName(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	for _, ok := range []string{"superboard-linux-amd64", "superboard_1.9.0_arm64"} {
		if err := checkAssetName(ok); err != nil {
			t.Errorf("%q refused: %v", ok, err)
		}
	}
}

func TestDownloadRefusesABadNameBeforeFetching(t *testing.T) {
	fetched := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fetched = true }))
	defer server.Close()
	cfg := &Config{ServerURL: server.URL, AllowInsecure: true, PushToken: "tok"}
	err := downloadAsset(context.Background(), cfg, &updateAsset{File: "../evil", SHA256: "00"}, filepath.Join(t.TempDir(), "x"))
	if err == nil || fetched {
		t.Fatalf("err=%v fetched=%v", err, fetched)
	}
}

func TestDownloadStopsAtTheSizeLimit(t *testing.T) {
	old := maxAgentDownload
	maxAgentDownload = 1024
	defer func() { maxAgentDownload = old }()
	body := []byte(strings.Repeat("x", 4096))
	sum := sha256.Sum256(body)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(body) }))
	defer server.Close()
	dest := filepath.Join(t.TempDir(), "superboard-test")
	cfg := &Config{ServerURL: server.URL, AllowInsecure: true, PushToken: "tok"}
	if err := downloadAsset(context.Background(), cfg, &updateAsset{File: "superboard-test", SHA256: hex.EncodeToString(sum[:])}, dest); err == nil {
		t.Fatal("an oversized download must fail")
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Fatal("nothing may be left in place")
	}
}

func TestDownloadChecksTheAdvertisedSize(t *testing.T) {
	body := []byte("superboard fake binary")
	sum := sha256.Sum256(body)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(body) }))
	defer server.Close()
	cfg := &Config{ServerURL: server.URL, AllowInsecure: true, PushToken: "tok"}
	asset := &updateAsset{File: "superboard-test", SHA256: hex.EncodeToString(sum[:]), Size: int64(len(body)) + 1}
	if err := downloadAsset(context.Background(), cfg, asset, filepath.Join(t.TempDir(), "superboard-test")); err == nil {
		t.Fatal("a size that does not match the manifest must fail")
	}
}
