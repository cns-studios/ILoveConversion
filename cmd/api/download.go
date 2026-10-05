package main

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strconv"

	filecrypto "fileforge/internal/crypto"
	"fileforge/internal/models"

	"github.com/go-chi/chi/v5"
)

func (a *app) handleDownload(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	if !isValidUUID(jobID) {
		writeError(w, http.StatusBadRequest, "Invalid job ID")
		return
	}

	job, err := a.db.GetJob(r.Context(), jobID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "Job not found")
		} else {
			writeError(w, http.StatusInternalServerError, "Database error")
		}
		return
	}

	if job.Status != models.StatusCompleted {
		switch job.Status {
		case models.StatusPending, models.StatusProcessing:
			writeError(w, http.StatusConflict, "Job is still processing")
		case models.StatusFailed:
			msg := "Job failed"
			if job.ErrorMessage.Valid {
				msg = job.ErrorMessage.String
			}
			writeError(w, http.StatusUnprocessableEntity, msg)
		default:
			writeError(w, http.StatusConflict, "Job not ready for download")
		}
		return
	}

	if !a.store.OutputExists(jobID) {
		writeError(w, http.StatusNotFound, "Output file not found (may have expired)")
		return
	}

	key, err := filecrypto.DeriveKey(a.cfg.MasterKey, jobID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal error")
		return
	}

	encFile, err := a.store.OpenOutput(jobID)
	if err != nil {
		log.Printf("[download] open error for %s: %v", jobID, err)
		writeError(w, http.StatusInternalServerError, "Failed to read file")
		return
	}
	defer encFile.Close()

	outputName := "download"
	if job.OutputFilename.Valid && job.OutputFilename.String != "" {
		outputName = job.OutputFilename.String
	}

	ext := filepath.Ext(outputName)
	contentType := models.MimeForExtension(ext)

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="%s"`, sanitizeFilename(outputName)))

	if job.OutputSize.Valid && job.OutputSize.Int64 > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(job.OutputSize.Int64, 10))
	}

	w.Header().Set("Cache-Control", "no-store")

	if err := filecrypto.DecryptStream(key, encFile, w); err != nil {
		log.Printf("[download] decrypt stream error for %s: %v", jobID, err)
	}
}
