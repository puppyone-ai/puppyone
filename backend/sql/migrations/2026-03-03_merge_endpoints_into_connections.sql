-- ============================================================
-- Drop legacy mcp_endpoints + sandbox_endpoints tables
-- Date: 2026-03-03
--
-- MCP/Sandbox 端点已合并回 connections 统一表（provider='mcp'/'sandbox'）。
-- 类型特定配置存入 config JSONB，与 Agent/Sync 模式一致。
-- 数据已通过 INSERT...SELECT 迁移完毕并验证。
-- ============================================================

DROP TABLE IF EXISTS mcp_endpoints;
DROP TABLE IF EXISTS sandbox_endpoints;
