-- Fences chunked-upload assembly: only one replica may assemble a given upload at a time.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS assembling_at TIMESTAMPTZ;

-- Jobs finished by the previous release stored their output at outputs/<job id>.
UPDATE jobs SET output_name = id::text WHERE status = 'completed' AND output_name IS NULL;
