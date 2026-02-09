-- Migration: Simplify sync type values
-- Date: 2026-02-08
--
-- Changes:
--   将细分的 type 合并为简洁的来源名称，细节放入 sync_config
--
-- Before: linear_issue, linear_project, notion_database, notion_page, github_repo, ...
-- After: linear, notion, github, airtable, gmail, google_sheets, google_calendar, google_drive
--
-- 细节信息存储在 sync_config.import_type 中

-- 合并 Linear 类型
UPDATE content_nodes SET 
  type = 'linear',
  sync_config = COALESCE(sync_config, '{}')::jsonb || jsonb_build_object('import_type', 
    CASE 
      WHEN type = 'linear_issue' THEN 'issue'
      WHEN type = 'linear_project' THEN 'project'
      WHEN type = 'linear_issues' THEN 'assigned_issues'
    END)
WHERE type IN ('linear_issue', 'linear_project', 'linear_issues');

-- 合并 Notion 类型
UPDATE content_nodes SET 
  type = 'notion',
  sync_config = COALESCE(sync_config, '{}')::jsonb || jsonb_build_object('import_type', 
    CASE 
      WHEN type = 'notion_database' THEN 'database'
      WHEN type = 'notion_page' THEN 'page'
    END)
WHERE type IN ('notion_database', 'notion_page');

-- 合并 GitHub 类型
UPDATE content_nodes SET 
  type = 'github',
  sync_config = COALESCE(sync_config, '{}')::jsonb || jsonb_build_object('import_type', 
    CASE 
      WHEN type = 'github_repo' THEN 'repo'
      WHEN type = 'github_issue' THEN 'issue'
      WHEN type = 'github_pr' THEN 'pr'
      WHEN type = 'github_file' THEN 'file'
    END)
WHERE type IN ('github_repo', 'github_issue', 'github_pr', 'github_file');

-- 合并 Airtable 类型
UPDATE content_nodes SET 
  type = 'airtable',
  sync_config = COALESCE(sync_config, '{}')::jsonb || jsonb_build_object('import_type', 
    CASE 
      WHEN type = 'airtable_base' THEN 'base'
      WHEN type = 'airtable_table' THEN 'table'
    END)
WHERE type IN ('airtable_base', 'airtable_table');

-- 合并 Gmail 类型
-- gmail_thread 是历史上的 inbox 同步节点类型，现在统一为 import_type: inbox
UPDATE content_nodes SET 
  type = 'gmail',
  sync_config = COALESCE(sync_config, '{}')::jsonb || jsonb_build_object('import_type', 
    CASE 
      WHEN type = 'gmail_thread' THEN 'inbox'
      WHEN type = 'gmail_inbox' THEN 'inbox'
      WHEN type = 'gmail_email' THEN 'email'
    END)
WHERE type IN ('gmail_thread', 'gmail_inbox', 'gmail_email');

-- 合并 Google Sheets 类型
UPDATE content_nodes SET 
  type = 'google_sheets',
  sync_config = COALESCE(sync_config, '{}')::jsonb || jsonb_build_object('import_type', 'spreadsheet')
WHERE type IN ('google_sheets_sync', 'sheets_table');

-- 合并 Google Calendar 类型
UPDATE content_nodes SET 
  type = 'google_calendar',
  sync_config = COALESCE(sync_config, '{}')::jsonb || jsonb_build_object('import_type', 
    CASE 
      WHEN type = 'google_calendar_event' THEN 'events'
      ELSE 'calendar'
    END)
WHERE type IN ('google_calendar_sync', 'google_calendar_event');

-- 合并 Google Drive 类型
UPDATE content_nodes SET 
  type = 'google_drive',
  sync_config = COALESCE(sync_config, '{}')::jsonb || jsonb_build_object('import_type', 'file')
WHERE type = 'google_drive_file';

-- ================================================================================
-- 迁移后的 type 值：
-- 
-- 原生类型: folder, json, markdown, file
-- 同步类型: github, notion, airtable, linear, gmail, google_sheets, google_calendar, google_drive
--
-- sync_config.import_type 示例：
--   linear: issue | project | assigned_issues
--   notion: database | page
--   github: repo | issue | pr | file
--   airtable: base | table
--   gmail: inbox | email
--   google_sheets: spreadsheet
--   google_calendar: events | calendar
--   google_drive: file | folder
-- ================================================================================
