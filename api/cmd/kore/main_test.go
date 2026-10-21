package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// syncBuffer is a bytes.Buffer safe for a writer goroutine and a reader.
type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

func writeConfig(t *testing.T, dataDir string, port int, bind string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "kore.toml")
	body := fmt.Sprintf("port = %d\nbind = %q\ndata_dir = %q\nadmin_email = \"admin@x.io\"\nadmin_password = \"a-real-password-1\"\n", port, bind, dataDir)
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
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

func TestUnknownCommandExitsWithUsage(t *testing.T) {
	for _, args := range [][]string{{"intt"}, {"intt", "-config", "x.toml"}, {"init", "extra"}, {"-config", "x.toml", "stray"}, {"-nope"}} {
		var stderr bytes.Buffer
		if code := run(context.Background(), args, &stderr); code != 2 {
			t.Errorf("%v: exit %d, want 2", args, code)
		}
		if !strings.Contains(stderr.String(), "usage:") {
			t.Errorf("%v: no usage in %q", args, stderr.String())
		}
	}
	var stderr bytes.Buffer
	run(context.Background(), []string{"intt"}, &stderr)
	if !strings.Contains(stderr.String(), `unknown command "intt"`) {
		t.Errorf("stderr %q", stderr.String())
	}
}

func TestInitRequiresExistingParent(t *testing.T) {
	parent := t.TempDir()
	var stderr bytes.Buffer
	cfg := writeConfig(t, filepath.Join(parent, "missing", "kore"), 8080, "127.0.0.1")
	if code := run(context.Background(), []string{"init", "-config", cfg}, &stderr); code != 1 {
		t.Fatalf("init under missing parent: exit %d (%s)", code, stderr.String())
	}
	if _, err := os.Stat(filepath.Join(parent, "missing")); !os.IsNotExist(err) {
		t.Fatalf("parent was created: %v", err)
	}
	data := filepath.Join(parent, "kore")
	cfg = writeConfig(t, data, 8080, "127.0.0.1")
	if code := run(context.Background(), []string{"init", "-config", cfg}, &stderr); code != 0 {
		t.Fatalf("init: exit %d (%s)", code, stderr.String())
	}
	if st, err := os.Stat(filepath.Join(data, ".kore-volume")); err != nil || !st.Mode().IsRegular() {
		t.Fatalf("marker: %v", err)
	}
}

func TestHealthcheck(t *testing.T) {
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/healthz" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(status)
	}))
	defer srv.Close()
	hc := func(args ...string) int {
		var stderr bytes.Buffer
		return run(context.Background(), append([]string{"healthcheck"}, args...), &stderr)
	}
	if code := hc("-url", srv.URL+"/api/healthz"); code != 0 {
		t.Fatalf("healthy: exit %d", code)
	}
	// From the config: an unspecified bind address is probed on loopback.
	port := srv.Listener.Addr().(*net.TCPAddr).Port
	if code := hc("-config", writeConfig(t, t.TempDir(), port, "0.0.0.0")); code != 0 {
		t.Fatalf("healthy via config: exit %d", code)
	}
	status = http.StatusServiceUnavailable
	if code := hc("-url", srv.URL+"/api/healthz"); code != 1 {
		t.Fatalf("unhealthy: exit %d", code)
	}
	if code := hc("-url", fmt.Sprintf("http://127.0.0.1:%d/api/healthz", freePort(t))); code != 1 {
		t.Fatalf("down: exit %d", code)
	}
}

func TestNewServerTimeouts(t *testing.T) {
	s := newServer(":0", http.NotFoundHandler())
	if s.ReadHeaderTimeout != 10*time.Second || s.IdleTimeout != 120*time.Second {
		t.Fatalf("header/idle timeouts %v %v", s.ReadHeaderTimeout, s.IdleTimeout)
	}
	if s.ReadTimeout != 0 || s.WriteTimeout != 0 {
		t.Fatalf("global read/write timeouts would cut streams: %v %v", s.ReadTimeout, s.WriteTimeout)
	}
}

// Cancelling the context (SIGTERM) lets an in-flight request finish.
func TestServeUntilDrainsInFlight(t *testing.T) {
	started := make(chan struct{})
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		time.Sleep(300 * time.Millisecond)
		io.WriteString(w, "done")
	})
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	errc := make(chan error, 1)
	go func() {
		errc <- serveUntil(ctx, newServer("", h), ln, 5*time.Second, log.New(io.Discard, "", 0))
	}()
	type result struct {
		body string
		err  error
	}
	resc := make(chan result, 1)
	go func() {
		res, err := http.Get("http://" + ln.Addr().String() + "/")
		if err != nil {
			resc <- result{err: err}
			return
		}
		defer res.Body.Close()
		b, err := io.ReadAll(res.Body)
		resc <- result{string(b), err}
	}()
	<-started
	cancel()
	r := <-resc
	if r.err != nil || r.body != "done" {
		t.Fatalf("in-flight request: %q %v", r.body, r.err)
	}
	if err := <-errc; err != nil {
		t.Fatalf("serveUntil: %v", err)
	}
	if _, err := http.Get("http://" + ln.Addr().String() + "/"); err == nil {
		t.Fatal("still accepting after shutdown")
	}
}

func TestServeRefusesWithoutMarker(t *testing.T) {
	var stderr bytes.Buffer
	cfg := writeConfig(t, t.TempDir(), freePort(t), "127.0.0.1")
	if code := run(context.Background(), []string{"-config", cfg}, &stderr); code != 1 {
		t.Fatalf("exit %d", code)
	}
	if !strings.Contains(stderr.String(), ".kore-volume") {
		t.Fatalf("stderr %q", stderr.String())
	}
}

// The real server starts, answers the health check and exits 0 on cancel.
func TestServeAndShutdown(t *testing.T) {
	data := t.TempDir()
	port := freePort(t)
	cfg := writeConfig(t, data, port, "127.0.0.1")
	var stderr syncBuffer
	if code := run(context.Background(), []string{"init", "-config", cfg}, &stderr); code != 0 {
		t.Fatalf("init: %s", stderr.String())
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan int, 1)
	go func() { done <- run(ctx, []string{"-config", cfg}, &stderr) }()
	deadline := time.Now().Add(10 * time.Second)
	for run(context.Background(), []string{"healthcheck", "-config", cfg}, io.Discard) != 0 {
		if time.Now().After(deadline) {
			t.Fatalf("never healthy: %s", stderr.String())
		}
		time.Sleep(50 * time.Millisecond)
	}
	cancel()
	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("exit %d: %s", code, stderr.String())
		}
	case <-time.After(10 * time.Second):
		t.Fatal("did not shut down")
	}
	if !strings.Contains(stderr.String(), "shutting down") {
		t.Fatalf("stderr %q", stderr.String())
	}
}
