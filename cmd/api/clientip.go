package main

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// clientIP returns the address to attribute a request to. Forwarding headers are believed only
// when the TCP peer is in trusted; otherwise anyone could pick their own IP by sending them.
//
// From a trusted peer it uses, in order: the dedicated header (say CF-Connecting-IP), then
// X-Forwarded-For read right to left, skipping trusted hops. It returns "" only when the peer
// address itself is unusable.
func clientIP(r *http.Request, trusted []netip.Prefix, header string) string {
	peer, ok := parsePeer(r.RemoteAddr)
	if !ok {
		return ""
	}
	if !inPrefixes(peer, trusted) {
		return peer.String()
	}

	if header != "" {
		if addr, ok := parseIP(r.Header.Get(header)); ok {
			return addr.String()
		}
	}

	var hops []string
	for _, v := range r.Header.Values("X-Forwarded-For") {
		hops = append(hops, strings.Split(v, ",")...)
	}
	var leftmost netip.Addr
	for i := len(hops) - 1; i >= 0; i-- {
		addr, ok := parseIP(hops[i])
		if !ok {
			// A malformed hop means the chain is not to be trusted past this point.
			return peer.String()
		}
		if !inPrefixes(addr, trusted) {
			return addr.String()
		}
		leftmost = addr
	}
	if leftmost.IsValid() {
		return leftmost.String()
	}
	return peer.String()
}

func parsePeer(remote string) (netip.Addr, bool) {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		host = remote
	}
	return parseIP(host)
}

func parseIP(s string) (netip.Addr, bool) {
	addr, err := netip.ParseAddr(strings.TrimSpace(s))
	if err != nil {
		return netip.Addr{}, false
	}
	return addr.WithZone("").Unmap(), true
}

func inPrefixes(addr netip.Addr, prefixes []netip.Prefix) bool {
	for _, p := range prefixes {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}
