// Package frontend embeds the static site so the API binary can serve it without nginx.
package frontend

import "embed"

//go:embed *.html *.png *.ico *.jpg *.txt *.xml *.webmanifest qrcode.min.js css fonts js local
var FS embed.FS
