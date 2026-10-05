package main

import (
	"database/sql"
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

func (a *app) handleHealth(w http.ResponseWriter, r *http.Request) {
	dbErr := a.db.Ping(r.Context())
	qErr := a.queue.Ping(r.Context())

	if dbErr != nil || qErr != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]interface{}{
			"status":   "degraded",
			"database": errStr(dbErr),
			"redis":    errStr(qErr),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "api",
	})
}

func (a *app) handleFormats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("X-Max-File-Size", strconv.FormatInt(a.cfg.MaxFileSize, 10))
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(formatsJSON))
}

func (a *app) handleGetJob(w http.ResponseWriter, r *http.Request) {
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
			log.Printf("[status] db error for %s: %v", jobID, err)
			writeError(w, http.StatusInternalServerError, "Database error")
		}
		return
	}

	writeJSON(w, http.StatusOK, job.ToResponse())
}

func (a *app) handleDeleteJob(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	if !isValidUUID(jobID) {
		writeError(w, http.StatusBadRequest, "Invalid job ID")
		return
	}

	deleted, err := a.db.DeleteJob(r.Context(), jobID)
	if err != nil {
		log.Printf("[delete] db error for %s: %v", jobID, err)
		writeError(w, http.StatusInternalServerError, "Database error")
		return
	}

	if !deleted {
		writeError(w, http.StatusNotFound, "Job not found")
		return
	}

	a.store.DeleteJobFiles(jobID)

	log.Printf("[delete] Job %s deleted", jobID)
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "deleted",
		"id":     jobID,
	})
}

func (a *app) handleAdminStats(w http.ResponseWriter, r *http.Request) {
	stats, err := a.db.GetAdminStats(r.Context())
	if err != nil {
		log.Printf("[admin] stats error: %v", err)
		writeError(w, http.StatusInternalServerError, "Failed to fetch stats")
		return
	}

	stats.StorageUsedMB = a.store.UsedMB()

	queueLen, err := a.queue.Length(r.Context())
	if err == nil {
		stats.QueueLength = int(queueLen)
	}

	writeJSON(w, http.StatusOK, stats)
}
