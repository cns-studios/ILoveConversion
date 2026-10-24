package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	filecrypto "fileforge/internal/crypto"
	"fileforge/internal/database"
	"fileforge/internal/models"
	"fileforge/internal/processor"
	"fileforge/internal/storage"
)

var errLockLost = errors.New("job lock lost")

// permanentError marks failures a retry cannot fix.
type permanentError struct{ msg string }

func (e *permanentError) Error() string { return e.msg }

func permanent(format string, args ...any) error {
	return &permanentError{msg: fmt.Sprintf(format, args...)}
}

type outcome string

const (
	outcomeCompleted outcome = "completed"
	outcomeRetried   outcome = "retried"
	outcomeFailed    outcome = "failed"
	outcomeReleased  outcome = "released"
	outcomeLockLost  outcome = "lock_lost"
)

func (w *worker) processJob(jobCtx context.Context, workerID int, c *database.Claimed) {
	job := c.Job
	start := time.Now()
	log.Printf("[worker-%d] ▶ Job %s (%s, attempt %d)", workerID, job.ID, job.Operation, job.RetryCount+1)

	ctx, cancel := context.WithCancelCause(jobCtx)
	defer cancel(nil)

	hbDone := make(chan struct{})
	hbStopped := make(chan struct{})
	go func() {
		defer close(hbStopped)
		w.heartbeat(ctx, cancel, job.ID, c.LockToken, hbDone)
	}()
	stopHeartbeat := func() {
		close(hbDone)
		<-hbStopped
	}

	outputName := storage.OutputName(job.ID, c.LockToken)
	outputSize, outputFilename, err := w.execute(ctx, workerID, c, outputName)
	stopHeartbeat()

	// DB writes below must survive the job context being cancelled by a drain.
	dbCtx, dbCancel := context.WithTimeout(context.WithoutCancel(jobCtx), 15*time.Second)
	defer dbCancel()

	res := w.finish(ctx, dbCtx, workerID, c, outputName, outputFilename, outputSize, err)

	if res != outcomeCompleted {
		// Whoever won the fenced update owns its own file; ours is a loser or a failure.
		w.store.DeleteOutput(outputName)
	}

	w.metrics.JobDuration.WithLabelValues(job.Operation, string(res)).Observe(time.Since(start).Seconds())
	log.Printf("[worker-%d] ■ Job %s %s in %v", workerID, job.ID, res, time.Since(start).Round(time.Millisecond))
}

// heartbeat extends the lease every lease/4. Only a lost lock cancels the job; a transient
// database error is logged and retried on the next beat, since the lease has slack for it.
func (w *worker) heartbeat(ctx context.Context, cancel context.CancelCauseFunc, jobID, token string, stop <-chan struct{}) {
	t := time.NewTicker(w.cfg.JobLease / 4)
	defer t.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-stop:
			return
		case <-t.C:
		}

		beatCtx, beatCancel := context.WithTimeout(ctx, w.cfg.JobLease/4)
		err := w.db.ExtendJobLock(beatCtx, jobID, token, w.cfg.JobLease)
		beatCancel()

		switch {
		case err == nil:
			w.tick()
		case errors.Is(err, database.ErrLockLost):
			log.Printf("[worker] lock lost for job %s, aborting attempt", jobID)
			cancel(errLockLost)
			return
		case ctx.Err() != nil:
			return
		default:
			log.Printf("[worker] heartbeat for job %s failed (will retry): %v", jobID, err)
		}
	}
}

// execute runs one attempt and, on success, leaves the encrypted output at outputName.
func (w *worker) execute(ctx context.Context, workerID int, c *database.Claimed, outputName string) (int64, string, error) {
	job := c.Job

	if job.RetryCount > w.cfg.MaxRetriesFor(job.Operation) {
		return 0, "", permanent("Job was interrupted too many times")
	}

	tmpDir := filepath.Join(w.cfg.TmpDir, job.ID+"."+c.LockToken)
	if err := os.MkdirAll(tmpDir, 0700); err != nil {
		return 0, "", fmt.Errorf("create temp directory: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	key, err := w.cfg.Keys.JobKey(job.KeyID, job.ID)
	if err != nil {
		return 0, "", permanent("Encryption key unavailable")
	}

	params, err := models.ParseParams(job.Params)
	if err != nil {
		return 0, "", permanent("Invalid parameters: %v", err)
	}

	inputExt := job.InputExt()
	if inputExt == "" {
		inputExt = "bin"
	}
	tmpInput := filepath.Join(tmpDir, "input."+inputExt)

	// Plaintext exists only from here on, and only in tmpfs.
	if err := filecrypto.DecryptFile(key, w.store.InputPath(job.ID), tmpInput); err != nil {
		return 0, "", permanent("Failed to decrypt input: %v", err)
	}

	outExt := params.OutputFormat
	if outExt == "" {
		outExt = inputExt
	}
	tmpOutput := filepath.Join(tmpDir, "output."+outExt)

	log.Printf("[worker-%d] Processing %s: .%s → .%s", workerID, job.Operation, inputExt, outExt)

	processCtx, processCancel := context.WithTimeout(ctx, w.cfg.TimeoutFor(job.Operation))
	err = w.dispatch(processCtx, job.Operation, tmpInput, tmpOutput, tmpDir, params)
	processCancel()
	if err != nil {
		return 0, "", err
	}
	if ctx.Err() != nil {
		return 0, "", context.Cause(ctx)
	}

	info, err := os.Stat(tmpOutput)
	if err != nil || info.Size() == 0 {
		return 0, "", errors.New("Processing completed but output file is missing or empty")
	}

	if err := filecrypto.EncryptFile(key, tmpOutput, w.store.OutputPath(outputName)); err != nil {
		return 0, "", fmt.Errorf("encrypt output: %w", err)
	}

	return info.Size(), models.OutputName(job.OriginalName, params.OutputFormat), nil
}

// finish writes the attempt's result through the fenced updates.
func (w *worker) finish(ctx, dbCtx context.Context, workerID int, c *database.Claimed,
	outputName, outputFilename string, outputSize int64, execErr error) outcome {

	job := c.Job
	cause := context.Cause(ctx)

	switch {
	case errors.Is(cause, errLockLost):
		w.metrics.LockLost.Inc()
		return outcomeLockLost

	case execErr == nil:
		err := w.db.CompleteJob(dbCtx, job.ID, c.LockToken, outputName, outputFilename, outputSize)
		if errors.Is(err, database.ErrLockLost) {
			w.metrics.LockLost.Inc()
			return outcomeLockLost
		}
		if err != nil {
			log.Printf("[worker-%d] complete error for job %s: %v", workerID, job.ID, err)
			return outcomeLockLost // lease will expire and the job is reclaimed
		}
		w.store.DeleteInput(job.ID)
		return outcomeCompleted

	case cause != nil && ctx.Err() != nil && !errors.Is(cause, context.DeadlineExceeded):
		// Drain: hand the job back without counting an attempt.
		if err := w.db.ReleaseJob(dbCtx, job.ID, c.LockToken); err != nil && !errors.Is(err, database.ErrLockLost) {
			log.Printf("[worker-%d] release error for job %s: %v", workerID, job.ID, err)
		}
		return outcomeReleased
	}

	var perm *permanentError
	if errors.As(execErr, &perm) {
		msg := truncate(perm.msg)
		if err := w.db.FailJob(dbCtx, job.ID, c.LockToken, msg); err != nil {
			return w.lostOrLog(workerID, job.ID, err)
		}
		w.metrics.JobFailures.WithLabelValues(job.Operation, "failed").Inc()
		w.store.DeleteInput(job.ID)
		return outcomeFailed
	}

	log.Printf("[worker-%d] ✗ job %s attempt failed: %v", workerID, job.ID, execErr)
	status, err := w.db.RetryOrFail(dbCtx, job.ID, c.LockToken, truncate(execErr.Error()),
		w.cfg.MaxRetriesFor(job.Operation), w.cfg.RetryBackoffBase, w.cfg.RetryBackoffCap)
	if err != nil {
		return w.lostOrLog(workerID, job.ID, err)
	}
	if status == models.StatusFailed {
		w.metrics.JobFailures.WithLabelValues(job.Operation, "failed").Inc()
		w.store.DeleteInput(job.ID)
		return outcomeFailed
	}
	w.metrics.JobFailures.WithLabelValues(job.Operation, "retried").Inc()
	return outcomeRetried
}

func (w *worker) lostOrLog(workerID int, jobID string, err error) outcome {
	if errors.Is(err, database.ErrLockLost) {
		w.metrics.LockLost.Inc()
	} else {
		log.Printf("[worker-%d] state update error for job %s: %v", workerID, jobID, err)
	}
	return outcomeLockLost
}

func truncate(msg string) string {
	if len(msg) > 1000 {
		return msg[:1000] + "…"
	}
	return msg
}

func (w *worker) dispatch(ctx context.Context, operation, inputPath, outputPath, tmpDir string, params models.JobParams) error {
	switch operation {
	case models.OpImageConvert:
		return processor.ImageConvert(ctx, inputPath, outputPath, params)
	case models.OpImageCompress:
		return processor.ImageCompress(ctx, inputPath, outputPath, params)
	case models.OpImageRemoveBG:
		return processor.ImageRemoveBG(ctx, inputPath, outputPath, w.cfg.RembgURL, params)
	case models.OpPDFCompress:
		return processor.PDFCompress(ctx, inputPath, outputPath, tmpDir, params)
	case models.OpAudioConvert:
		return processor.AudioConvert(ctx, inputPath, outputPath, params)
	case models.OpAudioCompress:
		return processor.AudioCompress(ctx, inputPath, outputPath, params)
	case models.OpVideoCompress:
		return processor.VideoCompress(ctx, inputPath, outputPath, params)
	default:
		return permanent("unsupported operation: %s", operation)
	}
}
