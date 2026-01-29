-- Migration: Add sync_task table for tracking SaaS import progress
-- Date: 2026-01-30

-- =====================================================
-- 1. Create sync_task table
-- =====================================================
CREATE TABLE IF NOT EXISTS sync_task (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    
    -- Task type and source
    task_type TEXT NOT NULL,  -- 'github_repo', 'notion_database', 'airtable_base', etc.
    source_url TEXT NOT NULL,
    
    -- Status and progress
    status TEXT NOT NULL DEFAULT 'pending',
    progress INT NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    progress_message TEXT,
    
    -- Result
    root_node_id TEXT REFERENCES content_nodes(id) ON DELETE SET NULL,
    files_total INT DEFAULT 0,
    files_processed INT DEFAULT 0,
    bytes_total BIGINT DEFAULT 0,
    bytes_downloaded BIGINT DEFAULT 0,
    
    -- Metadata and error
    metadata JSONB DEFAULT '{}',
    error TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);

-- =====================================================
-- 2. Add status check constraint
-- =====================================================
ALTER TABLE sync_task ADD CONSTRAINT sync_task_status_check 
    CHECK (status IN (
        'pending',
        'downloading',
        'extracting',
        'uploading',
        'creating_nodes',
        'completed',
        'failed',
        'cancelled'
    ));

-- =====================================================
-- 3. Create indexes
-- =====================================================
CREATE INDEX idx_sync_task_user_id ON sync_task(user_id);
CREATE INDEX idx_sync_task_project_id ON sync_task(project_id);
CREATE INDEX idx_sync_task_status ON sync_task(status);
CREATE INDEX idx_sync_task_created_at ON sync_task(created_at DESC);

-- =====================================================
-- 4. Enable Row Level Security
-- =====================================================
ALTER TABLE sync_task ENABLE ROW LEVEL SECURITY;

-- Users can only see their own tasks
CREATE POLICY "Users can view own sync tasks"
    ON sync_task FOR SELECT
    USING (auth.uid() = user_id);

-- Users can create their own tasks
CREATE POLICY "Users can create own sync tasks"
    ON sync_task FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own tasks
CREATE POLICY "Users can update own sync tasks"
    ON sync_task FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can delete their own tasks
CREATE POLICY "Users can delete own sync tasks"
    ON sync_task FOR DELETE
    USING (auth.uid() = user_id);

-- =====================================================
-- 5. Create updated_at trigger
-- =====================================================
CREATE OR REPLACE FUNCTION update_sync_task_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_sync_task_updated_at
    BEFORE UPDATE ON sync_task
    FOR EACH ROW
    EXECUTE FUNCTION update_sync_task_updated_at();

-- =====================================================
-- 6. Add comments
-- =====================================================
COMMENT ON TABLE sync_task IS 'Tracks SaaS data import tasks with real-time progress';
COMMENT ON COLUMN sync_task.task_type IS 'Type of sync: github_repo, notion_database, airtable_base, etc.';
COMMENT ON COLUMN sync_task.status IS 'Current status: pending, downloading, extracting, uploading, creating_nodes, completed, failed, cancelled';
COMMENT ON COLUMN sync_task.progress IS 'Progress percentage from 0 to 100';
COMMENT ON COLUMN sync_task.progress_message IS 'Human-readable progress message, e.g., "Downloading... 5.2MB / 12.3MB"';
COMMENT ON COLUMN sync_task.root_node_id IS 'The root content_node created by this sync task';
COMMENT ON COLUMN sync_task.files_total IS 'Total number of files to process';
COMMENT ON COLUMN sync_task.files_processed IS 'Number of files already processed';
COMMENT ON COLUMN sync_task.bytes_total IS 'Total bytes to download';
COMMENT ON COLUMN sync_task.bytes_downloaded IS 'Bytes already downloaded';

