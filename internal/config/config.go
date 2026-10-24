package config

import (
	"encoding/hex"
	"fmt"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"time"

	filecrypto "fileforge/internal/crypto"
)

type Config struct {
	APIPort int

	DBHost     string
	DBPort     int
	DBUser     string
	DBPassword string
	DBName     string
	DBSSLMode  string

	Keys *filecrypto.KeyRing

	// TrustedProxies are the peers whose forwarding headers are believed. Empty means none.
	TrustedProxies []netip.Prefix
	// ClientIPHeader, if set (for example CF-Connecting-IP), is read from trusted peers
	// before falling back to X-Forwarded-For.
	ClientIPHeader string

	RateLimitPerHour int
	FlagThreshold    int

	MaxFileSize        int64
	StoragePath        string
	CleanupIntervalMin int
	FileRetentionHours int

	WorkerConcurrency int
	RembgURL          string
	TmpDir            string

	JobLease         time.Duration
	DrainTimeout     time.Duration
	ClaimPoll        time.Duration
	RetryBackoffBase time.Duration
	RetryBackoffCap  time.Duration
	WorkerHTTPAddr   string
	MetricsAddr      string

	Timeouts map[string]time.Duration

	Retries map[string]int
}

func (c *Config) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		c.DBHost, c.DBPort, c.DBUser, c.DBPassword, c.DBName, c.DBSSLMode,
	)
}

func (c *Config) TimeoutFor(operation string) time.Duration {
	if d, ok := c.Timeouts[operation]; ok {
		return d
	}
	return 5 * time.Minute
}

func (c *Config) MaxRetriesFor(operation string) int {
	if r, ok := c.Retries[operation]; ok {
		return r
	}
	return 2
}

func Load() (*Config, error) {
	masterKeyHex := os.Getenv("ENCRYPTION_MASTER_KEY")
	if masterKeyHex == "" {
		return nil, fmt.Errorf("ENCRYPTION_MASTER_KEY is required (generate with: openssl rand -hex 32)")
	}

	masterKey, err := hex.DecodeString(masterKeyHex)
	if err != nil {
		return nil, fmt.Errorf("ENCRYPTION_MASTER_KEY must be valid hex: %w", err)
	}
	if len(masterKey) != 32 {
		return nil, fmt.Errorf("ENCRYPTION_MASTER_KEY must be 64 hex chars (32 bytes), got %d bytes", len(masterKey))
	}

	oldKeys, err := filecrypto.ParseOldKeys(os.Getenv("ENCRYPTION_OLD_KEYS"))
	if err != nil {
		return nil, err
	}
	keys, err := filecrypto.NewKeyRing(os.Getenv("ENCRYPTION_KEY_ID"), masterKey, oldKeys)
	if err != nil {
		return nil, err
	}

	proxies, err := ParseTrustedProxies(os.Getenv("TRUSTED_PROXIES"))
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		APIPort: envInt("API_PORT", 3015),

		DBHost:     envStr("POSTGRES_HOST", "postgres"),
		DBPort:     envInt("POSTGRES_PORT", 5432),
		DBUser:     envStr("POSTGRES_USER", "ilc"),
		DBPassword: envStr("POSTGRES_PASSWORD", ""),
		DBName:     envStr("POSTGRES_DB", "ilc"),
		DBSSLMode:  envStr("POSTGRES_SSLMODE", "disable"),

		Keys:             keys,
		TrustedProxies:   proxies,
		ClientIPHeader:   os.Getenv("CLIENT_IP_HEADER"),
		RateLimitPerHour: envInt("RATE_LIMIT_PER_HOUR", 600),
		FlagThreshold:    envInt("FLAG_THRESHOLD", 5000),

		MaxFileSize:        envInt64("MAX_FILE_SIZE", 524288000),
		StoragePath:        envStr("STORAGE_PATH", "/app/storage"),
		CleanupIntervalMin: envInt("CLEANUP_INTERVAL_MINUTES", 5),
		FileRetentionHours: envInt("FILE_RETENTION_HOURS", 1),

		WorkerConcurrency: envInt("WORKER_CONCURRENCY", 4),
		RembgURL:          envStr("REMBG_URL", "http://rembg:5000"),
		TmpDir:            envStr("TMP_DIR", "/tmp/processing"),

		JobLease:         secDuration(envInt("JOB_LEASE_SECONDS", 60)),
		DrainTimeout:     secDuration(envInt("DRAIN_TIMEOUT_SECONDS", 120)),
		ClaimPoll:        time.Duration(envInt("CLAIM_POLL_MS", 1000)) * time.Millisecond,
		RetryBackoffBase: secDuration(envInt("RETRY_BACKOFF_SECONDS", 10)),
		RetryBackoffCap:  secDuration(envInt("RETRY_BACKOFF_MAX_SECONDS", 300)),
		WorkerHTTPAddr:   envStr("WORKER_HTTP_ADDR", ":8081"),
		MetricsAddr:      envStr("METRICS_ADDR", ":9090"),

		Timeouts: map[string]time.Duration{
			"image_convert":   secDuration(envInt("TIMEOUT_IMAGE_CONVERT", 120)),
			"image_compress":  secDuration(envInt("TIMEOUT_IMAGE_COMPRESS", 120)),
			"image_remove_bg": secDuration(envInt("TIMEOUT_IMAGE_REMOVE_BG", 180)),
			"pdf_compress":    secDuration(envInt("TIMEOUT_PDF_COMPRESS", 300)),
			"audio_convert":   secDuration(envInt("TIMEOUT_AUDIO_CONVERT", 300)),
			"audio_compress":  secDuration(envInt("TIMEOUT_AUDIO_COMPRESS", 300)),
			"video_compress":  secDuration(envInt("TIMEOUT_VIDEO_COMPRESS", 1800)),
		},

		Retries: map[string]int{
			"image_convert":   envInt("RETRY_IMAGE", 2),
			"image_compress":  envInt("RETRY_IMAGE", 2),
			"image_remove_bg": envInt("RETRY_IMAGE", 2),
			"pdf_compress":    envInt("RETRY_PDF", 2),
			"audio_convert":   envInt("RETRY_AUDIO", 2),
			"audio_compress":  envInt("RETRY_AUDIO", 2),
			"video_compress":  envInt("RETRY_VIDEO", 1),
		},
	}

	if cfg.FileRetentionHours < 1 {
		return nil, fmt.Errorf("FILE_RETENTION_HOURS must be a whole number of hours, at least 1")
	}
	if cfg.CleanupIntervalMin < 1 {
		return nil, fmt.Errorf("CLEANUP_INTERVAL_MINUTES must be at least 1")
	}
	if cfg.JobLease < 4*time.Second {
		return nil, fmt.Errorf("JOB_LEASE_SECONDS must be at least 4 (the heartbeat runs at lease/4)")
	}

	return cfg, nil
}

// ParseTrustedProxies parses a comma-separated list of CIDRs or bare addresses.
func ParseTrustedProxies(s string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if p, err := netip.ParsePrefix(part); err == nil {
			out = append(out, p.Masked())
			continue
		}
		addr, err := netip.ParseAddr(part)
		if err != nil {
			return nil, fmt.Errorf("TRUSTED_PROXIES: %q is not a CIDR or IP address", part)
		}
		out = append(out, netip.PrefixFrom(addr.Unmap(), addr.Unmap().BitLen()))
	}
	return out, nil
}

func envStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}

func envInt64(key string, fallback int64) int64 {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.ParseInt(v, 10, 64); err == nil {
			return i
		}
	}
	return fallback
}

func secDuration(seconds int) time.Duration {
	return time.Duration(seconds) * time.Second
}
