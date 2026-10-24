package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"fileforge/internal/config"
	"fileforge/internal/database"
	"fileforge/internal/metrics"
	"fileforge/internal/storage"
	"fileforge/internal/tmpfs"
)

type worker struct {
	cfg     *config.Config
	db      *database.DB
	store   *storage.Storage
	metrics *metrics.Metrics

	// lastTick is the unix-nano time of the last sign of life: a claim attempt or a heartbeat.
	lastTick atomic.Int64
}

func main() {
	log.SetFlags(log.LstdFlags)
	log.Println("FileForge Worker starting...")

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Config error: %v", err)
	}

	db, err := database.New(cfg.DSN())
	if err != nil {
		log.Fatalf("Database error: %v", err)
	}
	defer db.Close()

	store, err := storage.New(cfg.StoragePath)
	if err != nil {
		log.Fatalf("Storage error: %v", err)
	}

	if err := os.MkdirAll(cfg.TmpDir, 0700); err != nil {
		log.Fatalf("tmpfs directory error: %v", err)
	}
	if err := tmpfs.Check(cfg.TmpDir); err != nil {
		if os.Getenv("ALLOW_DISK_TMP") != "true" {
			log.Fatalf("%v: plaintext must stay in memory; mount a memory-backed volume at TMP_DIR or set ALLOW_DISK_TMP=true for development", err)
		}
		log.Printf("WARNING: %v; plaintext may touch disk (ALLOW_DISK_TMP=true)", err)
	}

	w := &worker{cfg: cfg, db: db, store: store, metrics: metrics.New()}
	w.tick()

	srv := &http.Server{
		Addr:              cfg.WorkerHTTPAddr,
		Handler:           w.httpHandler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("HTTP listener error: %v", err)
		}
	}()

	// claimCtx stops claiming. jobCtx outlives it so in-flight jobs can finish during the drain.
	claimCtx, stopClaiming := context.WithCancel(context.Background())
	defer stopClaiming()
	jobCtx, abortJobs := context.WithCancel(context.Background())
	defer abortJobs()

	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)

	var wg sync.WaitGroup
	for i := 0; i < cfg.WorkerConcurrency; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			w.run(claimCtx, jobCtx, id)
		}(i)
	}

	log.Printf("Worker ready - %d goroutines claiming jobs", cfg.WorkerConcurrency)

	<-done
	log.Println("Shutting down worker: no longer claiming jobs, draining")
	stopClaiming()

	drained := make(chan struct{})
	go func() {
		wg.Wait()
		close(drained)
	}()

	select {
	case <-drained:
		log.Println("All jobs finished")
	case <-time.After(cfg.DrainTimeout):
		log.Printf("Drain timeout (%v): releasing unfinished jobs", cfg.DrainTimeout)
		abortJobs()
		select {
		case <-drained:
		case <-time.After(20 * time.Second):
			log.Println("Some jobs could not be released; their leases will expire")
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)

	log.Println("Worker stopped.")
}

func (w *worker) tick() { w.lastTick.Store(time.Now().UnixNano()) }

func (w *worker) sinceTick() time.Duration {
	return time.Since(time.Unix(0, w.lastTick.Load()))
}

// liveWindow is how long the worker may go without a sign of life before /live fails. While
// slots are idle the claim loop ticks every poll interval; while every slot is busy with a long
// job, no claim happens and the heartbeats (every lease/4) tick instead. The window covers two
// missed heartbeats, so one slow database round trip does not get a healthy worker killed.
func (w *worker) liveWindow() time.Duration {
	return 3*w.cfg.ClaimPoll + w.cfg.JobLease/2
}

func (w *worker) httpHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/live", func(rw http.ResponseWriter, r *http.Request) {
		if w.sinceTick() > w.liveWindow() {
			http.Error(rw, "claim loop stalled", http.StatusServiceUnavailable)
			return
		}
		rw.Write([]byte("ok\n"))
	})
	mux.Handle("/metrics", w.metrics.Handler())
	return mux
}

// run claims and processes jobs until claimCtx is cancelled.
func (w *worker) run(claimCtx, jobCtx context.Context, id int) {
	for {
		if claimCtx.Err() != nil {
			return
		}

		w.tick()
		claimed, err := w.claim(claimCtx)
		if err != nil {
			if claimCtx.Err() != nil {
				return
			}
			log.Printf("[worker-%d] claim error: %v", id, err)
			sleep(claimCtx, time.Second)
			continue
		}

		if claimed == nil {
			sleep(claimCtx, w.cfg.ClaimPoll)
			continue
		}

		w.metrics.Claims.Inc()
		if claimed.Reclaimed {
			w.metrics.Reclaims.Inc()
		}
		w.processJob(jobCtx, id, claimed)
	}
}

func (w *worker) claim(ctx context.Context) (*database.Claimed, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return w.db.ClaimJob(ctx, w.cfg.JobLease)
}

func sleep(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}
