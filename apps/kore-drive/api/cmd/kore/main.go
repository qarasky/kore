package main

import (
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"

	"github.com/artchsh/kore/api/internal/config"
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

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	addr := net.JoinHostPort(cfg.Bind, strconv.Itoa(cfg.Port))
	log.Printf("kore listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
