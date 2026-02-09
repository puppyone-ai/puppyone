-- Import Task Table
-- Unified task tracking for all import types (GitHub, Notion, URL, File ETL, etc.)

CREATE TABLE IF NOT EXISTS import_task (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    
    -- Type: github | notion | airtable | google_sheets | linear | url | file
    task_type VARCHAR(50) NOT NULL,
    
    -- Source
    source_url TEXT,                    -- URL for SaaS/URL imports
    source_file_key TEXT,               -- S3 key for file ETL
    
    -- Config (etl_rule_id, crawl_options, name, etc.)
    config JSONB DEFAULT '{}',
    
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | processing | completed | failed | cancelled
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    message TEXT,
    error TEXT,
    
    -- Result
    content_node_id UUID REFERENCES content_node(id) ON DELETE SET NULL,
    items_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_import_task_user_id ON import_task(user_id);
CREATE INDEX IF NOT EXISTS idx_import_task_project_id ON import_task(project_id);
CREATE INDEX IF NOT EXISTS idx_import_task_status ON import_task(status);
CREATE INDEX IF NOT EXISTS idx_import_task_created_at ON import_task(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_task_user_project ON import_task(user_id, project_id);

-- RLS Policies
ALTER TABLE import_task ENABLE ROW LEVEL SECURITY;

-- Users can only see their own tasks
CREATE POLICY "Users can view own import tasks"
    ON import_task FOR SELECT
    USING (auth.uid() = user_id);

-- Users can create tasks in their projects
CREATE POLICY "Users can create import tasks"
    ON import_task FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own tasks
CREATE POLICY "Users can update own import tasks"
    ON import_task FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can delete their own tasks
CREATE POLICY "Users can delete own import tasks"
    ON import_task FOR DELETE
    USING (auth.uid() = user_id);

-- Service role bypass
CREATE POLICY "Service role full access"
    ON import_task FOR ALL
    USING (auth.role() = 'service_role');

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_import_task_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_import_task_updated_at ON import_task;
CREATE TRIGGER trigger_import_task_updated_at
    BEFORE UPDATE ON import_task
    FOR EACH ROW
    EXECUTE FUNCTION update_import_task_updated_at();

-- Comment
COMMENT ON TABLE import_task IS 'Unified import task tracking for all data sources';




