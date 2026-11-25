// Package config loads KoreCalendar's minimal TOML configuration.
package config

import (
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/mail"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"

	"github.com/pelletier/go-toml/v2"
)

// Config holds the settings read from the config file and environment.
type Config struct {
	Port      int    `toml:"port"`
	Bind      string `toml:"bind"`
	DataDir   string `toml:"data_dir"`
	PublicURL string `toml:"public_url"`
	OIDC      OIDC   `toml:"oidc"`
}

// OIDC configures sign-in with Kore ID (or any OpenID Connect provider with
// EdDSA-signed tokens). It is enabled by setting Issuer.
type OIDC struct {
	Issuer           string   `toml:"issuer"`
	ClientID         string   `toml:"client_id"`
	ClientSecret     string   `toml:"client_secret"`      // prefer client_secret_file / the env var
	ClientSecretFile string   `toml:"client_secret_file"` // e.g. a Docker secret
	Scopes           []string `toml:"scopes"`
	// ExtraAudiences are further client ids (e.g. "korecalendar-android") whose
	// access tokens the API accepts as bearer tokens.
	ExtraAudiences []string `toml:"extra_audiences"`
	// LinkByEmail: "verified" (default) links a Kore ID login to an existing
	// local account with the same email when the token says
	// email_verified=true (Kore ID accounts are admin-managed, so their emails
	// are); "off" never links (use the `link` command); "trusted" links on any
	// email match.
	LinkByEmail   string `toml:"link_by_email"`
	AutoProvision bool   `toml:"auto_provision"` // create a local user on first login (default true)
	// AdminSubs are Kore ID subjects that become administrators here (and may
	// sign in first on an empty install). Who may use KoreCalendar at all is
	// decided by Kore ID (per-user access to the app "korecalendar").
	AdminSubs []string `toml:"admin_subs"`
	// OwnerEmail names the first administrator on a fresh install: the first
	// Kore ID sign-in whose verified email matches becomes an admin, so the
	// install can start without a local password account.
	OwnerEmail string `toml:"owner_email"`
	Name       string `toml:"name"` // button label (default "Kore ID")
	// Apps are the other Kore apps' addresses for the web app switcher, keyed
	// kore, koremind, korecalendar, flatline. korecalendar defaults to public_url.
	Apps map[string]string `toml:"apps"`
}

// KoreApps are the app keys the app switcher knows.
var KoreApps = []string{"kore", "koremind", "korecalendar", "flatline"}

// Enabled reports whether OIDC sign-in is configured.
func (o OIDC) Enabled() bool { return o.Issuer != "" }

func splitList(v string) []string {
	var out []string
	for _, f := range strings.FieldsFunc(v, func(r rune) bool { return r == ',' || r == ' ' }) {
		out = append(out, f)
	}
	return out
}

// Load reads and validates the config. The file at path is optional;
// KORECAL_PORT, KORECAL_BIND, KORECAL_DATA_DIR and KORECAL_PUBLIC_URL, when
// set and non-empty, override the file (this is how the Docker image is
// configured from .env).
func Load(path string) (Config, error) {
	c := Config{Port: 8080, Bind: "127.0.0.1", OIDC: OIDC{AutoProvision: true}}
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
	if err := c.loadOIDCEnv(); err != nil {
		return Config{}, err
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
	if err := c.validateOIDC(); err != nil {
		return Config{}, err
	}
	return c, nil
}

func envBool(name string, dst *bool) error {
	v := os.Getenv(name)
	if v == "" {
		return nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fmt.Errorf("invalid %s %q (use true or false)", name, v)
	}
	*dst = b
	return nil
}

// loadOIDCEnv applies the KORECAL_OIDC_* overrides.
func (c *Config) loadOIDCEnv() error {
	if err := envBool("KORECAL_OIDC_AUTO_PROVISION", &c.OIDC.AutoProvision); err != nil {
		return err
	}
	for env, dst := range map[string]*string{
		"KORECAL_OIDC_ISSUER":             &c.OIDC.Issuer,
		"KORECAL_OIDC_CLIENT_ID":          &c.OIDC.ClientID,
		"KORECAL_OIDC_CLIENT_SECRET":      &c.OIDC.ClientSecret,
		"KORECAL_OIDC_CLIENT_SECRET_FILE": &c.OIDC.ClientSecretFile,
		"KORECAL_OIDC_LINK_BY_EMAIL":      &c.OIDC.LinkByEmail,
		"KORECAL_OIDC_OWNER_EMAIL":        &c.OIDC.OwnerEmail,
		"KORECAL_OIDC_NAME":               &c.OIDC.Name,
	} {
		if v := os.Getenv(env); v != "" {
			*dst = v
		}
	}
	if v := os.Getenv("KORECAL_KORE_APPS"); v != "" {
		c.OIDC.Apps = map[string]string{}
		for _, kv := range splitList(v) {
			k, val, ok := strings.Cut(kv, "=")
			if !ok {
				return fmt.Errorf("invalid KORECAL_KORE_APPS entry %q (use app=https://...)", kv)
			}
			c.OIDC.Apps[strings.TrimSpace(k)] = strings.TrimSpace(val)
		}
	}
	for env, dst := range map[string]*[]string{
		"KORECAL_OIDC_SCOPES":          &c.OIDC.Scopes,
		"KORECAL_OIDC_EXTRA_AUDIENCES": &c.OIDC.ExtraAudiences,
		"KORECAL_OIDC_ADMIN_SUBS":      &c.OIDC.AdminSubs,
	} {
		if v := os.Getenv(env); v != "" {
			*dst = splitList(v)
		}
	}
	return nil
}

func (c *Config) validateOIDC() error {
	o := &c.OIDC
	o.OwnerEmail = strings.ToLower(strings.TrimSpace(o.OwnerEmail))
	if o.OwnerEmail != "" {
		if a, err := mail.ParseAddress(o.OwnerEmail); err != nil || a.Address != o.OwnerEmail || len(o.OwnerEmail) > 254 {
			return fmt.Errorf("invalid oidc owner_email %q", o.OwnerEmail)
		}
	}
	if !o.Enabled() {
		// KoreCalendar can run without a provider, but then nobody can sign in:
		// the web and Android apps say so instead of offering a password form.
		return nil
	}
	if o.ClientID == "" {
		o.ClientID = "korecalendar"
	}
	if o.Name == "" {
		o.Name = "Kore ID"
	}
	if o.LinkByEmail == "" {
		o.LinkByEmail = "verified"
	}
	switch o.LinkByEmail {
	case "off", "verified", "trusted":
	default:
		return fmt.Errorf("invalid oidc link_by_email %q (use off, verified or trusted)", o.LinkByEmail)
	}
	if o.ClientSecretFile != "" && o.ClientSecret == "" {
		b, err := os.ReadFile(o.ClientSecretFile)
		if err != nil {
			return fmt.Errorf("read oidc client_secret_file: %w", err)
		}
		o.ClientSecret = strings.TrimSpace(string(b))
	}
	u, err := url.Parse(c.PublicURL)
	if c.PublicURL == "" || err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || (u.Path != "" && u.Path != "/") {
		return errors.New("public_url (KORECAL_PUBLIC_URL) must be the site's origin, e.g. https://calendar.example.com, when oidc is enabled: it builds the redirect URI")
	}
	for k, v := range o.Apps {
		if !slices.Contains(KoreApps, k) {
			return fmt.Errorf("invalid oidc apps key %q (use %s)", k, strings.Join(KoreApps, ", "))
		}
		if au, err := url.Parse(v); err != nil || (au.Scheme != "https" && au.Scheme != "http") || au.Host == "" {
			return fmt.Errorf("oidc apps %s: %q is not an absolute http(s) URL", k, v)
		}
	}
	if o.Apps == nil {
		o.Apps = map[string]string{}
	}
	if o.Apps["korecalendar"] == "" {
		o.Apps["korecalendar"] = strings.TrimRight(c.PublicURL, "/") + "/"
	}
	return nil
}

// OIDCRedirectURL is the callback to register with the provider.
func (c Config) OIDCRedirectURL() string {
	return strings.TrimRight(c.PublicURL, "/") + "/api/auth/oidc/callback"
}

// OIDCBackchannelLogoutURL is the back-channel logout URI to register with the
// provider (backchannelLogoutUri in Kore ID's clients.json).
func (c Config) OIDCBackchannelLogoutURL() string {
	return strings.TrimRight(c.PublicURL, "/") + "/api/auth/oidc/backchannel-logout"
}
