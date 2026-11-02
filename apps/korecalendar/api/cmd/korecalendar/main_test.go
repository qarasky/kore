package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/qarasky/korecalendar/api/internal/calendars"
	"github.com/qarasky/korecalendar/api/internal/config"
	"github.com/qarasky/korecalendar/api/internal/events"
	"github.com/qarasky/korecalendar/api/internal/store"
	"github.com/qarasky/korecalendar/api/internal/users"
	"github.com/qarasky/korecalendar/api/internal/volume"
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

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

func waitFor(t *testing.T, what string, timeout time.Duration, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// The scheduler and the purge run in the background of serve, and both stop
// (before the database closes) when the context is cancelled.
func TestServeStartsBackgroundWorkAndStopsOnCancel(t *testing.T) {
	dir := t.TempDir()
	if err := volume.Init(dir); err != nil {
		t.Fatal(err)
	}
	// An event deleted 40 days ago, which the purge should remove.
	seed, err := store.Open(filepath.Join(dir, "korecal.db"))
	if err != nil {
		t.Fatal(err)
	}
	u, _ := users.Create(context.Background(), seed, "a@example.com", "x", "admin")
	calendars.CreateDefault(context.Background(), seed, u.ID)
	e, err := events.Create(context.Background(), seed, events.Actor{UserID: u.ID, Label: "user"}, events.Input{Title: "old", Start: "2026-01-01T09:00:00", TZ: "UTC"})
	if err != nil {
		t.Fatal(err)
	}
	seed.Exec(`UPDATE events SET deleted_at=? WHERE id=?`, time.Now().Add(-40*24*time.Hour).Unix(), e.ID)
	seed.Close()

	port := freePort(t)
	cfg := config.Config{Port: port, Bind: "127.0.0.1", DataDir: dir}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stopped := make(chan struct{})
	errc := make(chan error, 1)
	go func() {
		errc <- serveWith(ctx, cfg, log.New(io.Discard, "", 0), func() { close(stopped) })
	}()
	url := fmt.Sprintf("http://127.0.0.1:%d/api/healthz", port)
	waitFor(t, "the server to answer", 5*time.Second, func() bool {
		res, err := http.Get(url)
		if err != nil {
			return false
		}
		res.Body.Close()
		return res.StatusCode == 200
	})
	check, err := store.Open(filepath.Join(dir, "korecal.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	waitFor(t, "the reminder scheduler to record its cursor", 5*time.Second, func() bool {
		var n int
		check.QueryRow(`SELECT count(*) FROM settings WHERE key='reminders.cursor'`).Scan(&n)
		return n == 1
	})
	waitFor(t, "the purge to remove the old deleted event", 5*time.Second, func() bool {
		var n int
		check.QueryRow(`SELECT count(*) FROM events`).Scan(&n)
		return n == 0
	})
	var vapid int
	check.QueryRow(`SELECT count(*) FROM settings WHERE key IN ('vapid.private','vapid.public')`).Scan(&vapid)
	if vapid != 2 {
		t.Fatalf("push channel was not set up (%d vapid keys)", vapid)
	}

	cancel()
	select {
	case err := <-errc:
		if err != nil {
			t.Fatalf("serve returned %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("serve did not stop after cancel")
	}
	select {
	case <-stopped:
	default:
		t.Fatal("background work was still running when serve returned")
	}
}
