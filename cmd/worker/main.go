package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"fileforge/internal/config"
	"fileforge/internal/database"
	"fileforge/internal/queue"
	"fileforge/internal/storage"
)

type worker struct {
	cfg   *config.Config
	db    *database.DB
	queue *queue.Queue
	store *storage.Storage
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
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

	q, err := queue.New(cfg.RedisAddr(), cfg.RedisPoolSize)
	if err != nil {
		log.Fatalf("Redis error: %v", err)
	}
	defer q.Close()

	store, err := storage.New(cfg.StoragePath)
	if err != nil {
		log.Fatalf("Storage error: %v", err)
	}

	if err := os.MkdirAll(cfg.TmpDir, 0700); err != nil {
		log.Fatalf("tmpfs directory error: %v", err)
	}

	w := &worker{cfg: cfg, db: db, queue: q, store: store}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)

	var wg sync.WaitGroup
	for i := 0; i < cfg.WorkerConcurrency; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			w.run(ctx, id)
		}(i)
	}

	log.Printf("Worker ready - %d goroutines listening on queue", cfg.WorkerConcurrency)

	<-done
	log.Println("Shutting down worker...")
	cancel()

	waitCh := make(chan struct{})
	go func() {
		wg.Wait()
		close(waitCh)
	}()

	select {
	case <-waitCh:
		log.Println("All worker goroutines stopped gracefully")
	case <-time.After(2 * time.Minute):
		log.Println("Shutdown timeout - some jobs may not have completed cleanly")
	}

	log.Println("Worker stopped.")
}

func (w *worker) run(ctx context.Context, id int) {
	log.Printf("[worker-%d] Started", id)

	for {
		select {
		case <-ctx.Done():
			log.Printf("[worker-%d] Context cancelled, stopping", id)
			return
		default:
		}

		jobID, err := w.queue.Dequeue(ctx, 5*time.Second)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("[worker-%d] Dequeue error: %v", id, err)
			time.Sleep(time.Second)
			continue
		}

		if jobID == "" {
			continue
		}

		w.processJob(ctx, id, jobID)
	}
}
