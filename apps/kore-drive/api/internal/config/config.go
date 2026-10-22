// Package config loads Kore's minimal TOML configuration file.
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

// Config holds the settings read from the config file.
type Config struct {
	Port          int    `toml:"port"`
	Bind          string `toml:"bind"`
	DataDir       string `toml:"data_dir"`
	AdminEmail    string `toml:"admin_email"`
	AdminPassword string `toml:"admin_password"`
}

// Load reads and validates the config. The file at path is optional (it may
// be missing when everything comes from the environment); KORE_PORT,
// KORE_BIND, KORE_DATA_DIR, KORE_ADMIN_EMAIL and KORE_ADMIN_PASSWORD, when
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
	if v := os.Getenv("KORE_PORT"); v != "" {
		p, err := strconv.Atoi(v)
		if err != nil {
			return Config{}, fmt.Errorf("invalid KORE_PORT %q", v)
		}
		c.Port = p
	}
	for env, dst := range map[string]*string{
		"KORE_BIND":           &c.Bind,
		"KORE_DATA_DIR":       &c.DataDir,
		"KORE_ADMIN_EMAIL":    &c.AdminEmail,
		"KORE_ADMIN_PASSWORD": &c.AdminPassword,
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
		return Config{}, errors.New("data_dir is required (config file or KORE_DATA_DIR)")
	}
	if c.AdminEmail == "" {
		return Config{}, errors.New("admin_email is required (config file or KORE_ADMIN_EMAIL)")
	}
	if c.AdminPassword == "" {
		return Config{}, errors.New("admin_password is required (config file or KORE_ADMIN_PASSWORD)")
	}
	return c, nil
}
