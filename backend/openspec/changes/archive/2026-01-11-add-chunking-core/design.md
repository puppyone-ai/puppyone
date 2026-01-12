## Context

本变更来自 `docs/chunk-design.md` 的第一阶段拆分：仅实现 chunking 的“生成 + 持久化”基础能力。

系统现状（以实现与文档为准）：
- Context 数据存储在 Supabase/Postgres 表中；代码侧当前通过 `context_table` 访问（同时仓库内存在 `public.table` 的 SQL 定义，存在命名不一致的历史包袱）。
- Tool 体系中存在 `json_path` / `json_pointer_path` / `json_pointer` 多种命名；本变更在 chunks 表中统一采用 RFC6901 JSON Pointer 文本语义，并在集成阶段再做字段映射与兼容。

## Goals / Non-Goals

- Goals:
  - 定义并落地 `chunks` 表：能稳定表达“某个 JSON Pointer 下某段大文本的分块序列”与位置元数据
  - 提供内部 chunking API：可被后续 Search Tool / ETL 后处理 / 摘要等模块复用
  - 支持幂等：同一 `(table_id, json_pointer, content_hash)` 重复调用不产生重复 chunks
- Non-Goals:
  - 不包含搜索/检索服务能力（包括 turbopuffer 写入与查询）
  - 不包含自动监听 data 变更与重建策略

## Decisions

- Decision: chunks 的定位键采用 `(table_id, json_pointer)`
  - Why: 与现有 “table + json_path 访问” 模式一致；同时 JSON Pointer 可精确定位到字符串节点。

- Decision: 幂等与变更检测基于 `content_hash=sha256(原始完整字符串)`
  - Why: 无需存储完整原始文本即可判断是否变化；同一内容重复 chunking 可复用结果。

- Decision: chunk 分割以“字符数”为基本单位（size/overlap/threshold 以 chars 表达）
  - Why: 与 `chunk-design.md` 保持一致；实现简单稳定。后续如需 token-based 可在 service 层扩展策略。

- Decision: turbopuffer 同步字段为可选（nullable）
  - Why: 本阶段不实现外部检索引擎同步，但希望表结构为后续演进留出空间，避免大规模迁移。

## Schema Notes

建议 `chunks` 表至少包含：
- 关联：`table_id` + `json_pointer`
- 分块序：`chunk_index`（0-based）+ `total_chunks`
- 内容与位置：`chunk_text` + `char_start/char_end`
- 版本：`content_hash`
- 预留同步字段（nullable）：`turbopuffer_namespace` / `turbopuffer_doc_id`

关键约束建议：
- 同一节点同一版本下，chunk 序号唯一：`UNIQUE(table_id, json_pointer, content_hash, chunk_index)`
-（若启用同步）doc_id 唯一：`UNIQUE(turbopuffer_doc_id)`

## Risks / Trade-offs

- JSON Pointer 命名不一致：短期通过在 chunking 模块内部统一语义（json_pointer），集成阶段再做映射
- chunk_text 存储成本：先做最小可用，后续再评估是否需要压缩/去重/只存引用

## Migration Plan (High-level)

- 新增 `sql/chunks.sql`（或等价迁移文件）创建表与索引
- 部署后不影响现有路径；只有调用 chunking API 才会写入新表

## Open Questions

- DB 中 Context 表最终命名是否以 `context_table` 为准（与代码一致），还是计划统一到 `table`（与 SQL/spec 一致）？
  - **决策**: Context 表最终命名以 `context_table`为准。需要将在spec中批注一下。
- chunks 是否需要支持“只对某个子树（json_pointer 前缀）”批量生成？
  - **决策**：不需要
- 本阶段是否需要落地 `MAX_CONTENT_SIZE / MAX_CHUNKS_PER_NODE` 等保护阈值（建议先在 service 层实现，默认开启）？
  - **决策**：在 service 层实现，默认开启

