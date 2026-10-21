package httpapi

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// ClientIP returns the client address for rate limiting. Proxy headers are
// honoured only when the direct peer is loopback, private or link-local
// (i.e. a local reverse proxy such as Caddy); otherwise RemoteAddr is used.
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	peer = peer.Unmap()
	if !(peer.IsLoopback() || peer.IsPrivate() || peer.IsLinkLocalUnicast()) {
		return peer.String()
	}
	if a, err := netip.ParseAddr(strings.TrimSpace(r.Header.Get("CF-Connecting-IP"))); err == nil {
		return a.Unmap().String()
	}
	parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(parts) - 1; i >= 0; i-- {
		if a, err := netip.ParseAddr(strings.TrimSpace(parts[i])); err == nil {
			return a.Unmap().String()
		}
	}
	return peer.String()
}
