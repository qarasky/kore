package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeConfig(t *testing.T, dataDir string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "korecal.toml")
	body := "data_dir = \"" + dataDir + "\"\nbind = \"127.0.0.1\"\nport = 18080\n"
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestServeRefusesWithoutMarker(t *testing.T) {
	var stderr bytes.Buffer
	code := run(context.Background(), []string{"-config", writeConfig(t, t.TempDir())}, &stderr)
	if code == 0 {
		t.Fatal("serve succeeded without a volume marker")
	}
	if !strings.Contains(stderr.String(), "korecalendar init") {
		t.Fatalf("stderr %q does not mention `korecalendar init`", stderr.String())
	}
}

func TestInitThenHealthcheckFailsWhenNothingListens(t *testing.T) {
	dir := t.TempDir()
	var stderr bytes.Buffer
	cfg := writeConfig(t, dir)
	if code := run(context.Background(), []string{"init", "-config", cfg}, &stderr); code != 0 {
		t.Fatalf("init exit %d: %s", code, stderr.String())
	}
	if code := run(context.Background(), []string{"healthcheck", "-url", "http://127.0.0.1:1/api/healthz"}, &stderr); code == 0 {
		t.Fatal("healthcheck passed with nothing listening")
	}
}
