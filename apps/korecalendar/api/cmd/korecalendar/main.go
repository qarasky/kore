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

	"github.com/qarasky/korecalendar/api/internal/config"
	"github.com/qarasky/korecalendar/api/internal/events"
	"github.com/qarasky/korecalendar/api/internal/httpapi"
	"github.com/qarasky/korecalendar/api/internal/push"
	"github.com/qarasky/korecalendar/api/internal/reminders"
	"github.com/qarasky/korecalendar/api/internal/store"
	"github.com/qarasky/korecalendar/api/internal/volume"
)

const usage = `usage:
  korecalendar [-config korecal.toml]          serve the API
  korecalendar init [-config korecal.toml]     initialize the data volume (writes the marker)
  korecalendar healthcheck [-config korecal.toml | -url URL]
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
	fs := flag.NewFlagSet("korecalendar "+cmd, flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() { fmt.Fprint(stderr, usage) }
	defaultPath := "korecal.toml"
	if v := os.Getenv("KORECAL_CONFIG"); v != "" {
		defaultPath = v
	}
	path := fs.String("config", defaultPath, "path to config file (default: $KORECAL_CONFIG or korecal.toml)")
	var url *string
	switch cmd {
	case "serve", "init":
	case "healthcheck":
		url = fs.String("url", "", "health URL (default: derived from the config's bind and port)")
	case "help":
		fmt.Fprint(stderr, usage)
		return 0
	default:
		fmt.Fprintf(stderr, "korecalendar: unknown command %q\n%s", cmd, usage)
		return 2
	}
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if fs.NArg() > 0 {
		fmt.Fprintf(stderr, "korecalendar: unexpected argument %q\n%s", fs.Arg(0), usage)
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

func newServer(addr string, h http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
}

func serve(ctx context.Context, cfg config.Config, logger *log.Logger) error {
	return serveWith(ctx, cfg, logger, nil)
}

// background starts the reminder scheduler and the hourly purge of events
// deleted more than 30 days ago. The returned stop cancels them and waits.
func background(ctx context.Context, db *sql.DB, cfg config.Config, logger *log.Logger) (stop func(), err error) {
	web, err := push.New(db)
	if err != nil {
		return nil, fmt.Errorf("web push: %w", err)
	}
	if strings.HasPrefix(cfg.PublicURL, "https://") {
		web.Subscriber = cfg.PublicURL
	}
	sched := reminders.NewScheduler(db, []reminders.Channel{web}, time.Now)
	bg, cancel := context.WithCancel(ctx)
	var wg sync.WaitGroup
	wg.Go(func() { sched.Run(bg) })
	wg.Go(func() {
		every(bg, time.Hour, func(ctx context.Context) {
			n, err := events.PurgeDeleted(ctx, db, time.Now().Add(-events.RestoreWindow))
			if err != nil && ctx.Err() == nil {
				logger.Printf("purge deleted events: %v", err)
			} else if n > 0 {
				logger.Printf("purged %d events deleted more than 30 days ago", n)
			}
		})
	})
	return func() { cancel(); wg.Wait() }, nil
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

// serveWith checks the volume, opens the store, starts the background work and
// serves until ctx is done, then stops everything and closes the database.
// onBackgroundStopped (tests only) runs once the background work has ended.
func serveWith(ctx context.Context, cfg config.Config, logger *log.Logger, onBackgroundStopped func()) error {
	if err := volume.Check(cfg.DataDir); err != nil {
		return fmt.Errorf("volume: %w", err)
	}
	db, err := store.Open(filepath.Join(cfg.DataDir, "korecal.db"))
	if err != nil {
		return fmt.Errorf("store: %w", err)
	}
	defer func() {
		if err := db.Close(); err != nil {
			logger.Printf("closing database: %v", err)
		}
	}()
	stop, err := background(ctx, db, cfg, logger)
	if err != nil {
		return err
	}
	defer func() {
		stop()
		if onBackgroundStopped != nil {
			onBackgroundStopped()
		}
	}()
	addr := net.JoinHostPort(cfg.Bind, strconv.Itoa(cfg.Port))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	logger.Printf("korecalendar listening on %s", addr)
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
