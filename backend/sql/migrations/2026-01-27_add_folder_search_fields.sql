-- Add folder search support fields to search_index_task table
-- This migration adds fields to track folder-based search indexing progress

-- Add folder_node_id: stores the folder node_id when indexing a folder (null for single-node search)
ALTER TABLE public.search_index_task 
ADD COLUMN IF NOT EXISTS folder_node_id TEXT NULL;

-- Add total_files: total number of indexable files in the folder
ALTER TABLE public.search_index_task 
ADD COLUMN IF NOT EXISTS total_files INTEGER NULL;

-- Add indexed_files: number of files that have been indexed
ALTER TABLE public.search_index_task 
ADD COLUMN IF NOT EXISTS indexed_files INTEGER NULL;

-- Add node_id column if it doesn't exist (for compatibility)
-- Note: The existing table uses table_id, but code uses node_id
-- We add node_id as an alias/new column for the new folder search feature
ALTER TABLE public.search_index_task 
ADD COLUMN IF NOT EXISTS node_id TEXT NULL;

-- Create index for folder_node_id lookups
CREATE INDEX IF NOT EXISTS idx_search_index_task_folder_node_id
ON public.search_index_task (folder_node_id)
WHERE folder_node_id IS NOT NULL;

-- Add comment to document the purpose
COMMENT ON COLUMN public.search_index_task.folder_node_id IS 'The folder node_id when this is a folder search task';
COMMENT ON COLUMN public.search_index_task.total_files IS 'Total number of indexable files in the folder';
COMMENT ON COLUMN public.search_index_task.indexed_files IS 'Number of files that have been indexed';
COMMENT ON COLUMN public.search_index_task.node_id IS 'The content_nodes node_id (single file or folder)';
