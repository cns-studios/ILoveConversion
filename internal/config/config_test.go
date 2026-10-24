package config

import (
	"strings"
	"testing"
)

func TestParseTrustedProxies(t *testing.T) {
	got, err := ParseTrustedProxies(" 10.0.0.0/8, 192.168.1.5 ,fd00::/8,")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"10.0.0.0/8", "192.168.1.5/32", "fd00::/8"}
	if len(got) != len(want) {
		t.Fatalf("got %v", got)
	}
	for i, p := range got {
		if p.String() != want[i] {
			t.Errorf("prefix %d = %s, want %s", i, p, want[i])
		}
	}

	if none, err := ParseTrustedProxies(""); err != nil || len(none) != 0 {
		t.Errorf("empty = %v, %v; want no proxies", none, err)
	}
	if _, err := ParseTrustedProxies("10.0.0.0/8,nonsense"); err == nil {
		t.Error("garbage entry accepted")
	}
}

func TestLoadRequiresKeyAndSaneLease(t *testing.T) {
	t.Setenv("ENCRYPTION_MASTER_KEY", strings.Repeat("ab", 32))
	t.Setenv("JOB_LEASE_SECONDS", "2")
	if _, err := Load(); err == nil {
		t.Error("lease below 4s accepted")
	}

	t.Setenv("JOB_LEASE_SECONDS", "60")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Keys.CurrentID() != "1" {
		t.Errorf("default key id = %q, want 1", cfg.Keys.CurrentID())
	}
	if len(cfg.TrustedProxies) != 0 {
		t.Error("proxies trusted by default")
	}
}
