package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"fileforge/internal/models"

	"github.com/google/uuid"
)

// These tests need a real Postgres: set TEST_DATABASE_URL to a superuser-ish DSN, for example
// postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable. Each test works in its
// own freshly created database, so tests never see each other's rows.

func adminURL(t *testing.T) *url.URL {
	t.Helper()
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		if os.Getenv("REQUIRE_DB") != "" {
			t.Fatal("TEST_DATABASE_URL not set but REQUIRE_DB is")
		}
		t.Skip("TEST_DATABASE_URL not set; skipping Postgres integration test")
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	return u
}

// newTestDatabase creates an empty database and returns its DSN.
func newTestDatabase(t *testing.T) string {
	t.Helper()
	admin := adminURL(t)

	conn, err := sql.Open("postgres", admin.String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	name := "ilc_test_" + uuid.NewString()[:8]
	if _, err := conn.Exec(`CREATE DATABASE ` + name); err != nil {
		t.Fatalf("create database: %v", err)
	}

	u := *admin
	u.Path = "/" + name
	t.Cleanup(func() {
		c, err := sql.Open("postgres", admin.String())
		if err != nil {
			return
		}
		defer c.Close()
		c.Exec(`DROP DATABASE IF EXISTS ` + name + ` WITH (FORCE)`)
	})
	return u.String()
}

func openDB(t *testing.T, dsn string) *DB {
	t.Helper()
	db, err := New(dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func newMigratedDB(t *testing.T) *DB {
	t.Helper()
	db := openDB(t, newTestDatabase(t))
	if err := db.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func newQueuedJob(t *testing.T, db *DB, sessionID string) *models.Job {
	t.Helper()
	ctx := context.Background()
	job, err := db.CreateJob(ctx, CreateJobParams{
		SessionID:    sessionID,
		Operation:    models.OpImageConvert,
		OriginalName: "a.png",
		InputSize:    10,
		KeyID:        "1",
	}, 1)
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	if ok, err := db.EnqueueJob(ctx, job.ID); err != nil || !ok {
		t.Fatalf("enqueue: ok=%v err=%v", ok, err)
	}
	return job
}

func newSession(t *testing.T, db *DB) string {
	t.Helper()
	s, err := db.TouchSession(context.Background(), "192.0.2.1", false, 1000)
	if err != nil {
		t.Fatalf("touch session: %v", err)
	}
	return s.ID
}

func retryCount(t *testing.T, db *DB, id string) int {
	t.Helper()
	j, err := db.GetJob(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return j.RetryCount
}

func TestConcurrentClaimsNeverOverlap(t *testing.T) {
	db := newMigratedDB(t)
	ctx := context.Background()
	sid := newSession(t, db)

	const jobs = 60
	for i := 0; i < jobs; i++ {
		newQueuedJob(t, db, sid)
	}

	var (
		mu   sync.Mutex
		seen = map[string]int{}
		wg   sync.WaitGroup
	)
	for w := 0; w < 8; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				c, err := db.ClaimJob(ctx, time.Minute)
				if err != nil {
					t.Errorf("claim: %v", err)
					return
				}
				if c == nil {
					return
				}
				mu.Lock()
				seen[c.Job.ID]++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	if len(seen) != jobs {
		t.Fatalf("claimed %d distinct jobs, want %d", len(seen), jobs)
	}
	for id, n := range seen {
		if n != 1 {
			t.Errorf("job %s claimed %d times", id, n)
		}
	}
}

func TestClaimSkipsUnqueuedAndDelayedJobs(t *testing.T) {
	db := newMigratedDB(t)
	ctx := context.Background()
	sid := newSession(t, db)

	// Created but never enqueued: a chunked upload still in progress.
	if _, err := db.CreateJob(ctx, CreateJobParams{
		SessionID: sid, Operation: models.OpImageConvert, OriginalName: "a.png", InputSize: 1, KeyID: "1",
	}, 1); err != nil {
		t.Fatal(err)
	}
	// Enqueued but backing off.
	delayed := newQueuedJob(t, db, sid)
	if _, err := db.pool.Exec(`UPDATE jobs SET run_after = NOW() + INTERVAL '1 hour' WHERE id = $1`, delayed.ID); err != nil {
		t.Fatal(err)
	}

	c, err := db.ClaimJob(ctx, time.Minute)
	if err != nil || c != nil {
		t.Fatalf("claim = %v, %v; want nothing claimable", c, err)
	}
}

func TestExpiredLeaseIsReclaimed(t *testing.T) {
	db := newMigratedDB(t)
	ctx := context.Background()
	job := newQueuedJob(t, db, newSession(t, db))

	first, err := db.ClaimJob(ctx, 200*time.Millisecond)
	if err != nil || first == nil {
		t.Fatalf("first claim: %v, %v", first, err)
	}
	if first.Reclaimed {
		t.Error("first claim reported as reclaim")
	}

	if c, _ := db.ClaimJob(ctx, time.Minute); c != nil {
		t.Fatal("job with a live lease was claimable")
	}

	time.Sleep(400 * time.Millisecond)

	second, err := db.ClaimJob(ctx, time.Minute)
	if err != nil || second == nil {
		t.Fatalf("reclaim: %v, %v", second, err)
	}
	if second.Job.ID != job.ID || !second.Reclaimed {
		t.Errorf("reclaim = job %s reclaimed=%v", second.Job.ID, second.Reclaimed)
	}
	if second.LockToken == first.LockToken {
		t.Error("reclaim reused the lock token")
	}
	if got := retryCount(t, db, job.ID); got != 1 {
		t.Errorf("retry_count after reclaim = %d, want 1", got)
	}
}

func TestStaleWorkerIsFenced(t *testing.T) {
	db := newMigratedDB(t)
	ctx := context.Background()
	job := newQueuedJob(t, db, newSession(t, db))

	stale, _ := db.ClaimJob(ctx, 100*time.Millisecond)
	time.Sleep(250 * time.Millisecond)
	fresh, err := db.ClaimJob(ctx, time.Minute)
	if err != nil || fresh == nil {
		t.Fatalf("reclaim: %v, %v", fresh, err)
	}

	if err := db.ExtendJobLock(ctx, job.ID, stale.LockToken, time.Minute); !errors.Is(err, ErrLockLost) {
		t.Errorf("stale extend = %v, want ErrLockLost", err)
	}
	if err := db.CompleteJob(ctx, job.ID, stale.LockToken, "x", "a.png", 1); !errors.Is(err, ErrLockLost) {
		t.Errorf("stale complete = %v, want ErrLockLost", err)
	}
	if err := db.FailJob(ctx, job.ID, stale.LockToken, "boom"); !errors.Is(err, ErrLockLost) {
		t.Errorf("stale fail = %v, want ErrLockLost", err)
	}
	if err := db.ReleaseJob(ctx, job.ID, stale.LockToken); !errors.Is(err, ErrLockLost) {
		t.Errorf("stale release = %v, want ErrLockLost", err)
	}
	if _, err := db.RetryOrFail(ctx, job.ID, stale.LockToken, "boom", 3, time.Second, time.Minute); !errors.Is(err, ErrLockLost) {
		t.Errorf("stale retry = %v, want ErrLockLost", err)
	}

	got, _ := db.GetJob(ctx, job.ID)
	if got.Status != models.StatusProcessing {
		t.Fatalf("stale worker changed status to %q", got.Status)
	}

	name := job.ID + "." + fresh.LockToken
	if err := db.CompleteJob(ctx, job.ID, fresh.LockToken, name, "a.png", 5); err != nil {
		t.Fatalf("fresh complete: %v", err)
	}
	got, _ = db.GetJob(ctx, job.ID)
	if got.Status != models.StatusCompleted || got.OutputName.String != name {
		t.Errorf("job = %q output_name=%q", got.Status, got.OutputName.String)
	}
}

func TestReleaseLeavesRetryCountAlone(t *testing.T) {
	db := newMigratedDB(t)
	ctx := context.Background()
	job := newQueuedJob(t, db, newSession(t, db))

	c, _ := db.ClaimJob(ctx, time.Minute)
	if err := db.ReleaseJob(ctx, job.ID, c.LockToken); err != nil {
		t.Fatal(err)
	}

	got, _ := db.GetJob(ctx, job.ID)
	if got.Status != models.StatusPending || got.RetryCount != 0 || got.LockToken.Valid {
		t.Errorf("after release: status=%q retry=%d lock=%v", got.Status, got.RetryCount, got.LockToken)
	}

	again, err := db.ClaimJob(ctx, time.Minute)
	if err != nil || again == nil {
		t.Fatalf("released job not claimable: %v, %v", again, err)
	}
}

func TestRetryOrFailBackoffAndLimit(t *testing.T) {
	db := newMigratedDB(t)
	ctx := context.Background()
	job := newQueuedJob(t, db, newSession(t, db))

	c, _ := db.ClaimJob(ctx, time.Minute)
	st, err := db.RetryOrFail(ctx, job.ID, c.LockToken, "boom", 1, time.Hour, 2*time.Hour)
	if err != nil || st != models.StatusPending {
		t.Fatalf("first failure: %q, %v; want pending", st, err)
	}
	got, _ := db.GetJob(ctx, job.ID)
	if got.RetryCount != 1 || !got.RunAfter.After(time.Now().Add(30*time.Minute)) {
		t.Errorf("retry_count=%d run_after=%v; want 1 and ~1h out", got.RetryCount, got.RunAfter)
	}
	if c, _ := db.ClaimJob(ctx, time.Minute); c != nil {
		t.Fatal("job claimable before its backoff elapsed")
	}

	if _, err := db.pool.Exec(`UPDATE jobs SET run_after = NOW() WHERE id = $1`, job.ID); err != nil {
		t.Fatal(err)
	}
	c, _ = db.ClaimJob(ctx, time.Minute)
	st, err = db.RetryOrFail(ctx, job.ID, c.LockToken, "boom again", 1, time.Hour, 2*time.Hour)
	if err != nil || st != models.StatusFailed {
		t.Fatalf("second failure: %q, %v; want failed", st, err)
	}
	got, _ = db.GetJob(ctx, job.ID)
	if got.RetryCount != 2 || got.ErrorMessage.String != "boom again" || !got.CompletedAt.Valid {
		t.Errorf("failed job: retry=%d err=%q completed=%v", got.RetryCount, got.ErrorMessage.String, got.CompletedAt.Valid)
	}
}

func TestConcurrentMigrationsAreSafe(t *testing.T) {
	dsn := newTestDatabase(t)

	const runners = 6
	var wg sync.WaitGroup
	errs := make(chan error, runners)
	for i := 0; i < runners; i++ {
		db := openDB(t, dsn)
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- db.Migrate(context.Background())
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("concurrent migrate: %v", err)
		}
	}

	db := openDB(t, dsn)
	var n int
	if err := db.pool.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	migrations, _ := loadMigrations()
	if n != len(migrations) {
		t.Errorf("schema_migrations has %d rows, want %d", n, len(migrations))
	}
	if err := db.Migrate(context.Background()); err != nil {
		t.Errorf("re-running migrations: %v", err)
	}
}

func TestMigrateUpgradesLegacySchemaWithData(t *testing.T) {
	dsn := newTestDatabase(t)
	db := openDB(t, dsn)

	// A deployment from before the queue existed: the old tables, no schema_migrations, and
	// rows written by the previous release.
	m, _ := loadMigrations()
	if _, err := db.pool.Exec(m[0].sql); err != nil {
		t.Fatal(err)
	}
	const sid = "11111111-1111-4111-8111-111111111111"
	const done = "22222222-2222-4222-8222-222222222222"
	const waiting = "33333333-3333-4333-8333-333333333333"
	for _, q := range []string{
		`INSERT INTO sessions (id, ip_address) VALUES ('` + sid + `', '192.0.2.9')`,
		`INSERT INTO jobs (id, session_id, operation, status, input_filename, input_size, original_name, output_filename, output_size, completed_at)
		 VALUES ('` + done + `', '` + sid + `', 'image_convert', 'completed', '` + done + `', 10, 'a.png', 'a.webp', 5, NOW())`,
		`INSERT INTO jobs (id, session_id, operation, status, input_filename, input_size, original_name)
		 VALUES ('` + waiting + `', '` + sid + `', 'image_convert', 'pending', '` + waiting + `', 10, 'b.png')`,
	} {
		if _, err := db.pool.Exec(q); err != nil {
			t.Fatalf("seed legacy data: %v", err)
		}
	}

	if err := db.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate over legacy schema: %v", err)
	}

	ctx := context.Background()
	got, err := db.GetJob(ctx, done)
	if err != nil {
		t.Fatal(err)
	}
	// The previous release stored the output at outputs/<job id>; downloads must still find it.
	if got.OutputName.String != done || got.KeyID != "1" || got.OutputFilename.String != "a.webp" {
		t.Errorf("legacy completed job: output_name=%q key_id=%q filename=%q", got.OutputName.String, got.KeyID, got.OutputFilename.String)
	}
	// A legacy pending job was never put on the new queue, so nothing claims it half-formed.
	if c, _ := db.ClaimJob(ctx, time.Minute); c != nil {
		t.Errorf("legacy pending job became claimable: %s", c.Job.ID)
	}
}

// Old replicas keep serving while a new release migrates, so migrations may only add.
func TestMigrationsAreExpandOnly(t *testing.T) {
	ms, err := loadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range ms {
		if m.version == 1 {
			continue // the baseline creates the schema the old release already had
		}
		for _, word := range []string{"DROP ", "RENAME ", "TRUNCATE", "DELETE FROM", "ALTER COLUMN"} {
			if strings.Contains(strings.ToUpper(m.sql), word) {
				t.Errorf("%s contains %q; migrations after the baseline must be expand-only", m.name, word)
			}
		}
	}
}

func TestClaimAssemblyIsExclusive(t *testing.T) {
	db := newMigratedDB(t)
	ctx := context.Background()
	job, err := db.CreateJob(ctx, CreateJobParams{
		SessionID: newSession(t, db), Operation: models.OpImageConvert, OriginalName: "a.png", InputSize: 1, KeyID: "1",
	}, 1)
	if err != nil {
		t.Fatal(err)
	}

	var (
		wins int32
		wg   sync.WaitGroup
	)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok, err := db.ClaimAssembly(ctx, job.ID)
			if err != nil {
				t.Errorf("claim assembly: %v", err)
			}
			if ok {
				atomic.AddInt32(&wins, 1)
			}
		}()
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("%d replicas won the assembly, want exactly 1", wins)
	}

	// A crashed assembler frees the upload once its lease runs out.
	if _, err := db.pool.Exec(`UPDATE jobs SET assembling_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`, job.ID); err != nil {
		t.Fatal(err)
	}
	if ok, _ := db.ClaimAssembly(ctx, job.ID); !ok {
		t.Error("stale assembly claim was not retakeable")
	}

	// Once queued, nobody may assemble again.
	db.EnqueueJob(ctx, job.ID)
	db.pool.Exec(`UPDATE jobs SET assembling_at = NULL WHERE id = $1`, job.ID)
	if ok, _ := db.ClaimAssembly(ctx, job.ID); ok {
		t.Error("assembly claimed for an already queued job")
	}
}

func TestCleanupRollsBackWhenFileDeletionFails(t *testing.T) {
	db := newMigratedDB(t)
	ctx := context.Background()
	j := newQueuedJob(t, db, newSession(t, db))
	db.pool.Exec(`UPDATE jobs SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, j.ID)

	if _, err := db.CleanupExpiredBatch(ctx, 10, func([]string) error { return errors.New("disk on fire") }); err == nil {
		t.Fatal("file deletion error was swallowed")
	}
	if _, err := db.GetJob(ctx, j.ID); err != nil {
		t.Fatalf("row deleted although its files were not: %v", err)
	}
	if n, err := db.CleanupExpiredBatch(ctx, 10, func([]string) error { return nil }); err != nil || n != 1 {
		t.Errorf("retry = %d, %v; want the row cleaned", n, err)
	}
}

func TestCleanupExpiredBatch(t *testing.T) {
	db := newMigratedDB(t)
	ctx := context.Background()
	sid := newSession(t, db)

	expired := newQueuedJob(t, db, sid)
	live := newQueuedJob(t, db, sid)
	if _, err := db.pool.Exec(`UPDATE jobs SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, expired.ID); err != nil {
		t.Fatal(err)
	}

	var gotIDs []string
	n, err := db.CleanupExpiredBatch(ctx, 10, func(ids []string) error { gotIDs = ids; return nil })
	if err != nil || n != 1 || len(gotIDs) != 1 || gotIDs[0] != expired.ID {
		t.Fatalf("cleanup = %d, %v, ids=%v", n, err, gotIDs)
	}
	if _, err := db.GetJob(ctx, expired.ID); err == nil {
		t.Error("expired job row still present")
	}
	if _, err := db.GetJob(ctx, live.ID); err != nil {
		t.Errorf("live job removed: %v", err)
	}
}

func TestConcurrentCleanupNeverDoubleClaims(t *testing.T) {
	db := newMigratedDB(t)
	ctx := context.Background()
	sid := newSession(t, db)

	const jobs = 40
	for i := 0; i < jobs; i++ {
		j := newQueuedJob(t, db, sid)
		db.pool.Exec(`UPDATE jobs SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, j.ID)
	}

	var (
		mu   sync.Mutex
		seen = map[string]int{}
		wg   sync.WaitGroup
	)
	for w := 0; w < 6; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				n, err := db.CleanupExpiredBatch(ctx, 5, func(ids []string) error {
					mu.Lock()
					for _, id := range ids {
						seen[id]++
					}
					mu.Unlock()
					return nil
				})
				if err != nil {
					t.Errorf("cleanup: %v", err)
					return
				}
				if n == 0 {
					return
				}
			}
		}()
	}
	wg.Wait()

	if len(seen) != jobs {
		t.Fatalf("cleaned %d jobs, want %d", len(seen), jobs)
	}
	for id, n := range seen {
		if n != 1 {
			t.Errorf("job %s handed to %d cleaners", id, n)
		}
	}
}

func TestSweepLockIsExclusive(t *testing.T) {
	db := newMigratedDB(t)
	ctx := context.Background()

	inner := make(chan bool, 1)
	ran, err := db.WithSweepLock(ctx, func(func([]string) (map[string]JobFileState, error)) error {
		ok, err := db.WithSweepLock(ctx, func(func([]string) (map[string]JobFileState, error)) error {
			return fmt.Errorf("second sweeper must not run")
		})
		if err != nil {
			return err
		}
		inner <- ok
		return nil
	})
	if err != nil || !ran {
		t.Fatalf("outer sweep: ran=%v err=%v", ran, err)
	}
	if <-inner {
		t.Error("second sweeper acquired the lock while the first held it")
	}

	if ran, err := db.WithSweepLock(ctx, func(func([]string) (map[string]JobFileState, error)) error { return nil }); err != nil || !ran {
		t.Errorf("lock not released after sweep: ran=%v err=%v", ran, err)
	}
}

func TestQueueStats(t *testing.T) {
	db := newMigratedDB(t)
	sid := newSession(t, db)
	newQueuedJob(t, db, sid)
	newQueuedJob(t, db, sid)

	s, err := db.GetQueueStats(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.Pending != 2 || s.StorageBytes != 20 {
		t.Errorf("stats = %+v", s)
	}
}

func TestAssemblyLeaseRenewFailAndResume(t *testing.T) {
	db := newMigratedDB(t)
	ctx := context.Background()
	sid := newSession(t, db)
	mk := func() *models.Job {
		j, err := db.CreateJob(ctx, CreateJobParams{
			SessionID: sid, Operation: models.OpImageConvert, OriginalName: "a.png", InputSize: 1, KeyID: "1",
		}, 1)
		if err != nil {
			t.Fatal(err)
		}
		return j
	}
	age := func(id string) {
		if _, err := db.pool.Exec(`UPDATE jobs SET assembling_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`, id); err != nil {
			t.Fatal(err)
		}
	}

	// An upload nobody asked to complete is never resumed.
	untouched := mk()
	age(untouched.ID) // no-op for the claim: assembling_at is set below only for claimed jobs
	if _, err := db.pool.Exec(`UPDATE jobs SET assembling_at = NULL WHERE id = $1`, untouched.ID); err != nil {
		t.Fatal(err)
	}

	// A live assembler keeps its lease; a dead one loses it.
	live, dead := mk(), mk()
	for _, j := range []*models.Job{live, dead} {
		if ok, _ := db.ClaimAssembly(ctx, j.ID); !ok {
			t.Fatal("claim failed")
		}
	}
	age(live.ID)
	if ok, err := db.TouchAssembly(ctx, live.ID); err != nil || !ok {
		t.Fatalf("touch = %v, %v", ok, err)
	}
	age(dead.ID)

	ids, err := db.ClaimStaleAssemblies(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 || ids[0] != dead.ID {
		t.Fatalf("resumed %v, want only %s", ids, dead.ID)
	}
	// The takeover renewed the lease, so a second replica cannot take it again.
	if ids, _ := db.ClaimStaleAssemblies(ctx, 10); len(ids) != 0 {
		t.Fatalf("assembly taken twice: %v", ids)
	}

	// Failing is visible to a poller and ends the upload for good.
	if err := db.FailAssembly(ctx, dead.ID, "boom"); err != nil {
		t.Fatal(err)
	}
	j, err := db.GetJob(ctx, dead.ID)
	if err != nil {
		t.Fatal(err)
	}
	if j.Status != models.StatusFailed || j.ErrorMessage.String != "boom" {
		t.Fatalf("job = %s %q", j.Status, j.ErrorMessage.String)
	}
	if ok, _ := db.TouchAssembly(ctx, dead.ID); ok {
		t.Error("touch succeeded on a failed upload")
	}
	age(dead.ID)
	if ids, _ := db.ClaimStaleAssemblies(ctx, 10); len(ids) != 0 {
		t.Errorf("failed upload resumed: %v", ids)
	}

	// Once queued, FailAssembly must not clobber the job.
	if queued, _ := db.EnqueueJob(ctx, live.ID); !queued {
		t.Fatal("enqueue failed")
	}
	if err := db.FailAssembly(ctx, live.ID, "late"); err != nil {
		t.Fatal(err)
	}
	if j, _ := db.GetJob(ctx, live.ID); j.Status != models.StatusPending {
		t.Errorf("queued job status = %s after FailAssembly", j.Status)
	}
}
