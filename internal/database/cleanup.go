package database

import (
	"context"
	"fmt"
)

// sweepLockKey guards the orphan-file sweep so only one replica walks the volume at a time.
const sweepLockKey int64 = 7309017002

// CleanupExpiredBatch claims up to limit expired jobs with SKIP LOCKED, calls deleteFiles with
// their ids while still holding the row locks, then deletes the rows. Files go first: a crash in
// between leaves rows behind, which the next pass retries, never files nobody can find.
func (db *DB) CleanupExpiredBatch(ctx context.Context, limit int, deleteFiles func(ids []string) error) (int, error) {
	tx, err := db.pool.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("cleanup expired jobs: %w", err)
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
		SELECT id FROM jobs
		WHERE expires_at < NOW()
		ORDER BY expires_at
		LIMIT $1
		FOR UPDATE SKIP LOCKED
	`, limit)
	if err != nil {
		return 0, fmt.Errorf("cleanup expired jobs: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, fmt.Errorf("cleanup expired jobs: %w", err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("cleanup expired jobs: %w", err)
	}
	if len(ids) == 0 {
		return 0, nil
	}

	// A failure here rolls back, so the rows stay and the next pass retries the files.
	if err := deleteFiles(ids); err != nil {
		return 0, fmt.Errorf("cleanup expired jobs: delete files: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM jobs WHERE id = ANY($1::uuid[])`, uuidArray(ids)); err != nil {
		return 0, fmt.Errorf("cleanup expired jobs: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("cleanup expired jobs: %w", err)
	}
	return len(ids), nil
}

// JobFileState is what the sweep needs to know about a job to judge its files.
type JobFileState struct {
	Status     string
	OutputName string
}

// WithSweepLock runs fn inside a transaction that holds pg_try_advisory_xact_lock. It reports
// false without calling fn when another replica holds the lock. lookup resolves job ids against
// the same transaction; ids that are not in the result have no row.
func (db *DB) WithSweepLock(ctx context.Context, fn func(lookup func(ids []string) (map[string]JobFileState, error)) error) (bool, error) {
	tx, err := db.pool.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("sweep: %w", err)
	}
	defer tx.Rollback()

	var got bool
	if err := tx.QueryRowContext(ctx, `SELECT pg_try_advisory_xact_lock($1)`, sweepLockKey).Scan(&got); err != nil {
		return false, fmt.Errorf("sweep lock: %w", err)
	}
	if !got {
		return false, nil
	}

	lookup := func(ids []string) (map[string]JobFileState, error) {
		out := make(map[string]JobFileState, len(ids))
		if len(ids) == 0 {
			return out, nil
		}
		rows, err := tx.QueryContext(ctx,
			`SELECT id, status, COALESCE(output_name, '') FROM jobs WHERE id = ANY($1::uuid[])`, uuidArray(ids))
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			var st JobFileState
			if err := rows.Scan(&id, &st.Status, &st.OutputName); err != nil {
				return nil, err
			}
			out[id] = st
		}
		return out, rows.Err()
	}

	if err := fn(lookup); err != nil {
		return true, err
	}
	return true, tx.Commit()
}

func uuidArray(ids []string) string {
	b := make([]byte, 0, len(ids)*38+2)
	b = append(b, '{')
	for i, id := range ids {
		if i > 0 {
			b = append(b, ',')
		}
		b = append(b, id...)
	}
	return string(append(b, '}'))
}
