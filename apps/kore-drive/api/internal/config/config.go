// Package config loads Kore's minimal TOML configuration file.
package config

import (
	"errors"
	"fmt"
	"net"
	"os"

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

// Load reads and validates the config file at path.
func Load(path string) (Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("read config: %w", err)
	}
	c := Config{Port: 8080, Bind: "127.0.0.1"}
	if err := toml.Unmarshal(b, &c); err != nil {
		return Config{}, fmt.Errorf("parse config: %w", err)
	}
	if net.ParseIP(c.Bind) == nil {
		return Config{}, fmt.Errorf("invalid bind address %q", c.Bind)
	}
	if c.Port < 1 || c.Port > 65535 {
		return Config{}, fmt.Errorf("invalid port %d", c.Port)
	}
	if c.DataDir == "" {
		return Config{}, errors.New("data_dir is required")
	}
	if c.AdminEmail == "" {
		return Config{}, errors.New("admin_email is required")
	}
	if c.AdminPassword == "" {
		return Config{}, errors.New("admin_password is required")
	}
	return c, nil
}
