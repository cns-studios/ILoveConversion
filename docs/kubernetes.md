# Running ILC on Kubernetes

ILC is built to run as several replicas of each service (for example on a k3s HA cluster). This page lists what the cluster has to provide. It does not ship manifests.

## Components

| Workload | Image | Notes |
|---|---|---|
| `migrate` (Job or init container) | api | `./api --migrate-only`. Safe to run from every replica: migrations are idempotent and serialised by an advisory lock |
| `api` (Deployment, N replicas) | api | Serves `/api/*` and the embedded frontend on `API_PORT` (3015). Internal metrics listener on `METRICS_ADDR` (9090) |
| `worker` (Deployment, N replicas) | worker | Debian image because of libvips and ffmpeg. HTTP listener on `WORKER_HTTP_ADDR` (8081) |
| `rembg` (Deployment) | rembg | Reached through `REMBG_URL` |

Images are built by `.github/workflows/ci.yml` and pushed to `ghcr.io/<owner>/<repo>/{api,worker,rembg}`, tagged with the full git SHA. Pin deployments to that tag. Mark the packages public once, and no pull secret is needed.

All images run as UID/GID 10001. Set `securityContext.runAsUser: 10001` and `fsGroup: 10001` so the shared volume is writable.

## Database

- Point `POSTGRES_HOST` at CNPG's `-rw` service. Do not go through a pooler: the migration lock is a session-level advisory lock and needs one stable connection.
- `POSTGRES_SSLMODE` accepts `disable`, `require`, `verify-ca` and `verify-full`.
- The job queue is the `jobs` table. A worker claims a row with a lease (`JOB_LEASE_SECONDS`) and renews it every lease/4. A crashed worker's job is reclaimed after the lease expires, and counts as an attempt.
- Jobs queued by the old Redis-based version are not migrated; drain the old queue before cutting over.

## Storage and tmpfs

- `STORAGE_PATH` (`/app/storage`) is a ReadWriteMany volume shared by api and worker. Only ciphertext is ever written to it.
- Plaintext lives in memory-backed scratch space. Mount an `emptyDir` with `medium: Memory` at `TMP_DIR` (`/tmp/processing`) in the worker and at `/tmp` in the api (uploads through `POST /api/jobs` spill there). Size limits go on the `emptyDir` and in the pod memory limit.

## Probes

| Workload | Liveness | Readiness |
|---|---|---|
| api | `GET /api/live` (no dependencies) | `GET /api/health` (database and a writable storage path) |
| worker | `GET :8081/live` (fails when the claim loop has not ticked recently) | none needed |

Set the worker's `terminationGracePeriodSeconds` above `DRAIN_TIMEOUT_SECONDS` plus about 30 seconds. On SIGTERM the worker stops claiming, waits up to the drain timeout for running jobs, then releases whatever is left back to the queue without counting an attempt.

## Client IPs and Cloudflare

The API believes forwarding headers only from peers in `TRUSTED_PROXIES`. Put the pod CIDR or the ingress/cloudflared addresses there. With Cloudflare in front, also set `CLIENT_IP_HEADER=CF-Connecting-IP`. Leave both empty and the API uses the TCP peer address.

Uploads are chunked at 16 MiB, well under Cloudflare's 100 MB request limit on the free plan.

## Metrics and logs

Scrape `:9090/metrics` on the api and `:8081/metrics` on the worker. Queue depth, oldest pending age, storage bytes, and the last cleanup time are read from Postgres, so every api replica reports the same values: aggregate them with `max()`, not `sum()`. Claim, reclaim, failure and duration metrics are per process and add up.

Logs go to stdout. They carry no client IPs and no filenames.

## Cleanup

There is no leader. Every api replica periodically claims expired jobs with `FOR UPDATE SKIP LOCKED`, deletes their files, then deletes the rows. The sweep for orphaned files is serialised with `pg_try_advisory_xact_lock`, so only one replica walks the volume at a time.

## Key rotation

New jobs use `ENCRYPTION_MASTER_KEY` under the id `ENCRYPTION_KEY_ID` (default `1`). To rotate, generate a new key, set it as `ENCRYPTION_MASTER_KEY` with a new `ENCRYPTION_KEY_ID`, and list the former key as `ENCRYPTION_OLD_KEYS=1:<hex>`. Jobs created under the old key keep decrypting through the id stored in `jobs.key_id`. Drop the old key once its jobs have expired (`FILE_RETENTION_HOURS`).

## Chunked upload completion

`POST /api/uploads/{id}/complete` returns `202` immediately; the API assembles the file in the background, so a slow shared volume can no longer hit a proxy's response limit (Cloudflare: 100 s). Clients poll `GET /api/jobs/{id}`: the job stays `pending` until assembly finishes and the job is queued, or turns `failed` with a message.

- The assembler renews its 5 minute lease every 75 seconds. If a replica dies, any replica resumes the assembly once the 5 minute lease expires (checked every minute). The chunk files are only deleted after the input is committed and the job queued.
- On SIGTERM the API waits for running assemblies within its shutdown grace period (30 s). Give the api pod a `terminationGracePeriodSeconds` of at least that; anything unfinished is resumed by another replica.

## Chaos test

`scripts/chaos.sh` uploads video-compress jobs through the public API while deleting api, worker and postgres pods at random, then checks that every job completes and its download matches the recorded size. Run it against a test deployment only:

```
BASE_URL=https://ilc.example.com NAMESPACE=ilc scripts/chaos.sh
```

What it relies on: the browser and the script both wait out outages (uploads and status checks retry for about 10 minutes), workers keep their lease alive while the database is down and retry the final write for up to 10 minutes, and a worker's liveness does not depend on the database being reachable.
