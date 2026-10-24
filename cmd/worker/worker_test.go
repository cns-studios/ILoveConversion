package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"fileforge/internal/config"
	"fileforge/internal/database"
	"fileforge/internal/metrics"
	"fileforge/internal/models"
	"fileforge/internal/storage"
	"fileforge/internal/testdb"
)

func newTestWorker(t *testing.T, db *database.DB) *worker {
	t.Helper()
	store, err := storage.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return &worker{
		cfg: &config.Config{
			JobLease:         4 * time.Second, // heartbeat every second
			RetryBackoffBase: time.Second,
			RetryBackoffCap:  time.Minute,
			Retries:          map[string]int{models.OpImageConvert: 2},
			TmpDir:           t.TempDir(),
		},
		db:      db,
		store:   store,
		metrics: metrics.New(),
	}
}

func claimOne(t *testing.T, db *database.DB, w *worker) *database.Claimed {
	t.Helper()
	ctx := context.Background()
	s, err := db.TouchSession(ctx, "192.0.2.1", false, 1000)
	if err != nil {
		t.Fatal(err)
	}
	job, err := db.CreateJob(ctx, database.CreateJobParams{
		SessionID: s.ID, Operation: models.OpImageConvert, OriginalName: "a.png", InputSize: 1, KeyID: "1",
	}, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.EnqueueJob(ctx, job.ID); err != nil {
		t.Fatal(err)
	}
	c, err := db.ClaimJob(ctx, w.cfg.JobLease)
	if err != nil || c == nil {
		t.Fatalf("claim: %v, %v", c, err)
	}
	return c
}

func TestHeartbeatCancelsJobOnLockLoss(t *testing.T) {
	db := testdb.New(t)
	w := newTestWorker(t, db)
	c := claimOne(t, db, w)

	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)
	stop := make(chan struct{})
	defer close(stop)
	go w.heartbeat(ctx, cancel, c.Job.ID, c.LockToken, stop)

	// Another worker takes the job over.
	if err := db.ReleaseJob(context.Background(), c.Job.ID, c.LockToken); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ClaimJob(context.Background(), time.Minute); err != nil {
		t.Fatal(err)
	}

	select {
	case <-ctx.Done():
		if !errors.Is(context.Cause(ctx), errLockLost) {
			t.Errorf("cancelled with %v, want errLockLost", context.Cause(ctx))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("heartbeat did not cancel the job after the lock was lost")
	}
}

func TestHeartbeatIgnoresTransientErrors(t *testing.T) {
	db := testdb.New(t)
	w := newTestWorker(t, db)
	c := claimOne(t, db, w)

	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)
	stop := make(chan struct{})
	defer close(stop)

	db.Close() // every heartbeat now fails with a non-lock error
	go w.heartbeat(ctx, cancel, c.Job.ID, c.LockToken, stop)

	select {
	case <-ctx.Done():
		t.Fatalf("job cancelled on a transient database error: %v", context.Cause(ctx))
	case <-time.After(2500 * time.Millisecond):
	}
}

func TestHeartbeatExtendsLease(t *testing.T) {
	db := testdb.New(t)
	w := newTestWorker(t, db)
	c := claimOne(t, db, w)
	before := c.Job.LockedUntil.Time

	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)
	stop := make(chan struct{})
	defer close(stop)
	go w.heartbeat(ctx, cancel, c.Job.ID, c.LockToken, stop)

	time.Sleep(1500 * time.Millisecond)
	got, err := db.GetJob(context.Background(), c.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !got.LockedUntil.Time.After(before) {
		t.Errorf("locked_until %v not extended past %v", got.LockedUntil.Time, before)
	}
	if time.Since(time.Unix(0, w.lastTick.Load())) > 2*time.Second {
		t.Error("heartbeat did not tick the liveness watchdog")
	}
}

func TestFinishReleasesOnDrainWithoutCountingAnAttempt(t *testing.T) {
	db := testdb.New(t)
	w := newTestWorker(t, db)
	c := claimOne(t, db, w)

	ctx, cancel := context.WithCancelCause(context.Background())
	cancel(context.Canceled) // drain aborts the job
	got := w.finish(ctx, context.Background(), 0, c, "x", "a.png", 0, context.Canceled)
	if got != outcomeReleased {
		t.Fatalf("outcome = %q, want released", got)
	}

	job, _ := db.GetJob(context.Background(), c.Job.ID)
	if job.Status != models.StatusPending || job.RetryCount != 0 {
		t.Errorf("job after drain: status=%q retry=%d", job.Status, job.RetryCount)
	}
}

func TestFinishRetriesTransientFailureThenFails(t *testing.T) {
	db := testdb.New(t)
	w := newTestWorker(t, db)
	w.cfg.Retries[models.OpImageConvert] = 0 // first failure is final
	c := claimOne(t, db, w)

	got := w.finish(context.Background(), context.Background(), 0, c, "x", "a.png", 0, errors.New("ffmpeg exploded"))
	if got != outcomeFailed {
		t.Fatalf("outcome = %q, want failed", got)
	}
	job, _ := db.GetJob(context.Background(), c.Job.ID)
	if job.Status != models.StatusFailed || job.ErrorMessage.String != "ffmpeg exploded" {
		t.Errorf("job: status=%q err=%q", job.Status, job.ErrorMessage.String)
	}
}

func TestFinishRejectsStaleCompletionAndLoserFileIsDeleted(t *testing.T) {
	db := testdb.New(t)
	w := newTestWorker(t, db)
	stale := claimOne(t, db, w)

	// The stale worker's lease expires and someone else takes the job.
	if err := db.ReleaseJob(context.Background(), stale.Job.ID, stale.LockToken); err != nil {
		t.Fatal(err)
	}
	fresh, _ := db.ClaimJob(context.Background(), time.Minute)

	name := storage.OutputName(stale.Job.ID, stale.LockToken)
	path := w.store.OutputPath(name)
	if err := os.WriteFile(path, []byte("ciphertext"), 0o600); err != nil {
		t.Fatal(err)
	}

	got := w.finish(context.Background(), context.Background(), 0, stale, name, "a.png", 10, nil)
	if got != outcomeLockLost {
		t.Fatalf("stale completion outcome = %q, want lock_lost", got)
	}

	// processJob deletes the file of any attempt that did not complete; mirror that contract.
	w.store.DeleteOutput(name)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("loser output file still present")
	}

	job, _ := db.GetJob(context.Background(), stale.Job.ID)
	if job.Status != models.StatusProcessing || job.LockToken.String != fresh.LockToken {
		t.Errorf("stale worker disturbed the job: status=%q token=%q", job.Status, job.LockToken.String)
	}
}

func TestLiveWatchdog(t *testing.T) {
	w := &worker{cfg: &config.Config{ClaimPoll: time.Second}, metrics: metrics.New()}
	w.tick()
	if w.sinceTick() > w.liveWindow() {
		t.Error("fresh tick reported as stalled")
	}
	w.lastTick.Store(time.Now().Add(-2 * w.liveWindow()).UnixNano())
	if w.sinceTick() <= w.liveWindow() {
		t.Error("stale tick not reported as stalled")
	}
}

// With every slot busy there is no claim loop activity. A job that outlasts the liveness window
// must still keep /live green through its heartbeats, or Kubernetes would kill a healthy worker.
func TestLiveStaysGreenDuringJobLongerThanWindow(t *testing.T) {
	db := testdb.New(t)
	w := newTestWorker(t, db)
	w.cfg.ClaimPoll = 100 * time.Millisecond
	c := claimOne(t, db, w)
	w.tick()

	window := w.liveWindow()
	runFor := 3 * window
	if runFor < 5*time.Second {
		runFor = 5 * time.Second
	}

	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)
	stop := make(chan struct{})
	defer close(stop)
	go w.heartbeat(ctx, cancel, c.Job.ID, c.LockToken, stop) // the only activity: no claim loop

	h := w.httpHandler()
	deadline := time.Now().Add(runFor)
	for time.Now().Before(deadline) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/live", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("/live = %d after %v (window %v) while a job was running", rec.Code,
				runFor-time.Until(deadline), window)
		}
		time.Sleep(250 * time.Millisecond)
	}
	if runFor <= window {
		t.Fatalf("test ran %v, not longer than the window %v", runFor, window)
	}
}
