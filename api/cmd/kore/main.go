package main

import (
	"flag"
	"log"
	"net"
	"net/http"
	"strconv"

	"github.com/artchsh/kore/api/internal/config"
)

func main() {
	path := flag.String("config", "kore.toml", "path to config file")
	flag.Parse()

	cfg, err := config.Load(*path)
	if err != nil {
		log.Fatalf("config: %v", err)
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
