ALTER TABLE jobs ADD COLUMN IF NOT EXISTS queued_at    TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS run_after    TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lock_token   UUID;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS key_id       TEXT NOT NULL DEFAULT '1';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS output_name  TEXT;

-- Expand-only: nothing is dropped or renamed here, so replicas still running the previous
-- release keep working while this migration runs. Retired objects go in a later release.

-- Claimable rows only: queued jobs that are waiting or hold a lease that may have expired.
CREATE INDEX IF NOT EXISTS idx_jobs_claimable ON jobs (queued_at)
    WHERE queued_at IS NOT NULL AND status IN ('pending', 'processing');
