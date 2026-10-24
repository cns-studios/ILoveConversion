package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStaticSite(t *testing.T) {
	site := newStaticSite()

	get := func(target string, hdr map[string]string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		site.ServeHTTP(rec, req)
		return rec
	}

	tests := []struct {
		target   string
		status   int
		cache    string
		typePart string
	}{
		{"/", 200, "public, max-age=3600, no-transform", "text/html"},
		{"/privacy", 200, "public, max-age=3600, no-transform", "text/html"},
		{"/privacy.html", 200, "public, max-age=3600, no-transform", "text/html"},
		{"/some/spa/route", 200, "public, max-age=3600, no-transform", "text/html"},
		{"/css/base.css", 200, "public, max-age=604800, no-transform", "text/css"},
		{"/js/main.js", 200, "public, max-age=604800, no-transform", "javascript"},
		{"/fonts/inter-latin.woff2", 200, "public, max-age=2592000, immutable, no-transform", "font/woff2"},
		{"/manifest.webmanifest", 200, "public, max-age=86400, no-transform", "manifest+json"},
		{"/missing.png", 404, "", ""},
		{"/api/nope", 404, "", "json"},
	}
	for _, tt := range tests {
		rec := get(tt.target, nil)
		if rec.Code != tt.status {
			t.Errorf("%s: status %d, want %d", tt.target, rec.Code, tt.status)
			continue
		}
		if tt.cache != "" && rec.Header().Get("Cache-Control") != tt.cache {
			t.Errorf("%s: Cache-Control %q, want %q", tt.target, rec.Header().Get("Cache-Control"), tt.cache)
		}
		if tt.typePart != "" && !strings.Contains(rec.Header().Get("Content-Type"), tt.typePart) {
			t.Errorf("%s: Content-Type %q, want it to contain %q", tt.target, rec.Header().Get("Content-Type"), tt.typePart)
		}
	}

	first := get("/css/base.css", nil)
	tag := first.Header().Get("ETag")
	if tag == "" {
		t.Fatal("no ETag")
	}
	if again := get("/css/base.css", map[string]string{"If-None-Match": tag}); again.Code != http.StatusNotModified {
		t.Errorf("conditional GET = %d, want 304", again.Code)
	}

	post := httptest.NewRecorder()
	site.ServeHTTP(post, httptest.NewRequest(http.MethodPost, "/", nil))
	if post.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST / = %d, want 405", post.Code)
	}
}
