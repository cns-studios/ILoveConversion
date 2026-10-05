package main

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"fileforge/internal/models"

	"github.com/google/uuid"
)

func parseAndValidateParams(r *http.Request, operation, inputExt string) (models.JobParams, error) {
	var p models.JobParams

	p.OutputFormat = normalizeExt(strings.TrimSpace(r.FormValue("output_format")))

	switch operation {
	case models.OpImageConvert, models.OpAudioConvert:
		if p.OutputFormat == "" {
			return p, fmt.Errorf("output_format is required for %s", operation)
		}
		if !models.ValidOutputFormat(operation, p.OutputFormat) {
			return p, fmt.Errorf("unsupported output format: %s", p.OutputFormat)
		}

	case models.OpImageRemoveBG:
		if p.OutputFormat == "" {
			p.OutputFormat = "png"
		}
		if !models.ValidOutputFormat(operation, p.OutputFormat) {
			return p, fmt.Errorf("background removal supports png or webp output")
		}

	case models.OpImageCompress, models.OpAudioCompress:
		if p.OutputFormat == "" {
			p.OutputFormat = inputExt
		}

	case models.OpVideoCompress:
		if p.OutputFormat == "" {
			if models.ValidOutputFormat(operation, inputExt) {
				p.OutputFormat = inputExt
			} else {
				p.OutputFormat = "mp4"
			}
		}
		if !models.ValidOutputFormat(operation, p.OutputFormat) {
			return p, fmt.Errorf("unsupported video output format: %s", p.OutputFormat)
		}

	case models.OpPDFCompress:
		p.OutputFormat = "pdf"
	}

	if q := r.FormValue("quality"); q != "" {
		v, err := strconv.Atoi(q)
		if err != nil || v < 1 || v > 100 {
			return p, fmt.Errorf("quality must be between 1 and 100")
		}
		p.Quality = v
	} else {
		switch operation {
		case models.OpImageCompress:
			p.Quality = 80
		case models.OpAudioCompress:
			p.Quality = 70
		case models.OpVideoCompress:
			p.Quality = 65
		}
	}

	if r.FormValue("lossless") == "true" {
		p.Lossless = true
	}

	if d := r.FormValue("image_dpi"); d != "" {
		v, err := strconv.Atoi(d)
		if err != nil {
			return p, fmt.Errorf("invalid image_dpi value")
		}
		valid := map[int]bool{72: true, 150: true, 300: true, 600: true}
		if !valid[v] {
			return p, fmt.Errorf("image_dpi must be 72, 150, 300, or 600")
		}
		p.ImageDPI = v
	} else if operation == models.OpPDFCompress {
		p.ImageDPI = 150
	}

	if iq := r.FormValue("image_quality"); iq != "" {
		v, err := strconv.Atoi(iq)
		if err != nil || v < 1 || v > 100 {
			return p, fmt.Errorf("image_quality must be between 1 and 100")
		}
		p.ImageQuality = v
	} else if operation == models.OpPDFCompress {
		p.ImageQuality = 75
	}

	return p, nil
}

func isValidUUID(s string) bool {
	_, err := uuid.Parse(s)
	return err == nil
}

func normalizeExt(ext string) string {
	ext = strings.ToLower(strings.TrimPrefix(ext, "."))
	switch ext {
	case "jpg":
		return "jpeg"
	case "tif":
		return "tiff"
	default:
		return ext
	}
}

func sanitizeFilename(name string) string {
	name = strings.ReplaceAll(name, "/", "_")
	name = strings.ReplaceAll(name, "\\", "_")
	name = strings.ReplaceAll(name, "\x00", "")
	name = strings.ReplaceAll(name, "\"", "'")
	if name == "" {
		name = "download"
	}
	return name
}
