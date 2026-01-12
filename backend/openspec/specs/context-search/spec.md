# context-search Specification

## Purpose
TBD - created by archiving change add-search-tool-hybrid-retrieval. Update Purpose after archive.
## Requirements
### Requirement: Search Tool（基于 chunks + embedding + turbopuffer 的混合检索）
系统 SHALL 支持一种 `Tool.type=search` 的检索工具，用于在超大文本分块（chunks）之上执行语义检索与关键词检索，并返回结构化结果。

#### Scenario: Search Tool 被创建并绑定到 MCP v2（成功）
- **GIVEN** 当前用户有权限访问目标 `table_id`
- **WHEN** 用户创建一个 `Tool.type=search` 并将其绑定到某个 `mcp_v2`
- **THEN** MCP v2 的 `list_tools` SHALL 暴露该 Tool 的 `name/description/inputSchema`
- **AND** MCP v2 的 `call_tool(name)` SHALL 能执行检索并返回 JSON 结果

### Requirement: 创建 Search Tool 时触发 chunking 与 indexing（惰性/按需）
系统 SHALL 在创建 `Tool.type=search` 时，对 Tool.scope（`table_id + json_path/json_pointer`）内满足阈值的大字符串节点触发 chunking，并将 chunks 写入外部检索引擎（turbopuffer）以支持后续混合检索。

#### Scenario: scope 内存在大字符串节点时创建并写入索引（成功）
- **GIVEN** Tool.scope 下存在至少一个 `len(string) >= chunk_threshold_chars` 的字符串节点
- **WHEN** 用户创建 `Tool.type=search`
- **THEN** 系统 SHALL 遍历 scope 子树并提取这些字符串节点（以 RFC6901 `json_pointer` 精确定位）
- **AND** 系统 SHALL 为每个节点执行幂等 chunking（基于 `content_hash`）
- **AND** 系统 SHALL 为新创建或未索引的 chunks 生成 embedding 并 upsert 到 turbopuffer
- **AND** 系统 SHALL 将 `turbopuffer_namespace` 与 `turbopuffer_doc_id` 写回 `chunks` 记录（用于后续检索与清理）

#### Scenario: 重复创建/重试不产生重复 chunks（幂等）
- **GIVEN** 某个 `(table_id, json_pointer, content_hash, chunk_index)` 的 chunks 已存在
- **WHEN** 系统再次对相同内容执行 Search Tool 的 indexing 逻辑
- **THEN** 系统 SHALL 不创建重复的 chunks 记录
- **AND** 系统 SHOULD 对缺失的 turbopuffer 同步字段执行补齐（允许重试）

### Requirement: Search Tool 的索引状态写入 `tool.metadata.search_index`
系统 SHALL 使用 `tool.metadata.search_index` 表达 Search Tool 的索引配置与索引状态摘要，以最小侵入方式支持运维/排障。

#### Scenario: 创建 Search Tool 时写入 search_index（成功）
- **WHEN** 用户创建 `Tool.type=search`
- **THEN** 系统 SHOULD 在 `tool.metadata.search_index` 中写入索引配置与状态（或等价表达）
- **AND** 该结构 SHOULD 至少包含：
  - `configured_at`（或等价的时间戳）
  - `indexed_at`（或等价的时间戳，若已完成 indexing）
  - `indexed_chunks_count`（或等价的数量字段）
  - `last_error`（或等价字段，若失败）

### Requirement: Turbopuffer namespace 与 doc_id 的确定性规则
系统 SHALL 定义并使用确定性的 turbopuffer namespace 与 doc_id 生成规则，以保证索引写入可重试、可追踪、可清理。

#### Scenario: namespace 按 project + table 隔离（成功）
- **GIVEN** 目标 `table_id` 归属于某个 `project_id`
- **WHEN** 系统为该 table 执行 Search indexing
- **THEN** 系统 SHALL 使用确定性 namespace（例如 `project_{project_id}_table_{table_id}` 或等价表达）

#### Scenario: doc_id 可唯一定位到 chunk 版本（成功）
- **GIVEN** 某个 chunk 由 `(table_id, json_pointer, content_hash, chunk_index)` 唯一标识
- **WHEN** 系统生成 turbopuffer doc_id
- **THEN** 该 doc_id SHALL 唯一对应一个 chunk（同一版本不冲突）
- **AND** doc_id SHOULD 包含足够信息以支持排障/回收（例如包含 `table_id`、编码后的 `json_pointer`、以及 `content_hash` 的前缀）

### Requirement: Turbopuffer 文档 schema（启用 BM25 所需）
系统 SHALL 为 turbopuffer namespace 配置文档 schema，以启用对 chunk 文本字段的 BM25 全文检索。

#### Scenario: content 字段启用 full_text_search（成功）
- **GIVEN** 系统希望对 chunk 文本执行 BM25 检索
- **WHEN** 系统向 turbopuffer 写入/更新 schema
- **THEN** schema MUST 将用于 BM25 的文本字段（例如 `content` 或等价字段）配置为 `type=string` 且 `full_text_search=true`（或等价表达）

### Requirement: Search 查询支持混合检索（Vector ANN + BM25）与结果融合
系统 SHALL 支持同时执行向量 ANN 与 BM25 全文检索，并将两个结果集融合为单一排序结果（最小可用融合算法：RRF 或等价方法）。

#### Scenario: 执行混合检索并返回 top_k（成功）
- **GIVEN** Search Tool 已完成 indexing，且 turbopuffer 可访问
- **WHEN** Agent 调用 Search Tool 并提供 `query` 与 `top_k`
- **THEN** 系统 SHALL 生成 `query` 的 embedding
- **AND** 系统 SHALL 在 turbopuffer 上执行：
  - 向量 ANN 查询（rank_by vector ANN）
  - BM25 查询（rank_by content BM25）
- **AND** 系统 SHALL 融合两个结果集并返回 top_k 条结果

### Requirement: Search Tool 输入参数最小集（仅 query + top_k）
Search Tool 在 MCP 调用层面 SHALL 仅要求 `query` 与 `top_k` 两个参数。

#### Scenario: 输入参数为 query + top_k（成功）
- **WHEN** Agent 调用 Search Tool
- **THEN** 请求参数 MUST 包含 `query`
- **AND** 请求参数 MAY 包含 `top_k`
- **AND** 系统不应要求额外参数才能完成一次检索

### Requirement: Search 返回结构包含命中 Chunk 的完整信息（无需 follow-up 建议）
系统 SHALL 返回结构化 JSON，且每条结果包含命中 chunk 的完整信息（chunk 本身内容较短，可直接返回）。

#### Scenario: 每条结果返回完整 chunk 记录（成功）
- **WHEN** Search Tool 返回结果
- **THEN** 每条 result SHALL 至少包含：
  - `score`（融合后的分值或等价指标）
  - `chunk`（或等价的嵌套结构），其中至少包含：
    - `id`（若可获得）
    - `table_id`
    - `json_pointer`（原始完整字符串节点的绝对 RFC6901 指针）
    - `chunk_index` 与 `total_chunks`
    - `chunk_text`
    - `char_start` 与 `char_end`
    - `content_hash`
    - `turbopuffer_namespace`（若可获得）
    - `turbopuffer_doc_id`（若可获得）

### Requirement: 返回的 json_path 需要适配为“Tool 视角”路径
系统 SHALL 在 Search 返回中提供适配后的 `json_path`（RFC6901），使其相对于 Search Tool 自身的 `tool.json_path`（scope 根）可直接理解与使用。

#### Scenario: Tool 有 json_path 视角限制时返回相对路径（成功）
- **GIVEN** Search Tool 的 `tool.json_path` 为非空（例如 `/articles`）
- **AND** 某命中节点的绝对 `json_pointer` 为 `/articles/0/content`
- **WHEN** Search Tool 返回该命中结果
- **THEN** 系统 SHALL 返回“Tool 视角”的 `json_path`（例如 `/0/content` 或等价表达）
- **AND** 系统 SHALL 同时返回绝对 `json_pointer` 或其它等价字段以便排障（可选但推荐）

