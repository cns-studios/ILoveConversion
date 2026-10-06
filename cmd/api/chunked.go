package main

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	filecrypto "fileforge/internal/crypto"
	"fileforge/internal/database"
	"fileforge/internal/models"

	"github.com/go-chi/chi/v5"
)

const uploadChunkSize int64 = 50 << 20

func chunkCount(size int64) int {
	return int((size + uploadChunkSize - 1) / uploadChunkSize)
}

func chunkLen(size int64, index int) int64 {
	start := int64(index) * uploadChunkSize
	if rest := size - start; rest < uploadChunkSize {
		return rest
	}
	return uploadChunkSize
}

type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

func (a *app) handleInitUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := r.ParseForm(); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid form data")
		return
	}

	operation := strings.TrimSpace(r.FormValue("operation"))
	if !models.ValidOperations[operation] {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("Invalid operation: %q", operation))
		return
	}

	filename := filepath.Base(strings.TrimSpace(r.FormValue("filename")))
	size, err := strconv.ParseInt(r.FormValue("size"), 10, 64)
	if err != nil || filename == "" || filename == "." {
		writeError(w, http.StatusBadRequest, "filename and size are required")
		return
	}
	if size <= 0 {
		writeError(w, http.StatusBadRequest, "File is empty")
		return
	}
	if size > a.cfg.MaxFileSize {
		writeError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("File too large (%s). Maximum: %s",
				formatBytes(size), formatBytes(a.cfg.MaxFileSize)))
		return
	}

	inputExt := normalizeExt(strings.ToLower(strings.TrimPrefix(filepath.Ext(filename), ".")))
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

	job, err := a.db.CreateJob(r.Context(), database.CreateJobParams{
		SessionID:    session.ID,
		Operation:    operation,
		OriginalName: filename,
		InputSize:    size,
		Params:       params,
	}, a.cfg.FileRetentionHours)
	if err != nil {
		log.Printf("[upload] create job error: %v", err)
		writeError(w, http.StatusInternalServerError, "Failed to create job")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"id":         job.ID,
		"chunk_size": uploadChunkSize,
		"chunks":     chunkCount(size),
	})
}

func (a *app) uploadJob(w http.ResponseWriter, r *http.Request) *models.Job {
	jobID := chi.URLParam(r, "id")
	if !isValidUUID(jobID) {
		writeError(w, http.StatusBadRequest, "Invalid job ID")
		return nil
	}

	session := sessionFromCtx(r)
	job, err := a.db.GetJob(r.Context(), jobID)
	if err != nil || session == nil || job.SessionID != session.ID {
		writeError(w, http.StatusNotFound, "Upload not found")
		return nil
	}

	if job.Status != models.StatusPending || a.store.InputExists(job.ID) {
		writeError(w, http.StatusConflict, "Upload already completed")
		return nil
	}
	return job
}

func (a *app) handleUploadChunk(w http.ResponseWriter, r *http.Request) {
	job := a.uploadJob(w, r)
	if job == nil {
		return
	}

	index, err := strconv.Atoi(chi.URLParam(r, "index"))
	if err != nil || index < 0 || index >= chunkCount(job.InputSize) {
		writeError(w, http.StatusBadRequest, "Invalid chunk index")
		return
	}
	expected := chunkLen(job.InputSize, index)

	key, err := filecrypto.DeriveKey(a.cfg.MasterKey, job.ID)
	if err != nil {
		log.Printf("[upload] key derivation error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal error")
		return
	}

	part, err := a.store.CreatePart(job.ID, index)
	if err != nil {
		log.Printf("[upload] create part error: %v", err)
		writeError(w, http.StatusInternalServerError, "Storage error")
		return
	}

	body := &countingReader{r: http.MaxBytesReader(w, r.Body, expected)}
	encErr := filecrypto.EncryptStream(key, body, part)
	syncErr := part.Sync()
	part.Close()

	if encErr != nil || syncErr != nil {
		a.store.DiscardPart(job.ID, index)
		var maxErr *http.MaxBytesError
		if errors.As(encErr, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "Chunk too large")
			return
		}
		log.Printf("[upload] chunk %d of %s failed: enc=%v sync=%v", index, job.ID, encErr, syncErr)
		writeError(w, http.StatusBadRequest, "Failed to receive chunk")
		return
	}

	if body.n != expected {
		a.store.DiscardPart(job.ID, index)
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("Chunk %d should be %d bytes, got %d", index, expected, body.n))
		return
	}

	if err := a.store.CommitPart(job.ID, index); err != nil {
		log.Printf("[upload] commit part error: %v", err)
		a.store.DiscardPart(job.ID, index)
		writeError(w, http.StatusInternalServerError, "Storage error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (a *app) handleCompleteUpload(w http.ResponseWriter, r *http.Request) {
	job := a.uploadJob(w, r)
	if job == nil {
		return
	}
	ctx := r.Context()
	total := chunkCount(job.InputSize)

	for i := 0; i < total; i++ {
		f, err := a.store.OpenPart(job.ID, i)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("Chunk %d is missing", i))
			return
		}
		f.Close()
	}

	key, err := filecrypto.DeriveKey(a.cfg.MasterKey, job.ID)
	if err != nil {
		log.Printf("[upload] key derivation error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal error")
		return
	}

	fail := func(status int, msg string) {
		a.db.DeleteJob(ctx, job.ID)
		a.store.DeleteJobFiles(job.ID)
		writeError(w, status, msg)
	}

	dst, err := a.store.CreateInput(job.ID)
	if err != nil {
		log.Printf("[upload] create storage file error: %v", err)
		fail(http.StatusInternalServerError, "Storage error")
		return
	}

	pr, pw := io.Pipe()
	go func() {
		var err error
		for i := 0; i < total && err == nil; i++ {
			var f io.ReadCloser
			if f, err = a.store.OpenPart(job.ID, i); err != nil {
				break
			}
			err = filecrypto.DecryptStream(key, f, pw)
			f.Close()
		}
		pw.CloseWithError(err)
	}()

	plain := &countingReader{r: pr}
	encErr := filecrypto.EncryptStream(key, plain, dst)
	pr.CloseWithError(io.ErrClosedPipe)
	syncErr := dst.Sync()
	dst.Close()

	if encErr != nil || syncErr != nil {
		log.Printf("[upload] assemble error: enc=%v sync=%v", encErr, syncErr)
		fail(http.StatusInternalServerError, "Failed to process upload")
		return
	}
	if plain.n != job.InputSize {
		log.Printf("[upload] size mismatch for %s: got %d, want %d", job.ID, plain.n, job.InputSize)
		fail(http.StatusBadRequest, "Uploaded data does not match the declared size")
		return
	}
	a.store.DeleteParts(job.ID)

	if err := a.queue.Enqueue(ctx, job.ID); err != nil {
		log.Printf("[upload] enqueue error: %v", err)
		fail(http.StatusInternalServerError, "Failed to queue job")
		return
	}

	log.Printf("[upload] Job %s created: %s (%s, %d chunks)",
		job.ID, job.Operation, formatBytes(job.InputSize), total)

	writeJSON(w, http.StatusCreated, job.ToResponse())
}
