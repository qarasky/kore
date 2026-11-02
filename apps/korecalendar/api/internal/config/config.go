// Package config loads KoreCalendar's minimal TOML configuration.
package config

import (
	"errors"
	"fmt"
	"io/fs"
	"net"
	"os"
	"strconv"

	"github.com/pelletier/go-toml/v2"
)

// Config holds the settings read from the config file and environment.
type Config struct {
	Port      int    `toml:"port"`
	Bind      string `toml:"bind"`
	DataDir   string `toml:"data_dir"`
	PublicURL string `toml:"public_url"`
}

// Load reads and validates the config. The file at path is optional;
// KORECAL_PORT, KORECAL_BIND, KORECAL_DATA_DIR and KORECAL_PUBLIC_URL, when
// set and non-empty, override the file (this is how the Docker image is
// configured from .env).
func Load(path string) (Config, error) {
	c := Config{Port: 8080, Bind: "127.0.0.1"}
	b, err := os.ReadFile(path)
	switch {
	case err == nil:
		if err := toml.Unmarshal(b, &c); err != nil {
			return Config{}, fmt.Errorf("parse config: %w", err)
		}
	case !errors.Is(err, fs.ErrNotExist):
		return Config{}, fmt.Errorf("read config: %w", err)
	}
	if v := os.Getenv("KORECAL_PORT"); v != "" {
		p, err := strconv.Atoi(v)
		if err != nil {
			return Config{}, fmt.Errorf("invalid KORECAL_PORT %q", v)
		}
		c.Port = p
	}
	for env, dst := range map[string]*string{
		"KORECAL_BIND":       &c.Bind,
		"KORECAL_DATA_DIR":   &c.DataDir,
		"KORECAL_PUBLIC_URL": &c.PublicURL,
	} {
		if v := os.Getenv(env); v != "" {
			*dst = v
		}
	}
	if net.ParseIP(c.Bind) == nil {
		return Config{}, fmt.Errorf("invalid bind address %q", c.Bind)
	}
	if c.Port < 1 || c.Port > 65535 {
		return Config{}, fmt.Errorf("invalid port %d", c.Port)
	}
	if c.DataDir == "" {
		return Config{}, errors.New("data_dir is required (config file or KORECAL_DATA_DIR)")
	}
	return c, nil
}
