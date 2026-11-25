// Package push delivers reminders to browsers through standard Web Push
// (RFC 8030 with VAPID and RFC 8291 encryption). Browsers only allow Web Push
// on a secure context, so this works behind HTTPS (a tunnel or Tailscale
// HTTPS); the server side has no such requirement.
package push

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/qarasky/korecalendar/api/internal/reminders"
	"github.com/qarasky/korecalendar/api/internal/users"
)

// Errors returned by this package.
var (
	ErrNotFound = errors.New("subscription not found")
	ErrInvalid  = errors.New("invalid subscription")
)

const defaultSubscriber = "mailto:korecalendar@localhost"

// Channel implements reminders.Channel for Web Push.
type Channel struct {
	db         *sql.DB
	privateKey string
	publicKey  string
	// Subscriber is the VAPID contact (a mailto: or https: URL); push services
	// may use it to reach the operator.
	Subscriber string
	// Client sends the requests. The default refuses private addresses, so a
	// subscription cannot aim the server at its own network.
	Client *http.Client
}

var _ reminders.Channel = (*Channel)(nil)

// New returns the channel, creating the VAPID key pair on first use.
func New(db *sql.DB) (*Channel, error) {
	priv, pub, err := vapidKeys(context.Background(), db)
	if err != nil {
		return nil, err
	}
	return &Channel{db: db, privateKey: priv, publicKey: pub, Subscriber: defaultSubscriber, Client: safeClient()}, nil
}

// Name is the channel's name in the delivery log.
func (c *Channel) Name() string { return "webpush" }

// vapidKeys returns the stored VAPID key pair, generating it once.
func vapidKeys(ctx context.Context, db *sql.DB) (priv, pub string, err error) {
	read := func() (string, string, error) {
		var ps, qs sql.NullString
		if err := db.QueryRowContext(ctx, `SELECT (SELECT value FROM settings WHERE key='vapid.private'), (SELECT value FROM settings WHERE key='vapid.public')`).Scan(&ps, &qs); err != nil {
			return "", "", err
		}
		return ps.String, qs.String, nil
	}
	if priv, pub, err = read(); err != nil || (priv != "" && pub != "") {
		return priv, pub, err
	}
	np, nq, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return "", "", err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return "", "", err
	}
	defer tx.Rollback()
	for k, v := range map[string]string{"vapid.private": np, "vapid.public": nq} {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)`, k, v); err != nil {
			return "", "", err
		}
	}
	if err := tx.Commit(); err != nil {
		return "", "", err
	}
	return read()
}

// PublicKey returns the VAPID public key browsers subscribe with.
func PublicKey(ctx context.Context, db *sql.DB) (string, error) {
	_, pub, err := vapidKeys(ctx, db)
	return pub, err
}

func decodeKey(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "="))
}

// Subscribe stores (or refreshes) a browser's push subscription. The same
// endpoint always keeps one row; created reports whether it was new.
func Subscribe(ctx context.Context, db *sql.DB, userID, endpoint, p256dh, auth string) (id string, created bool, err error) {
	u, perr := url.Parse(endpoint)
	if perr != nil || u.Scheme != "https" || u.Host == "" || len(endpoint) > 2048 {
		return "", false, fmt.Errorf("%w: endpoint must be an https URL", ErrInvalid)
	}
	if k, err := decodeKey(p256dh); err != nil || len(k) != 65 || k[0] != 4 {
		return "", false, fmt.Errorf("%w: keys.p256dh must be a base64url P-256 public key", ErrInvalid)
	}
	if k, err := decodeKey(auth); err != nil || len(k) < 16 {
		return "", false, fmt.Errorf("%w: keys.auth must be a base64url secret of at least 16 bytes", ErrInvalid)
	}
	fresh := users.NewID()
	err = db.QueryRowContext(ctx, `INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,created_at) VALUES(?,?,?,?,?,?)
		ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth
		RETURNING id`, fresh, userID, endpoint, p256dh, auth, time.Now().Unix()).Scan(&id)
	return id, id == fresh, err
}

// Unsubscribe removes the user's subscription; someone else's id is ErrNotFound.
func Unsubscribe(ctx context.Context, db *sql.DB, userID, id string) error {
	res, err := db.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE id=? AND user_id=?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

type subscription struct{ id, endpoint, p256dh, auth string }

// Send pushes d to every device of the user. A device whose subscription is
// gone (404/410) is forgotten. Send fails only if no device accepted the
// message, so a retry never re-notifies a device that already got it.
func (c *Channel) Send(ctx context.Context, userID string, d reminders.Due) error {
	rows, err := c.db.QueryContext(ctx, `SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=?`, userID)
	if err != nil {
		return err
	}
	var subs []subscription
	for rows.Next() {
		var s subscription
		if err := rows.Scan(&s.id, &s.endpoint, &s.p256dh, &s.auth); err != nil {
			rows.Close()
			return err
		}
		subs = append(subs, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	msg := payload(d)
	ttl := min(max(d.MinutesBefore*60, 60), 86400)
	delivered, failed := 0, 0
	var lastErr error
	for _, s := range subs {
		resp, err := webpush.SendNotificationWithContext(ctx, msg, &webpush.Subscription{Endpoint: s.endpoint, Keys: webpush.Keys{Auth: s.auth, P256dh: s.p256dh}},
			&webpush.Options{HTTPClient: c.Client, Subscriber: c.Subscriber, VAPIDPublicKey: c.publicKey, VAPIDPrivateKey: c.privateKey, TTL: ttl, Urgency: webpush.UrgencyHigh})
		if err != nil {
			failed++
			lastErr = err
			continue
		}
		resp.Body.Close()
		switch {
		case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
			c.db.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE id=?`, s.id)
		case resp.StatusCode >= 200 && resp.StatusCode < 300:
			delivered++
		default:
			failed++
			lastErr = fmt.Errorf("push service answered %d", resp.StatusCode)
		}
	}
	if delivered == 0 && failed > 0 {
		return fmt.Errorf("web push: %d deliveries failed, last: %w", failed, lastErr)
	}
	return nil
}

// payload is the notification the service worker shows.
func payload(d reminders.Due) []byte {
	when := "All day"
	if i := strings.IndexByte(d.Start, 'T'); i >= 0 && len(d.Start) >= i+6 {
		when = d.Start[i+1 : i+6]
	}
	b, _ := json.Marshal(map[string]string{"title": d.Title, "body": when + " · " + lead(d.MinutesBefore), "eventId": d.EventID, "key": d.Key})
	return b
}

func lead(m int) string {
	switch {
	case m == 0:
		return "starting now"
	case m < 60:
		return fmt.Sprintf("in %d min", m)
	case m%1440 == 0 && m/1440 == 1:
		return "in 1 day"
	case m%1440 == 0:
		return fmt.Sprintf("in %d days", m/1440)
	case m%60 == 0:
		return fmt.Sprintf("in %d h", m/60)
	default:
		return fmt.Sprintf("in %d h %d min", m/60, m%60)
	}
}

// blocked reports addresses a push endpoint must never resolve to.
func blocked(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip4 := ip.To4(); ip4 != nil && ip4[0] == 100 && ip4[1]&0xc0 == 64 { // 100.64.0.0/10 (CGNAT, Tailscale)
		return true
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast()
}

// safeClient is an HTTP client that refuses to connect to private, loopback
// and link-local addresses (checked after DNS resolution), ignores proxy
// settings and does not follow redirects.
func safeClient() *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second, Control: func(_, address string, _ syscall.RawConn) error {
		host, _, err := net.SplitHostPort(address)
		if err != nil || blocked(net.ParseIP(host)) {
			return fmt.Errorf("push: refusing to connect to %s", address)
		}
		return nil
	}}
	return &http.Client{
		Timeout:       20 * time.Second,
		Transport:     &http.Transport{Proxy: nil, DialContext: dialer.DialContext, TLSHandshakeTimeout: 10 * time.Second},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}
