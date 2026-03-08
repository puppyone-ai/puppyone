-- Execution history for sync connections (especially script connector).
-- Each row = one invocation of SyncEngine.execute() for a given sync.

CREATE TABLE IF NOT EXISTS public.sync_runs (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    sync_id     TEXT NOT NULL REFERENCES public.connections(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'running',      -- running | success | failed | timeout | skipped
    started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    duration_ms INT,
    exit_code   INT,
    stdout      TEXT,                                  -- truncated to 100KB
    error       TEXT,
    trigger_type TEXT DEFAULT 'manual',                -- manual | scheduled | webhook
    result_summary TEXT,                               -- e.g. "Fetched 42 rows"
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_sync_id ON public.sync_runs(sync_id);
CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at ON public.sync_runs(started_at DESC);
