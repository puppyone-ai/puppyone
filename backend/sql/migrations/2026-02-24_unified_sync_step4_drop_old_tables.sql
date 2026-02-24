-- ============================================================
-- Unified Sync Architecture — Step 4: 废弃旧表
-- Date: 2026-02-24
--
-- 前置条件：Step 1 ~ Step 3 已运行，后端代码已改完且验证通过
--
-- ⚠️  警告：此步骤为不可逆操作！
--     请确保后端代码已完全切换到新表，且线上运行正常后再执行。
--     建议执行前做最后一次备份。
-- ============================================================


-- ============================================================
-- 备份（可选，生产环境建议先执行）
-- ============================================================
-- CREATE TABLE _bak_sync_sources       AS SELECT * FROM sync_sources;
-- CREATE TABLE _bak_sync_task          AS SELECT * FROM sync_task;
-- CREATE TABLE _bak_etl_task           AS SELECT * FROM etl_task;
-- CREATE TABLE _bak_search_index_task  AS SELECT * FROM search_index_task;


-- ============================================================
-- 删除旧表
-- ============================================================

-- sync_mappings 在之前的 migration 中已经删除了，但以防万一
DROP TABLE IF EXISTS sync_mappings;

-- sync_sources（被 syncs 替代）
DROP TABLE IF EXISTS sync_sources;

-- sync_task（被 uploads type='import' 替代）
DROP TABLE IF EXISTS sync_task;

-- etl_task（被 uploads type='file_ocr'/'file_postprocess' 替代）
DROP TABLE IF EXISTS etl_task;

-- search_index_task（被 uploads type='search_index' 替代）
DROP TABLE IF EXISTS search_index_task;


-- ============================================================
-- 清理 RLS 策略（已随表删除，但显式清理引用）
-- ============================================================
-- RLS policies are automatically dropped with the tables.
-- No additional cleanup needed.


-- ============================================================
-- 更新 rebuild_all_tables.sql 中的 RLS 批量脚本引用
-- （这是代码层面的改动，不在 SQL 中处理）
-- ============================================================


-- ============================================================
-- 完成 Step 4
--
-- 已删除表：
--   sync_sources, sync_task, etl_task, search_index_task
--
-- 当前 sync 相关表：
--   syncs          — 持久化同步关系
--   uploads        — 一次性后台任务
--   sync_changelog — 增量变更日志（保留不变）
--   file_versions  — 文件版本历史（保留不变）
--   folder_snapshots — 文件夹快照（保留不变）
-- ============================================================
