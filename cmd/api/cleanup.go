package main

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"fileforge/internal/database"
	"fileforge/internal/models"
	"fileforge/internal/storage"
)

const (
	cleanupBatch = 100
	// orphanGrace keeps the sweep away from files that are still being written or whose row
	// was just deleted. It must sit well above lease + drain + the longest upload; hours, not
	// minutes. Live files are protected by their job row anyway; this only bounds how fast
	// leftovers of dead jobs disappear.
	orphanGrace = 3 * time.Hour
)

// Every replica runs this loop; there is no leader. Expired jobs are claimed with SKIP LOCKED,
// so replicas split the work, and the orphan sweep is serialised by an advisory lock.
func (a *app) startCleanup(ctx context.Context) {
	interval := time.Duration(a.cfg.CleanupIntervalMin) * time.Minute
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	log.Printf("[cleanup] Running every %v", interval)

	a.runCleanup()

	for {
		select {
		case <-ctx.Done():
			log.Println("[cleanup] Stopped")
			return
		case <-ticker.C:
			a.runCleanup()
		}
	}
}

func (a *app) runCleanup() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	ok := true

	removed := 0
	for {
		n, err := a.db.CleanupExpiredBatch(ctx, cleanupBatch, func(ids []string) error {
			var errs []error
			for _, id := range ids {
				errs = append(errs, a.store.DeleteJobFiles(id))
			}
			return errors.Join(errs...)
		})
		if err != nil {
			log.Printf("[cleanup] expired jobs error: %v", err)
			ok = false
			break
		}
		removed += n
		if n < cleanupBatch {
			break
		}
	}
	if removed > 0 {
		a.metrics.ExpiredRemoved.Add(float64(removed))
		log.Printf("[cleanup] Removed %d expired jobs + files", removed)
	}

	if n, err := a.db.CleanupInactiveSessions(ctx); err != nil {
		log.Printf("[cleanup] inactive sessions error: %v", err)
		ok = false
	} else if n > 0 {
		log.Printf("[cleanup] Removed %d inactive sessions", n)
	}

	if n, err := a.db.ResetHourlyCounts(ctx); err != nil {
		log.Printf("[cleanup] reset hourly counts error: %v", err)
		ok = false
	} else if n > 0 {
		log.Printf("[cleanup] Reset hourly counts for %d sessions", n)
	}

	if err := a.sweepOrphans(ctx); err != nil {
		log.Printf("[cleanup] orphan sweep error: %v", err)
		ok = false
	}

	if ok {
		a.metrics.CleanupLastOK.SetToCurrentTime()
	}
}

// sweepOrphans deletes files that no job row accounts for. Only one replica sweeps at a time;
// the others see the advisory lock taken and skip.
func (a *app) sweepOrphans(ctx context.Context) error {
	removed := 0
	ran, err := a.db.WithSweepLock(ctx, func(lookup func([]string) (map[string]database.JobFileState, error)) error {
		entries, err := a.store.List()
		if err != nil {
			return err
		}

		now := time.Now()
		var ids []string
		for _, e := range entries {
			if e.JobID != "" && now.Sub(e.ModTime) >= orphanGrace {
				ids = append(ids, e.JobID)
			}
		}
		states, err := lookup(ids)
		if err != nil {
			return err
		}

		for _, e := range entries {
			var st *database.JobFileState
			if s, ok := states[e.JobID]; ok {
				st = &s
			}
			if isOrphan(e, st, now) {
				a.store.Remove(e)
				removed++
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	if ran && removed > 0 {
		a.metrics.OrphansRemoved.Add(float64(removed))
		log.Printf("[cleanup] Removed %d orphaned files", removed)
	}
	return nil
}

// isOrphan decides whether an on-disk item should be deleted. st is nil when the job row is gone.
func isOrphan(e storage.Entry, st *database.JobFileState, now time.Time) bool {
	if now.Sub(e.ModTime) < orphanGrace {
		return false
	}
	if e.JobID == "" || st == nil {
		return true
	}

	finished := st.Status == models.StatusCompleted || st.Status == models.StatusFailed

	switch e.Kind {
	case storage.KindOutput:
		// Only the file the fenced completion recorded is live; the rest are losers or leftovers.
		return st.Status == models.StatusFailed ||
			(st.Status == models.StatusCompleted && e.Name != st.OutputName)
	case storage.KindInput:
		// An assembly nobody committed within the grace period was abandoned by a crashed
		// replica, whatever state the job is in.
		return finished || strings.HasSuffix(e.Name, ".assembling")
	case storage.KindParts:
		return st.Status != models.StatusPending
	}
	return false
}
