package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"fileforge/internal/models"

	"github.com/google/uuid"
)

// ErrLockLost means the fenced update matched no row: the lease expired and the job was
// reclaimed, or it was deleted. The caller must stop working on the job.
var ErrLockLost = errors.New("job lock lost")

// Claimed is a job this worker holds a lease on.
type Claimed struct {
	Job       *models.Job
	LockToken string
	// Reclaimed is true when the job was taken over from a worker whose lease expired.
	Reclaimed bool
}

// EnqueueJob makes a job claimable. It reports false when the job was already queued or is gone.
func (db *DB) EnqueueJob(ctx context.Context, jobID string) (bool, error) {
	res, err := db.pool.ExecContext(ctx, `
		UPDATE jobs SET queued_at = NOW(), run_after = NOW()
		WHERE id = $1 AND queued_at IS NULL AND status = $2
	`, jobID, models.StatusPending)
	if err != nil {
		return false, fmt.Errorf("enqueue job %s: %w", jobID, err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// ClaimJob atomically picks the oldest claimable job, either pending and due or processing with
// an expired lease, and leases it. A reclaim counts as an attempt, so a job that keeps killing
// its worker eventually exhausts its retries. It returns (nil, nil) when nothing is claimable.
func (db *DB) ClaimJob(ctx context.Context, lease time.Duration) (*Claimed, error) {
	token := uuid.New().String()

	row := db.pool.QueryRowContext(ctx, `
		WITH next AS (
			SELECT id, status AS prev_status
			FROM jobs
			WHERE queued_at IS NOT NULL
			  AND ((status = $2 AND run_after <= NOW())
			    OR (status = $3 AND locked_until < NOW()))
			ORDER BY queued_at
			LIMIT 1
			FOR UPDATE SKIP LOCKED
		)
		UPDATE jobs j SET
			status       = $3,
			lock_token   = $1,
			locked_until = NOW() + make_interval(secs => $4),
			started_at   = NOW(),
			retry_count  = j.retry_count + CASE WHEN next.prev_status = $3 THEN 1 ELSE 0 END
		FROM next
		WHERE j.id = next.id
		RETURNING `+prefixedJobColumns("j")+`, next.prev_status = $3
	`, token, models.StatusPending, models.StatusProcessing, lease.Seconds())

	var reclaimed bool
	job, err := scanJobExtra(row, &reclaimed)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim job: %w", err)
	}
	return &Claimed{Job: job, LockToken: token, Reclaimed: reclaimed}, nil
}

func lockResult(res sql.Result, err error, what, jobID string) error {
	if err != nil {
		return fmt.Errorf("%s %s: %w", what, jobID, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrLockLost
	}
	return nil
}

// ExtendJobLock pushes the lease out by another lease interval.
func (db *DB) ExtendJobLock(ctx context.Context, jobID, token string, lease time.Duration) error {
	res, err := db.pool.ExecContext(ctx, `
		UPDATE jobs SET locked_until = NOW() + make_interval(secs => $3)
		WHERE id = $1 AND lock_token = $2 AND status = $4
	`, jobID, token, lease.Seconds(), models.StatusProcessing)
	return lockResult(res, err, "extend lock", jobID)
}

// CompleteJob records the result. outputName is the file the winning attempt wrote.
func (db *DB) CompleteJob(ctx context.Context, jobID, token, outputName, outputFilename string, outputSize int64) error {
	res, err := db.pool.ExecContext(ctx, `
		UPDATE jobs SET
			status          = $3,
			output_name     = $4,
			output_filename = $5,
			output_size     = $6,
			completed_at    = NOW(),
			lock_token      = NULL,
			locked_until    = NULL
		WHERE id = $1 AND lock_token = $2 AND status = $7
	`, jobID, token, models.StatusCompleted, outputName, outputFilename, outputSize, models.StatusProcessing)
	return lockResult(res, err, "complete job", jobID)
}

// FailJob marks the job permanently failed.
func (db *DB) FailJob(ctx context.Context, jobID, token, msg string) error {
	res, err := db.pool.ExecContext(ctx, `
		UPDATE jobs SET
			status        = $3,
			error_message = $4,
			completed_at  = NOW(),
			lock_token    = NULL,
			locked_until  = NULL
		WHERE id = $1 AND lock_token = $2 AND status = $5
	`, jobID, token, models.StatusFailed, msg, models.StatusProcessing)
	return lockResult(res, err, "fail job", jobID)
}

// ReleaseJob hands the job back untouched, e.g. on shutdown. It does not count as an attempt.
func (db *DB) ReleaseJob(ctx context.Context, jobID, token string) error {
	res, err := db.pool.ExecContext(ctx, `
		UPDATE jobs SET
			status       = $3,
			run_after    = NOW(),
			lock_token   = NULL,
			locked_until = NULL
		WHERE id = $1 AND lock_token = $2 AND status = $4
	`, jobID, token, models.StatusPending, models.StatusProcessing)
	return lockResult(res, err, "release job", jobID)
}

// RetryOrFail counts a failed attempt. Within maxRetries the job goes back to pending, delayed
// by exponential backoff (base * 2^retries, capped); beyond it the job fails for good.
// It returns the status the job ended in.
func (db *DB) RetryOrFail(ctx context.Context, jobID, token, msg string, maxRetries int, backoffBase, backoffCap time.Duration) (string, error) {
	var status string
	err := db.pool.QueryRowContext(ctx, `
		UPDATE jobs SET
			retry_count   = retry_count + 1,
			status        = CASE WHEN retry_count + 1 <= $3 THEN $4::job_status ELSE $5::job_status END,
			run_after     = CASE WHEN retry_count + 1 <= $3
			                     THEN NOW() + make_interval(secs => LEAST($7::float8, $6::float8 * power(2, retry_count)))
			                     ELSE run_after END,
			error_message = $8,
			completed_at  = CASE WHEN retry_count + 1 <= $3 THEN NULL ELSE NOW() END,
			lock_token    = NULL,
			locked_until  = NULL
		WHERE id = $1 AND lock_token = $2 AND status = $9
		RETURNING status
	`, jobID, token, maxRetries, models.StatusPending, models.StatusFailed,
		backoffBase.Seconds(), backoffCap.Seconds(), msg, models.StatusProcessing).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrLockLost
	}
	if err != nil {
		return "", fmt.Errorf("retry job %s: %w", jobID, err)
	}
	return status, nil
}

// assemblyLease is how long a claimed assembly blocks others; a crashed assembler frees the
// upload for a retry after this.
const assemblyLease = 5 * time.Minute

// ClaimAssembly is the fence for completing a chunked upload. Exactly one caller wins per
// upload; a loser, or a call for an upload that is already queued, gets false.
func (db *DB) ClaimAssembly(ctx context.Context, jobID string) (bool, error) {
	res, err := db.pool.ExecContext(ctx, `
		UPDATE jobs SET assembling_at = NOW()
		WHERE id = $1 AND queued_at IS NULL AND status = $2
		  AND (assembling_at IS NULL OR assembling_at < NOW() - make_interval(secs => $3))
	`, jobID, models.StatusPending, assemblyLease.Seconds())
	if err != nil {
		return false, fmt.Errorf("claim assembly %s: %w", jobID, err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// TouchAssembly renews the assembly lease while the assembler is alive. False means the upload
// was queued, failed or deleted meanwhile.
func (db *DB) TouchAssembly(ctx context.Context, jobID string) (bool, error) {
	res, err := db.pool.ExecContext(ctx, `
		UPDATE jobs SET assembling_at = NOW()
		WHERE id = $1 AND queued_at IS NULL AND status = $2 AND assembling_at IS NOT NULL
	`, jobID, models.StatusPending)
	if err != nil {
		return false, fmt.Errorf("touch assembly %s: %w", jobID, err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// FailAssembly marks an upload whose assembly cannot succeed as failed, so a client polling the
// job sees the reason. It does nothing once the job is queued.
func (db *DB) FailAssembly(ctx context.Context, jobID, msg string) error {
	_, err := db.pool.ExecContext(ctx, `
		UPDATE jobs SET status = $2, error_message = $3, completed_at = NOW(), assembling_at = NULL
		WHERE id = $1 AND queued_at IS NULL AND status = $4
	`, jobID, models.StatusFailed, msg, models.StatusPending)
	if err != nil {
		return fmt.Errorf("fail assembly %s: %w", jobID, err)
	}
	return nil
}

// ClaimStaleAssemblies takes over uploads whose assembler died: complete was requested
// (assembling_at set), the lease ran out and the job was never queued. The caller owns the
// returned ids exactly as if it had won ClaimAssembly.
func (db *DB) ClaimStaleAssemblies(ctx context.Context, limit int) ([]string, error) {
	rows, err := db.pool.QueryContext(ctx, `
		UPDATE jobs SET assembling_at = NOW()
		WHERE id IN (
			SELECT id FROM jobs
			WHERE queued_at IS NULL AND status = $1 AND expires_at > NOW()
			  AND assembling_at < NOW() - make_interval(secs => $2)
			ORDER BY assembling_at
			LIMIT $3
			FOR UPDATE SKIP LOCKED
		)
		RETURNING id
	`, models.StatusPending, assemblyLease.Seconds(), limit)
	if err != nil {
		return nil, fmt.Errorf("claim stale assemblies: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// AssemblyLeaseRenewEvery is how often a live assembler must call TouchAssembly.
const AssemblyLeaseRenewEvery = assemblyLease / 4

// SetInputSize records the real size of an upload that was streamed without a declared length.
func (db *DB) SetInputSize(ctx context.Context, jobID string, size int64) error {
	_, err := db.pool.ExecContext(ctx, `UPDATE jobs SET input_size = $2 WHERE id = $1`, jobID, size)
	if err != nil {
		return fmt.Errorf("set input size %s: %w", jobID, err)
	}
	return nil
}
