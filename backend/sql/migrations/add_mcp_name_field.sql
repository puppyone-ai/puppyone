-- Migration: Add name field to mcp table
-- Date: 2025-12-19
-- Description: Add a name field to store user-friendly names for MCP instances

ALTER TABLE public.mcp ADD COLUMN IF NOT EXISTS name text;

-- Add comment to document the field
COMMENT ON COLUMN public.mcp.name IS 'User-friendly name for the MCP instance';

