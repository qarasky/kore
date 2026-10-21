package main

import (
	"context"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/config"
	"github.com/artchsh/kore/api/internal/httpapi"
	"github.com/artchsh/kore/api/internal/store"
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
	handler := httpapi.New(db)

	addr := net.JoinHostPort(cfg.Bind, strconv.Itoa(cfg.Port))
	log.Printf("kore listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, handler))
}
