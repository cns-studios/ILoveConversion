package database

import (
	"context"
	"fmt"
	"log"

	_ "github.com/lib/pq"
)

func (db *DB) Migrate(ctx context.Context) error {
	tx, err := db.pool.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	defer tx.Rollback()

	var exists bool
	err = tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_name = 'sessions' AND column_name = 'hourly_window_start'
		)
	`).Scan(&exists)
	if err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	if !exists {
		// Counts and flags from before this column existed included status polls
		// and lifetime totals, so they are reset once along with the schema change.
		_, err = tx.ExecContext(ctx, `
			ALTER TABLE sessions ADD COLUMN hourly_window_start TIMESTAMPTZ NOT NULL DEFAULT NOW();
			UPDATE sessions SET hourly_request_count = 0, is_flagged = FALSE;
		`)
		if err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
		log.Println("[db] Migrated sessions table (hourly_window_start)")
	}

	// Lifetime request totals per IP are no longer kept.
	err = tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_name = 'sessions' AND column_name = 'total_request_count'
		)
	`).Scan(&exists)
	if err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	if exists {
		if _, err := tx.ExecContext(ctx, `ALTER TABLE sessions DROP COLUMN total_request_count`); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
		log.Println("[db] Dropped sessions.total_request_count")
	}

	return tx.Commit()
}
