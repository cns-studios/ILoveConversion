package main

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	filecrypto "fileforge/internal/crypto"
	"fileforge/internal/database"
	"fileforge/internal/models"
)

func (a *app) handleCreateJob(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	r.Body = http.MaxBytesReader(w, r.Body, a.cfg.MaxFileSize+10<<20)

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge,
				fmt.Sprintf("File too large. Maximum: %s", formatBytes(a.cfg.MaxFileSize)))
			return
		}
		writeError(w, http.StatusBadRequest, "Invalid form data")
		return
	}
	defer func() {
		if r.MultipartForm != nil {
			r.MultipartForm.RemoveAll()
		}
	}()

	operation := strings.TrimSpace(r.FormValue("operation"))
	if !models.ValidOperations[operation] {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("Invalid operation: %q", operation))
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "No file provided. Use field name 'file'.")
		return
	}
	defer file.Close()

	if header.Size > a.cfg.MaxFileSize {
		writeError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("File too large (%s). Maximum: %s",
				formatBytes(header.Size), formatBytes(a.cfg.MaxFileSize)))
		return
	}

	if header.Size == 0 {
		writeError(w, http.StatusBadRequest, "File is empty")
		return
	}

	inputExt := strings.ToLower(strings.TrimPrefix(filepath.Ext(header.Filename), "."))
	inputExt = normalizeExt(inputExt)

	if !models.ValidInputFormat(operation, inputExt) {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("Unsupported input format .%s for %s", inputExt, operation))
		return
	}

	params, err := parseAndValidateParams(r, operation, inputExt)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	session := sessionFromCtx(r)
	if session == nil {
		writeError(w, http.StatusInternalServerError, "Session error")
		return
	}

	job, err := a.db.CreateJob(ctx, database.CreateJobParams{
		SessionID:    session.ID,
		Operation:    operation,
		OriginalName: header.Filename,
		InputSize:    header.Size,
		Params:       params,
	}, a.cfg.FileRetentionHours)
	if err != nil {
		log.Printf("[upload] create job error: %v", err)
		writeError(w, http.StatusInternalServerError, "Failed to create job")
		return
	}

	key, err := filecrypto.DeriveKey(a.cfg.MasterKey, job.ID)
	if err != nil {
		log.Printf("[upload] key derivation error: %v", err)
		a.db.DeleteJob(ctx, job.ID)
		writeError(w, http.StatusInternalServerError, "Internal error")
		return
	}

	dstFile, err := a.store.CreateInput(job.ID)
	if err != nil {
		log.Printf("[upload] create storage file error: %v", err)
		a.db.DeleteJob(ctx, job.ID)
		writeError(w, http.StatusInternalServerError, "Storage error")
		return
	}

	encErr := filecrypto.EncryptStream(key, file, dstFile)
	syncErr := dstFile.Sync()
	dstFile.Close()

	if encErr != nil || syncErr != nil {
		log.Printf("[upload] encrypt error: enc=%v sync=%v", encErr, syncErr)
		a.db.DeleteJob(ctx, job.ID)
		a.store.DeleteJobFiles(job.ID)
		writeError(w, http.StatusInternalServerError, "Failed to process upload")
		return
	}

	if err := a.queue.Enqueue(ctx, job.ID); err != nil {
		log.Printf("[upload] enqueue error: %v", err)
		a.db.DeleteJob(ctx, job.ID)
		a.store.DeleteJobFiles(job.ID)
		writeError(w, http.StatusInternalServerError, "Failed to queue job")
		return
	}

	log.Printf("[upload] Job %s created: %s .%s (%s)",
		job.ID, operation, inputExt, formatBytes(header.Size))

	writeJSON(w, http.StatusCreated, job.ToResponse())
}
