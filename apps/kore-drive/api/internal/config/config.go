// Package config loads Kore's minimal TOML configuration file.
package config

import (
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/pelletier/go-toml/v2"
)

// Config holds the settings read from the config file.
type Config struct {
	Port          int    `toml:"port"`
	Bind          string `toml:"bind"`
	DataDir       string `toml:"data_dir"`
	AdminEmail    string `toml:"admin_email"`
	AdminPassword string `toml:"admin_password"`

	// PublicURL is the externally visible base URL of Kore (scheme + host,
	// e.g. https://kore.example.com). Required for Kore ID: the OIDC redirect
	// URI is PublicURL + "/api/auth/oidc/callback".
	PublicURL string `toml:"public_url"`
	// LocalLogin enables email + password login (default true). Set false to
	// make Kore ID the only way in; needs [oidc] to be configured.
	LocalLogin *bool `toml:"local_login"`
	OIDC       OIDC  `toml:"oidc"`
}

// OIDC configures login with Kore ID (any OpenID Connect provider with
// authorization-code + PKCE S256 and EdDSA-signed tokens). Enabled when
// Issuer is set.
type OIDC struct {
	Issuer       string `toml:"issuer"`
	ClientID     string `toml:"client_id"`
	ClientSecret string `toml:"client_secret"`
	// LinkByEmail lets a first Kore ID login adopt the existing, not yet
	// linked local account with the same email, but only when the token says
	// email_verified = true (default true). Set false to require linking by
	// hand (Account page or "kore link").
	LinkByEmail *bool `toml:"link_by_email"`
	// AutoProvision creates a local account on first login (default true).
	AutoProvision *bool `toml:"auto_provision"`
}

// Enabled reports whether Kore ID login is configured.
func (o OIDC) Enabled() bool { return o.Issuer != "" }

// LocalLoginEnabled reports whether password login is allowed.
func (c Config) LocalLoginEnabled() bool { return c.LocalLogin == nil || *c.LocalLogin }

// LinkByEmailEnabled reports whether a verified email may link an existing account.
func (o OIDC) LinkByEmailEnabled() bool { return o.LinkByEmail == nil || *o.LinkByEmail }

// AutoProvisionEnabled reports whether unknown Kore ID users get an account.
func (o OIDC) AutoProvisionEnabled() bool { return o.AutoProvision == nil || *o.AutoProvision }

func envBool(name string, dst **bool) error {
	v := os.Getenv(name)
	if v == "" {
		return nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fmt.Errorf("invalid %s %q (use true or false)", name, v)
	}
	*dst = &b
	return nil
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
		"KORE_BIND":               &c.Bind,
		"KORE_DATA_DIR":           &c.DataDir,
		"KORE_ADMIN_EMAIL":        &c.AdminEmail,
		"KORE_ADMIN_PASSWORD":     &c.AdminPassword,
		"KORE_PUBLIC_URL":         &c.PublicURL,
		"KORE_OIDC_ISSUER":        &c.OIDC.Issuer,
		"KORE_OIDC_CLIENT_ID":     &c.OIDC.ClientID,
		"KORE_OIDC_CLIENT_SECRET": &c.OIDC.ClientSecret,
	} {
		if v := os.Getenv(env); v != "" {
			*dst = v
		}
	}
	if err := envBool("KORE_LOCAL_LOGIN", &c.LocalLogin); err != nil {
		return Config{}, err
	}
	if err := envBool("KORE_OIDC_LINK_BY_EMAIL", &c.OIDC.LinkByEmail); err != nil {
		return Config{}, err
	}
	if err := envBool("KORE_OIDC_AUTO_PROVISION", &c.OIDC.AutoProvision); err != nil {
		return Config{}, err
	}
	if err := c.validateSSO(); err != nil {
		return Config{}, err
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

func (c *Config) validateSSO() error {
	c.PublicURL = strings.TrimRight(c.PublicURL, "/")
	c.OIDC.Issuer = strings.TrimRight(c.OIDC.Issuer, "/")
	if !c.OIDC.Enabled() {
		if !c.LocalLoginEnabled() {
			return errors.New("local_login = false needs Kore ID: set oidc.issuer (KORE_OIDC_ISSUER)")
		}
		return nil
	}
	if c.OIDC.ClientID == "" {
		c.OIDC.ClientID = "kore"
	}
	if c.PublicURL == "" {
		return errors.New("public_url (KORE_PUBLIC_URL) is required when Kore ID is enabled")
	}
	for name, v := range map[string]string{"oidc.issuer": c.OIDC.Issuer, "public_url": c.PublicURL} {
		u, err := url.Parse(v)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.RawQuery != "" || u.Fragment != "" {
			return fmt.Errorf("%s must be an absolute http(s) URL, got %q", name, v)
		}
	}
	return nil
}
