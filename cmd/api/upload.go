package main

import (
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"

	"fileforge/internal/database"
	"fileforge/internal/models"
)

const maxFormFieldBytes = 64 << 10

// handleCreateJob accepts a single multipart upload. The body is streamed straight into the
// encrypting writer, never through Go's multipart buffering, which would spill plaintext to a
// temp file. Form fields must therefore precede the file part.
func (a *app) handleCreateJob(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	r.Body = http.MaxBytesReader(w, r.Body, a.cfg.MaxFileSize+10<<20)

	mr, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid form data")
		return
	}

	fields := map[string]string{}
	var filePart *multipart.Part
	for filePart == nil {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			a.writeUploadReadError(w, err)
			return
		}
		if part.FormName() == "file" && part.FileName() != "" {
			filePart = part
			break
		}
		val, err := io.ReadAll(io.LimitReader(part, maxFormFieldBytes))
		if err != nil {
			a.writeUploadReadError(w, err)
			return
		}
		fields[part.FormName()] = string(val)
	}
	if filePart == nil {
		writeError(w, http.StatusBadRequest, "No file provided. Use field name 'file'.")
		return
	}
	defer filePart.Close()

	operation := strings.TrimSpace(fields["operation"])
	if !models.ValidOperations[operation] {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("Invalid operation: %q (send form fields before the file)", operation))
		return
	}

	filename := filepath.Base(filePart.FileName())
	inputExt := normalizeExt(strings.ToLower(strings.TrimPrefix(filepath.Ext(filename), ".")))
	if !models.ValidInputFormat(operation, inputExt) {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("Unsupported input format .%s for %s", inputExt, operation))
		return
	}

	params, err := parseParams(func(k string) string { return fields[k] }, operation, inputExt)
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
		OriginalName: filename,
		Params:       params,
		KeyID:        a.cfg.Keys.CurrentID(),
	}, a.cfg.FileRetentionHours)
	if err != nil {
		log.Printf("[upload] create job error: %v", err)
		writeError(w, http.StatusInternalServerError, "Failed to create job")
		return
	}

	abort := func(status int, msg string) {
		a.db.DeleteJob(ctx, job.ID)
		a.store.DeleteJobFiles(job.ID)
		writeError(w, status, msg)
	}

	key, err := a.cfg.Keys.JobKey(job.KeyID, job.ID)
	if err != nil {
		log.Printf("[upload] key derivation error: %v", err)
		abort(http.StatusInternalServerError, "Internal error")
		return
	}

	dst, err := a.store.CreateAssembly(job.ID)
	if err != nil {
		log.Printf("[upload] create storage file error: %v", err)
		abort(http.StatusInternalServerError, "Storage error")
		return
	}

	body := &countingReader{r: io.LimitReader(filePart, a.cfg.MaxFileSize+1)}
	encErr := filecryptoEncrypt(key, body, dst)
	syncErr := dst.Sync()
	dst.Close()

	if encErr != nil || syncErr != nil {
		var maxErr *http.MaxBytesError
		if errors.As(encErr, &maxErr) {
			abortAssembly(dst.Name())
			abort(http.StatusRequestEntityTooLarge,
				fmt.Sprintf("File too large. Maximum: %s", formatBytes(a.cfg.MaxFileSize)))
			return
		}
		abortAssembly(dst.Name())
		log.Printf("[upload] encrypt error: enc=%v sync=%v", encErr, syncErr)
		abort(http.StatusInternalServerError, "Failed to process upload")
		return
	}
	if body.n == 0 {
		abortAssembly(dst.Name())
		abort(http.StatusBadRequest, "File is empty")
		return
	}
	if body.n > a.cfg.MaxFileSize {
		abortAssembly(dst.Name())
		abort(http.StatusRequestEntityTooLarge,
			fmt.Sprintf("File too large. Maximum: %s", formatBytes(a.cfg.MaxFileSize)))
		return
	}

	if err := a.store.CommitInput(job.ID, dst); err != nil {
		abortAssembly(dst.Name())
		log.Printf("[upload] commit input error: %v", err)
		abort(http.StatusInternalServerError, "Storage error")
		return
	}
	if err := a.db.SetInputSize(ctx, job.ID, body.n); err != nil {
		log.Printf("[upload] %v", err)
		abort(http.StatusInternalServerError, "Failed to create job")
		return
	}
	job.InputSize = body.n

	if queued, err := a.db.EnqueueJob(ctx, job.ID); err != nil || !queued {
		log.Printf("[upload] enqueue error: %v (queued=%v)", err, queued)
		abort(http.StatusInternalServerError, "Failed to queue job")
		return
	}

	log.Printf("[upload] Job %s created: %s .%s (%s)", job.ID, operation, inputExt, formatBytes(body.n))

	writeJSON(w, http.StatusCreated, job.ToResponse())
}

func (a *app) writeUploadReadError(w http.ResponseWriter, err error) {
	var maxErr *http.MaxBytesError
	if errors.As(err, &maxErr) {
		writeError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("File too large. Maximum: %s", formatBytes(a.cfg.MaxFileSize)))
		return
	}
	writeError(w, http.StatusBadRequest, "Invalid form data")
}
