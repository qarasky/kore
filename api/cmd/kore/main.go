package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/qarasky/kore/api/internal/auth"
	"github.com/qarasky/kore/api/internal/config"
	"github.com/qarasky/kore/api/internal/httpapi"
	"github.com/qarasky/kore/api/internal/nodes"
	"github.com/qarasky/kore/api/internal/settings"
	"github.com/qarasky/kore/api/internal/store"
	"github.com/qarasky/kore/api/internal/uploads"
	"github.com/qarasky/kore/api/internal/volume"
)

const usage = `usage:
  kore [-config kore.toml]                 serve the API
  kore init [-config kore.toml]            initialize the data volume (marker, blobs/, tmp/uploads/)
  kore healthcheck [-config kore.toml | -url URL]
                                           exit 0 if GET /api/healthz returns 200
`

// shutdownGrace is how long in-flight requests get to finish on SIGTERM/SIGINT.
const shutdownGrace = 30 * time.Second

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()
	os.Exit(run(ctx, os.Args[1:], os.Stderr))
}

// run executes the command in args and returns the process exit code.
func run(ctx context.Context, args []string, stderr io.Writer) int {
	cmd := "serve"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		cmd, args = args[0], args[1:]
	}
	fs := flag.NewFlagSet("kore "+cmd, flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() { fmt.Fprint(stderr, usage) }
	defaultPath := "kore.toml"
	if v := os.Getenv("KORE_CONFIG"); v != "" {
		defaultPath = v
	}
	path := fs.String("config", defaultPath, "path to config file (default: $KORE_CONFIG or kore.toml)")
	var url *string
	switch cmd {
	case "serve", "init":
	case "healthcheck":
		url = fs.String("url", "", "health URL (default: derived from the config's bind and port)")
	case "help":
		fmt.Fprint(stderr, usage)
		return 0
	default:
		fmt.Fprintf(stderr, "kore: unknown command %q\n%s", cmd, usage)
		return 2
	}
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if fs.NArg() > 0 {
		fmt.Fprintf(stderr, "kore: unexpected argument %q\n%s", fs.Arg(0), usage)
		return 2
	}
	logger := log.New(stderr, "", log.LstdFlags)

	if cmd == "healthcheck" {
		if err := healthcheck(*path, *url); err != nil {
			fmt.Fprintf(stderr, "healthcheck: %v\n", err)
			return 1
		}
		return 0
	}
	cfg, err := config.Load(*path)
	if err != nil {
		logger.Printf("config: %v", err)
		return 1
	}
	if cmd == "init" {
		if err := volume.Init(cfg.DataDir); err != nil {
			logger.Printf("init: %v", err)
			return 1
		}
		logger.Printf("initialized volume at %s", cfg.DataDir)
		return 0
	}
	if err := serve(ctx, cfg, logger); err != nil {
		logger.Print(err)
		return 1
	}
	return 0
}

// healthcheck GETs the API's /api/healthz (for container health checks; the
// runtime image has no curl).
func healthcheck(path, url string) error {
	if url == "" {
		cfg, err := config.Load(path)
		if err != nil {
			return err
		}
		host := cfg.Bind
		if ip := net.ParseIP(host); ip != nil && ip.IsUnspecified() {
			host = "127.0.0.1"
			if ip.To4() == nil {
				host = "::1"
			}
		}
		url = "http://" + net.JoinHostPort(host, strconv.Itoa(cfg.Port)) + "/api/healthz"
	}
	c := http.Client{Timeout: 5 * time.Second}
	res, err := c.Get(url)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: status %d", url, res.StatusCode)
	}
	return nil
}

// newServer returns the API's http.Server. There is deliberately no global
// ReadTimeout/WriteTimeout: uploads and (zip) downloads stream for as long as
// they take; the chunk handler sets its own idle read deadline.
func newServer(addr string, h http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
}

// serve checks the volume, opens the store and serves until ctx is done,
// then shuts down gracefully and closes the database.
func serve(ctx context.Context, cfg config.Config, logger *log.Logger) error {
	if err := volume.Check(cfg.DataDir); err != nil {
		return fmt.Errorf("volume: %w", err)
	}
	db, err := store.Open(filepath.Join(cfg.DataDir, "kore.db"))
	if err != nil {
		return fmt.Errorf("store: %w", err)
	}
	defer func() {
		if err := db.Close(); err != nil {
			logger.Printf("closing database: %v", err)
		}
	}()
	if err := auth.Bootstrap(ctx, db, cfg); err != nil {
		return fmt.Errorf("bootstrap: %w", err)
	}

	bg, stopBg := context.WithCancel(ctx)
	var wg sync.WaitGroup
	wg.Go(func() { every(bg, time.Hour, func(ctx context.Context) { sweepUploads(ctx, db, cfg.DataDir, logger) }) })
	wg.Go(func() {
		every(bg, 24*time.Hour, func(ctx context.Context) { sweepTrash(ctx, db, cfg.DataDir, logger) })
	})
	defer func() { stopBg(); wg.Wait() }()

	addr := net.JoinHostPort(cfg.Bind, strconv.Itoa(cfg.Port))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	logger.Printf("kore listening on %s", addr)
	return serveUntil(ctx, newServer(addr, httpapi.New(db, cfg.DataDir)), ln, shutdownGrace, logger)
}

// serveUntil serves on ln until ctx is done, then stops accepting and waits
// up to grace for in-flight requests before closing what is left.
func serveUntil(ctx context.Context, srv *http.Server, ln net.Listener, grace time.Duration, logger *log.Logger) error {
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	logger.Printf("shutting down (waiting up to %s for in-flight requests)", grace)
	sctx, cancel := context.WithTimeout(context.Background(), grace)
	defer cancel()
	if err := srv.Shutdown(sctx); err != nil {
		logger.Printf("shutdown: %v; closing remaining connections", err)
		srv.Close()
	}
	if err := <-errc; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// every runs fn now and then every d until ctx is done.
func every(ctx context.Context, d time.Duration, fn func(context.Context)) {
	fn(ctx)
	t := time.NewTicker(d)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			fn(ctx)
		}
	}
}

// sweepUploads deletes upload sessions idle for 24h (freeing their quota
// reservations).
func sweepUploads(ctx context.Context, db *sql.DB, dataDir string, logger *log.Logger) {
	n, err := uploads.Sweep(ctx, db, dataDir, 24*time.Hour)
	if err != nil && ctx.Err() == nil {
		logger.Printf("upload sweep: %v", err)
	} else if n > 0 {
		logger.Printf("upload sweep: removed %d abandoned uploads", n)
	}
}

// sweepTrash purges expired trash and reclaims orphan blobs.
func sweepTrash(ctx context.Context, db *sql.DB, dataDir string, logger *log.Logger) {
	n, err := nodes.PurgeExpired(ctx, db, dataDir, settings.TrashRetentionDays(ctx, db))
	if err != nil && ctx.Err() == nil {
		logger.Printf("trash purge: %v", err)
	} else if n > 0 {
		logger.Printf("trash purge: removed %d expired items", n)
	}
	o, err := nodes.SweepOrphanBlobs(ctx, db, dataDir)
	if err != nil && ctx.Err() == nil {
		logger.Printf("orphan blob sweep: %v", err)
	} else if o > 0 {
		logger.Printf("orphan blob sweep: removed %d blobs", o)
	}
}
