package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"fileforge/frontend"
)

var contentTypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".json":        "application/json",
	".webmanifest": "application/manifest+json",
	".txt":         "text/plain; charset=utf-8",
	".xml":         "application/xml",
	".woff2":       "font/woff2",
	".png":         "image/png",
	".jpg":         "image/jpeg",
	".ico":         "image/x-icon",
}

type staticSite struct {
	files fs.FS
	etags sync.Map // name -> string
}

func newStaticSite() *staticSite {
	return &staticSite{files: frontend.FS}
}

// cacheControl mirrors the policy the nginx config used to apply.
func cacheControl(name string) string {
	switch {
	case strings.HasPrefix(name, "fonts/"):
		return "public, max-age=2592000, immutable, no-transform"
	case strings.HasSuffix(name, ".css"), strings.HasSuffix(name, ".js"):
		return "public, max-age=604800, no-transform"
	case name == "manifest.webmanifest":
		return "public, max-age=86400, no-transform"
	default:
		return "public, max-age=3600, no-transform"
	}
}

// resolve maps a URL path to an embedded file: exact match, then .html, then the SPA index for
// extensionless paths.
func (s *staticSite) resolve(urlPath string) (string, bool) {
	name := strings.TrimPrefix(path.Clean("/"+urlPath), "/")
	if name == "" {
		return "index.html", true
	}
	if isFile(s.files, name) {
		return name, true
	}
	if isFile(s.files, name+".html") {
		return name + ".html", true
	}
	if path.Ext(name) == "" {
		return "index.html", true
	}
	return "", false
}

func isFile(fsys fs.FS, name string) bool {
	info, err := fs.Stat(fsys, name)
	return err == nil && !info.IsDir()
}

func (s *staticSite) etag(name string, data []byte) string {
	if v, ok := s.etags.Load(name); ok {
		return v.(string)
	}
	sum := sha256.Sum256(data)
	tag := `"` + hex.EncodeToString(sum[:8]) + `"`
	s.etags.Store(name, tag)
	return tag
}

func (s *staticSite) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "Not found")
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	name, ok := s.resolve(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}

	f, err := s.files.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()

	var body io.ReadSeeker
	if rs, ok := f.(io.ReadSeeker); ok {
		body = rs
	} else {
		data, err := io.ReadAll(f)
		if err != nil {
			http.Error(w, "read error", http.StatusInternalServerError)
			return
		}
		body = bytes.NewReader(data)
	}

	// The etag needs the bytes once; later requests hit the cache.
	if _, ok := s.etags.Load(name); !ok {
		data, err := io.ReadAll(body)
		if err != nil {
			http.Error(w, "read error", http.StatusInternalServerError)
			return
		}
		s.etag(name, data)
		body.Seek(0, io.SeekStart)
	}
	tag, _ := s.etags.Load(name)

	h := w.Header()
	h.Set("ETag", tag.(string))
	h.Set("Cache-Control", cacheControl(name))
	h.Set("X-Content-Type-Options", "nosniff")
	if ct, ok := contentTypes[path.Ext(name)]; ok {
		h.Set("Content-Type", ct)
	}
	http.ServeContent(w, r, name, time.Time{}, body)
}
