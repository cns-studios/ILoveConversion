package database

import (
	"context"
	"fmt"

	"fileforge/internal/models"
)

// QueueStats is a snapshot of the queue taken in one statement.
type QueueStats struct {
	Pending           int64
	Processing        int64
	OldestPendingAgeS float64
	StorageBytes      int64
	Completed24h      int64
	Failed24h         int64
}

// GetQueueStats counts from the claimable index and tracks storage from row sizes, so nothing
// ever has to walk the volume. Storage is the plaintext size of queued inputs plus finished
// outputs; encryption overhead (about 0.03%) is ignored.
func (db *DB) GetQueueStats(ctx context.Context) (*QueueStats, error) {
	var s QueueStats
	err := db.pool.QueryRowContext(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE status = $1 AND queued_at IS NOT NULL),
			COUNT(*) FILTER (WHERE status = $2),
			COALESCE(EXTRACT(EPOCH FROM NOW() - MIN(run_after)
				FILTER (WHERE status = $1 AND queued_at IS NOT NULL AND run_after <= NOW())), 0)::float8,
			COALESCE(SUM(CASE
				WHEN status IN ($1, $2) AND queued_at IS NOT NULL THEN input_size
				WHEN status = $3 THEN COALESCE(output_size, 0)
				ELSE 0 END), 0)::bigint,
			COUNT(*) FILTER (WHERE status = $3 AND completed_at > NOW() - INTERVAL '24 hours'),
			COUNT(*) FILTER (WHERE status = $4 AND completed_at > NOW() - INTERVAL '24 hours')
		FROM jobs
	`, models.StatusPending, models.StatusProcessing, models.StatusCompleted, models.StatusFailed,
	).Scan(&s.Pending, &s.Processing, &s.OldestPendingAgeS, &s.StorageBytes, &s.Completed24h, &s.Failed24h)
	if err != nil {
		return nil, fmt.Errorf("queue stats: %w", err)
	}
	return &s, nil
}

func (db *DB) GetAdminStats(ctx context.Context) (*models.AdminStats, error) {
	q, err := db.GetQueueStats(ctx)
	if err != nil {
		return nil, err
	}

	s := models.AdminStats{
		QueueLength:   int(q.Pending),
		ActiveJobs:    int(q.Processing),
		Completed24h:  int(q.Completed24h),
		Failed24h:     int(q.Failed24h),
		StorageUsedMB: q.StorageBytes / (1024 * 1024),
	}
	err = db.pool.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sessions WHERE last_request_at > NOW() - INTERVAL '1 hour'`,
	).Scan(&s.ActiveSessions)
	if err != nil {
		return nil, fmt.Errorf("get admin stats: %w", err)
	}
	return &s, nil
}
