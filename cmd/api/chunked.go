package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	filecrypto "fileforge/internal/crypto"
	"fileforge/internal/database"
	"fileforge/internal/models"

	"github.com/go-chi/chi/v5"
)

// uploadChunkSize must stay well under Cloudflare's 100 MB request limit on the free plan, and
// is fixed rather than configurable: replicas must agree on it for the life of an upload.
const uploadChunkSize int64 = 16 << 20

func filecryptoEncrypt(key []byte, src io.Reader, dst io.Writer) error {
	return filecrypto.EncryptStream(key, src, dst)
}

// abortAssembly removes a private assembly file that will never be committed.
func abortAssembly(path string) { os.Remove(path) }

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
		KeyID:        a.cfg.Keys.CurrentID(),
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

	key, err := a.cfg.Keys.JobKey(job.KeyID, job.ID)
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

// assemblyTimeout bounds one assembly attempt; the lease is renewed while it runs.
const assemblyTimeout = 30 * time.Minute

// handleCompleteUpload only claims the assembly and answers 202. Assembling a large file reads
// and rewrites all of it, which can outlast a proxy's response limit (Cloudflare: 100 s), so the
// work runs in the background and the client polls the job like for any other state.
func (a *app) handleCompleteUpload(w http.ResponseWriter, r *http.Request) {
	job := a.uploadJob(w, r)
	if job == nil {
		return
	}
	total := chunkCount(job.InputSize)

	for i := 0; i < total; i++ {
		f, err := a.store.OpenPart(job.ID, i)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("Chunk %d is missing", i))
			return
		}
		f.Close()
	}

	// The database decides who assembles: a second replica (or a retry) gets 409 here instead
	// of racing on the files.
	claimed, err := a.db.ClaimAssembly(r.Context(), job.ID)
	if err != nil {
		log.Printf("[upload] claim assembly error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal error")
		return
	}
	if !claimed {
		writeError(w, http.StatusConflict, "Upload already completed")
		return
	}

	a.startAssembly(job)
	writeJSON(w, http.StatusAccepted, job.ToResponse())
}

func (a *app) startAssembly(job *models.Job) {
	a.assembling.Add(1)
	go func() {
		defer a.assembling.Done()
		ctx, cancel := context.WithTimeout(a.backgroundCtx(), assemblyTimeout)
		defer cancel()
		a.assemble(ctx, job)
	}()
}

// resumeAssemblies finishes uploads whose replica died mid-assembly. The parts are only deleted
// after the input is committed, so the work can simply be redone.
func (a *app) resumeAssemblies(ctx context.Context) {
	ids, err := a.db.ClaimStaleAssemblies(ctx, 10)
	if err != nil {
		log.Printf("[upload] resume assemblies: %v", err)
		return
	}
	for _, id := range ids {
		job, err := a.db.GetJob(ctx, id)
		if err != nil {
			log.Printf("[upload] resume %s: %v", id, err)
			continue
		}
		log.Printf("[upload] Resuming abandoned assembly of %s", id)
		a.startAssembly(job)
	}
}

func (a *app) resumeLoop(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			a.resumeAssemblies(ctx)
		}
	}
}

func (a *app) assemble(ctx context.Context, job *models.Job) {
	total := chunkCount(job.InputSize)

	fail := func(msg string) {
		// Not tied to ctx: the client must learn about the failure even if we are shutting down.
		bg, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		if err := a.db.FailAssembly(bg, job.ID, msg); err != nil {
			log.Printf("[upload] %v", err)
		}
		a.store.DeleteJobFiles(job.ID)
	}

	// Renew the lease for as long as we work, so a slow disk never lets another replica take over.
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		t := time.NewTicker(database.AssemblyLeaseRenewEvery)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				if _, err := a.db.TouchAssembly(ctx, job.ID); err != nil {
					log.Printf("[upload] %v", err)
				}
			}
		}
	}()

	key, err := a.cfg.Keys.JobKey(job.KeyID, job.ID)
	if err != nil {
		log.Printf("[upload] key derivation error: %v", err)
		fail("Internal error")
		return
	}

	for i := 0; i < total; i++ {
		f, err := a.store.OpenPart(job.ID, i)
		if err != nil {
			fail(fmt.Sprintf("Upload is incomplete (chunk %d is missing). Please try again.", i))
			return
		}
		f.Close()
	}

	dst, err := a.store.CreateAssembly(job.ID)
	if err != nil {
		log.Printf("[upload] create storage file error: %v", err)
		fail("Storage error")
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

	plain := &countingReader{r: &ctxReader{ctx: ctx, r: pr}}
	encErr := filecrypto.EncryptStream(key, plain, dst)
	pr.CloseWithError(io.ErrClosedPipe)
	syncErr := dst.Sync()
	dst.Close()

	if ctx.Err() != nil {
		// Shutdown or timeout: leave the parts and the stale lease so another replica resumes.
		os.Remove(dst.Name())
		log.Printf("[upload] assembly of %s interrupted: %v", job.ID, ctx.Err())
		return
	}
	if encErr != nil || syncErr != nil {
		os.Remove(dst.Name())
		log.Printf("[upload] assemble error: enc=%v sync=%v", encErr, syncErr)
		fail("Failed to process upload")
		return
	}
	if plain.n != job.InputSize {
		os.Remove(dst.Name())
		log.Printf("[upload] size mismatch for %s: got %d, want %d", job.ID, plain.n, job.InputSize)
		fail("Uploaded data does not match the declared size")
		return
	}
	if err := a.store.CommitInput(job.ID, dst); err != nil {
		os.Remove(dst.Name())
		log.Printf("[upload] commit input error: %v", err)
		fail("Storage error")
		return
	}

	queued, err := a.db.EnqueueJob(ctx, job.ID)
	if err != nil {
		log.Printf("[upload] enqueue error: %v", err)
		return // lease goes stale, the resume loop retries; the input is already committed
	}
	if !queued {
		// Deleted or failed meanwhile, or another replica got here first.
		return
	}
	a.store.DeleteParts(job.ID)

	log.Printf("[upload] Job %s created: %s (%s, %d chunks)",
		job.ID, job.Operation, formatBytes(job.InputSize), total)
}

// ctxReader makes a blocking copy stop when ctx is cancelled.
type ctxReader struct {
	ctx context.Context
	r   io.Reader
}

func (c *ctxReader) Read(p []byte) (int, error) {
	if err := c.ctx.Err(); err != nil {
		return 0, err
	}
	return c.r.Read(p)
}
