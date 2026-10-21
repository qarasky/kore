package main

import (
	"context"
	"database/sql"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/config"
	"github.com/artchsh/kore/api/internal/httpapi"
	"github.com/artchsh/kore/api/internal/store"
	"github.com/artchsh/kore/api/internal/uploads"
	"github.com/artchsh/kore/api/internal/volume"
)

func main() {
	args := os.Args[1:]
	initCmd := len(args) > 0 && args[0] == "init"
	fs := flag.NewFlagSet("kore", flag.ExitOnError)
	path := fs.String("config", "kore.toml", "path to config file")
	if initCmd {
		args = args[1:]
	}
	fs.Parse(args)

	cfg, err := config.Load(*path)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	if initCmd {
		if err := volume.Init(cfg.DataDir); err != nil {
			log.Fatalf("init: %v", err)
		}
		log.Printf("initialized volume at %s", cfg.DataDir)
		return
	}
	if err := volume.Check(cfg.DataDir); err != nil {
		log.Fatalf("volume: %v", err)
	}

	db, err := store.Open(filepath.Join(cfg.DataDir, "kore.db"))
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer db.Close()
	if err := auth.Bootstrap(context.Background(), db, cfg); err != nil {
		log.Fatalf("bootstrap: %v", err)
	}
	handler := httpapi.New(db, cfg.DataDir)
	go sweepUploads(db, cfg.DataDir)

	addr := net.JoinHostPort(cfg.Bind, strconv.Itoa(cfg.Port))
	log.Printf("kore listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, handler))
}

// sweepUploads deletes upload sessions idle for 24h (freeing their quota
// reservations), once at startup and then hourly.
func sweepUploads(db *sql.DB, dataDir string) {
	const idle = 24 * time.Hour
	run := func() {
		n, err := uploads.Sweep(context.Background(), db, dataDir, idle)
		if err != nil {
			log.Printf("upload sweep: %v", err)
		} else if n > 0 {
			log.Printf("upload sweep: removed %d abandoned uploads", n)
		}
	}
	run()
	for range time.Tick(time.Hour) {
		run()
	}
}
