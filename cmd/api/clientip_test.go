package main

import (
	"net/http"
	"net/netip"
	"testing"
)

func TestClientIP(t *testing.T) {
	trusted := []netip.Prefix{
		netip.MustParsePrefix("10.0.0.0/8"),
		netip.MustParsePrefix("fd00::/8"),
	}

	tests := []struct {
		name    string
		remote  string
		trusted []netip.Prefix
		header  string
		headers map[string][]string
		want    string
	}{
		{
			name:   "no trusted proxies ignores spoofed headers",
			remote: "203.0.113.7:4000",
			headers: map[string][]string{
				"X-Forwarded-For": {"1.2.3.4"}, "X-Real-Ip": {"1.2.3.4"}, "Cf-Connecting-Ip": {"1.2.3.4"},
			},
			header: "CF-Connecting-IP",
			want:   "203.0.113.7",
		},
		{
			name:    "untrusted peer cannot spoof",
			remote:  "203.0.113.7:4000",
			trusted: trusted,
			headers: map[string][]string{"X-Forwarded-For": {"1.2.3.4"}},
			want:    "203.0.113.7",
		},
		{
			name:    "trusted peer without headers is itself",
			remote:  "10.1.2.3:5000",
			trusted: trusted,
			want:    "10.1.2.3",
		},
		{
			name:    "trusted peer, single forwarded address",
			remote:  "10.1.2.3:5000",
			trusted: trusted,
			headers: map[string][]string{"X-Forwarded-For": {"198.51.100.9"}},
			want:    "198.51.100.9",
		},
		{
			name:    "client-supplied left entries are skipped",
			remote:  "10.1.2.3:5000",
			trusted: trusted,
			headers: map[string][]string{"X-Forwarded-For": {"6.6.6.6, 198.51.100.9"}},
			want:    "198.51.100.9",
		},
		{
			name:    "trusted hops are skipped right to left",
			remote:  "10.1.2.3:5000",
			trusted: trusted,
			headers: map[string][]string{"X-Forwarded-For": {"198.51.100.9, 10.9.9.9, 10.8.8.8"}},
			want:    "198.51.100.9",
		},
		{
			name:    "repeated XFF header lines are joined",
			remote:  "10.1.2.3:5000",
			trusted: trusted,
			headers: map[string][]string{"X-Forwarded-For": {"6.6.6.6", "198.51.100.9, 10.9.9.9"}},
			want:    "198.51.100.9",
		},
		{
			name:    "all hops trusted gives leftmost",
			remote:  "10.1.2.3:5000",
			trusted: trusted,
			headers: map[string][]string{"X-Forwarded-For": {"10.5.5.5, 10.6.6.6"}},
			want:    "10.5.5.5",
		},
		{
			name:    "malformed hop falls back to peer",
			remote:  "10.1.2.3:5000",
			trusted: trusted,
			headers: map[string][]string{"X-Forwarded-For": {"198.51.100.9, not-an-ip"}},
			want:    "10.1.2.3",
		},
		{
			name:    "dedicated header wins from trusted peer",
			remote:  "10.1.2.3:5000",
			trusted: trusted,
			header:  "CF-Connecting-IP",
			headers: map[string][]string{"Cf-Connecting-Ip": {"198.51.100.20"}, "X-Forwarded-For": {"198.51.100.9"}},
			want:    "198.51.100.20",
		},
		{
			name:    "bad dedicated header falls through to XFF",
			remote:  "10.1.2.3:5000",
			trusted: trusted,
			header:  "CF-Connecting-IP",
			headers: map[string][]string{"Cf-Connecting-Ip": {"garbage"}, "X-Forwarded-For": {"198.51.100.9"}},
			want:    "198.51.100.9",
		},
		{
			name:    "dedicated header ignored from untrusted peer",
			remote:  "203.0.113.7:4000",
			trusted: trusted,
			header:  "CF-Connecting-IP",
			headers: map[string][]string{"Cf-Connecting-Ip": {"198.51.100.20"}},
			want:    "203.0.113.7",
		},
		{
			name:    "IPv6 peer and client",
			remote:  "[fd00::5]:5000",
			trusted: trusted,
			headers: map[string][]string{"X-Forwarded-For": {"2001:db8::1"}},
			want:    "2001:db8::1",
		},
		{
			name:    "IPv4-mapped peer is matched as IPv4",
			remote:  "[::ffff:10.1.2.3]:5000",
			trusted: trusted,
			headers: map[string][]string{"X-Forwarded-For": {"198.51.100.9"}},
			want:    "198.51.100.9",
		},
		{
			name:   "peer without port",
			remote: "203.0.113.7",
			want:   "203.0.113.7",
		},
		{
			name:   "unusable peer yields empty",
			remote: "garbage",
			want:   "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := &http.Request{RemoteAddr: tt.remote, Header: http.Header(tt.headers)}
			if r.Header == nil {
				r.Header = http.Header{}
			}
			if got := clientIP(r, tt.trusted, tt.header); got != tt.want {
				t.Errorf("clientIP = %q, want %q", got, tt.want)
			}
		})
	}
}
