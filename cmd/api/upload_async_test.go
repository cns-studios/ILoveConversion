package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"fileforge/internal/config"
	filecrypto "fileforge/internal/crypto"
	"fileforge/internal/database"
	"fileforge/internal/metrics"
	"fileforge/internal/models"
	"fileforge/internal/storage"
	"fileforge/internal/testdb"

	"github.com/go-chi/chi/v5"
)

func newUploadApp(t *testing.T) (*app, string) {
	t.Helper()
	db := testdb.New(t)
	store, err := storage.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	keys, err := filecrypto.NewKeyRing("1", bytes.Repeat([]byte{7}, 32), nil)
	if err != nil {
		t.Fatal(err)
	}
	a := &app{
		cfg:     &config.Config{MaxFileSize: 1 << 30, Keys: keys},
		db:      db,
		store:   store,
		metrics: metrics.New(),
	}
	s, err := db.TouchSession(context.Background(), "192.0.2.1", false, 1000)
	if err != nil {
		t.Fatal(err)
	}
	return a, s.ID
}

func (a *app) callComplete(t *testing.T, jobID, sessionID string) *httptest.ResponseRecorder {
	t.Helper()
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", jobID)
	req := httptest.NewRequest(http.MethodPost, "/api/uploads/"+jobID+"/complete", nil)
	req = req.WithContext(context.WithValue(
		context.WithValue(req.Context(), chi.RouteCtxKey, rctx),
		sessionCtxKey, &models.Session{ID: sessionID}))
	rec := httptest.NewRecorder()
	a.handleCompleteUpload(rec, req)
	return rec
}

// putParts encrypts plain into chunk files exactly like handleUploadChunk does.
func putParts(t *testing.T, a *app, job *models.Job, plain []byte) {
	t.Helper()
	key, err := a.cfg.Keys.JobKey(job.KeyID, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < chunkCount(int64(len(plain))); i++ {
		start := int64(i) * uploadChunkSize
		end := start + chunkLen(int64(len(plain)), i)
		part, err := a.store.CreatePart(job.ID, i)
		if err != nil {
			t.Fatal(err)
		}
		if err := filecrypto.EncryptStream(key, bytes.NewReader(plain[start:end]), part); err != nil {
			t.Fatal(err)
		}
		part.Close()
		if err := a.store.CommitPart(job.ID, i); err != nil {
			t.Fatal(err)
		}
	}
}

func newJobParams(sessionID string, size int64, a *app) database.CreateJobParams {
	return database.CreateJobParams{
		SessionID: sessionID, Operation: models.OpImageConvert, OriginalName: "a.png",
		InputSize: size, KeyID: a.cfg.Keys.CurrentID(),
	}
}

func TestCompleteReturnsBeforeAssemblyFinishes(t *testing.T) {
	a, sid := newUploadApp(t)
	ctx := context.Background()

	plain := bytes.Repeat([]byte("0123456789abcdef"), int(uploadChunkSize)/16+1000) // two chunks
	job, err := a.db.CreateJob(ctx, newJobParams(sid, int64(len(plain)), a), 1)
	if err != nil {
		t.Fatal(err)
	}
	putParts(t, a, job, plain)

	rec := a.callComplete(t, job.ID, sid)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("complete = %d %s, want 202", rec.Code, rec.Body)
	}
	// A retry while the first call is assembling or done is fenced.
	if rec2 := a.callComplete(t, job.ID, sid); rec2.Code != http.StatusConflict {
		t.Errorf("second complete = %d, want 409", rec2.Code)
	}

	a.assembling.Wait()

	got, err := a.db.GetJob(ctx, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !got.QueuedAt.Valid || got.Status != models.StatusPending {
		t.Fatalf("job not queued: status=%s queued=%v", got.Status, got.QueuedAt.Valid)
	}

	// The committed input decrypts to exactly what was uploaded; the parts are gone.
	in, err := a.store.OpenInput(job.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	key, _ := a.cfg.Keys.JobKey(job.KeyID, job.ID)
	var out bytes.Buffer
	if err := filecrypto.DecryptStream(key, in, &out); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out.Bytes(), plain) {
		t.Error("assembled input differs from the upload")
	}
	if f, err := a.store.OpenPart(job.ID, 0); err == nil {
		f.Close()
		t.Error("parts were not deleted after queueing")
	}
}

func TestAssemblyFailureIsVisibleToPolling(t *testing.T) {
	a, sid := newUploadApp(t)
	ctx := context.Background()

	// Declared size does not match the parts that were uploaded.
	plain := bytes.Repeat([]byte("x"), 1000)
	job, err := a.db.CreateJob(ctx, newJobParams(sid, 2000, a), 1)
	if err != nil {
		t.Fatal(err)
	}
	putParts(t, a, job, plain)

	if rec := a.callComplete(t, job.ID, sid); rec.Code != http.StatusAccepted {
		t.Fatalf("complete = %d %s", rec.Code, rec.Body)
	}
	a.assembling.Wait()

	got, err := a.db.GetJob(ctx, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != models.StatusFailed || !strings.Contains(got.ErrorMessage.String, "declared size") {
		t.Fatalf("status=%s error=%q, want failed with a size message", got.Status, got.ErrorMessage.String)
	}
	if a.store.InputExists(job.ID) {
		t.Error("input of a failed assembly was kept")
	}
}

func TestShutdownInterruptsAssemblyButKeepsParts(t *testing.T) {
	a, sid := newUploadApp(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // shutdown already underway when the assembly starts
	plain := bytes.Repeat([]byte("y"), 1000)
	job, err := a.db.CreateJob(context.Background(), newJobParams(sid, int64(len(plain)), a), 1)
	if err != nil {
		t.Fatal(err)
	}
	putParts(t, a, job, plain)
	if ok, _ := a.db.ClaimAssembly(context.Background(), job.ID); !ok {
		t.Fatal("claim failed")
	}

	a.assemble(ctx, job)

	got, _ := a.db.GetJob(context.Background(), job.ID)
	if got.Status != models.StatusPending || got.QueuedAt.Valid {
		t.Fatalf("interrupted job changed state: %s queued=%v", got.Status, got.QueuedAt.Valid)
	}
	f, err := a.store.OpenPart(job.ID, 0)
	if err != nil {
		t.Fatal("parts must survive an interrupted assembly so it can resume")
	}
	f.Close()
}
