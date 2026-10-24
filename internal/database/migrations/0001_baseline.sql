CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS sessions (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ip_address           INET NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_request_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hourly_window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hourly_request_count INTEGER NOT NULL DEFAULT 0,
    is_flagged           BOOLEAN NOT NULL DEFAULT FALSE,

    CONSTRAINT uq_sessions_ip UNIQUE (ip_address)
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hourly_window_start TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE sessions DROP COLUMN IF EXISTS total_request_count;

CREATE INDEX IF NOT EXISTS idx_sessions_ip ON sessions (ip_address);
CREATE INDEX IF NOT EXISTS idx_sessions_flagged ON sessions (is_flagged) WHERE is_flagged = TRUE;

DO $$ BEGIN
    CREATE TYPE job_status AS ENUM ('pending', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE job_operation AS ENUM (
        'image_convert',
        'image_compress',
        'image_remove_bg',
        'pdf_compress',
        'audio_convert',
        'audio_compress',
        'video_compress'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    operation       job_operation NOT NULL,
    status          job_status NOT NULL DEFAULT 'pending',

    input_filename  TEXT NOT NULL,
    output_filename TEXT,
    input_size      BIGINT NOT NULL DEFAULT 0,
    output_size     BIGINT,
    original_name   TEXT NOT NULL,

    params          JSONB NOT NULL DEFAULT '{}',

    file_nonce      BYTEA,

    error_message   TEXT,
    retry_count     INTEGER NOT NULL DEFAULT 0,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),

    CONSTRAINT chk_input_size CHECK (input_size >= 0),
    CONSTRAINT chk_retry_count CHECK (retry_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_jobs_session ON jobs (session_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_expires ON jobs (expires_at) WHERE status != 'failed';
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs (created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs (status, created_at);
