# Change: 新增 chunking 核心能力（仅分块与持久化）

## Why

当前系统的 Context 数据以 JSON 方式存储（表/节点由 `table_id + json_path/json_pointer` 定位）。当某些字符串节点内容很大时（例如 >10K 字符），后续无论是检索、摘要还是按需获取，都需要一个稳定的“分块（chunk）”基础设施：统一的分块算法、可追踪的位置信息、以及可复用的持久化模型。

本变更先落地 chunking 的“核心基建”，为后续搜索/工具集成提供可靠底座。

## What Changes

- 新增 `chunks` 数据模型与数据库表设计（含索引/唯一约束），用于持久化某个 `(table_id, json_pointer)` 下的大文本分块结果与元数据（chunk_index/total_chunks/char_range/content_hash 等）
- 新增 chunking 内部模块的最小接口约定（service/repository/schemas），用于：
  - 遍历 JSON 树提取“大字符串节点”
  - 将单个大字符串分块为稳定的 chunk segments
  - 幂等写入/更新 chunks（基于 content_hash 去重/更新）
- 为后续与检索引擎（如 turbopuffer）同步预留字段与扩展点（仅定义，不在本阶段实现同步流程）

## Non-Goals (本阶段不做)

- 不实现混合搜索（Vector + BM25）、RRF 融合、Search API 路由
- 不实现 Search Tool 的创建/调用流程与 MCP 集成
- 不实现 data 更新监听与自动重建 chunks（仅预留接口/任务占位）
- 不引入异步任务队列、监控指标、缓存等性能优化（后续按需要再做）

## Impact

- Affected specs:
  - 新增 capability: `chunking`
- Affected code (planned in apply stage):
  - 新增 `src/chunking/*`（schemas/repository/service）
  - 新增 SQL schema / migration（创建 `chunks` 表与索引）
- Breaking changes:
  - 无（不改动现有对外 API；仅新增内部模块与表）

