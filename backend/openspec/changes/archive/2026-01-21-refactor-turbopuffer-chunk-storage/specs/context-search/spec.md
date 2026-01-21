## ADDED Requirements

### Requirement: Search 查询支持向量 ANN 检索与结果排序
系统 SHALL 支持执行向量 ANN 检索，并返回 top_k 条结构化结果。

#### Scenario: 执行向量检索并返回 top_k（成功）
- **GIVEN** Search Tool 已完成 indexing，且 turbopuffer 可访问
- **WHEN** Agent 调用 Search Tool 并提供 `query` 与 `top_k`
- **THEN** 系统 SHALL 生成 `query` 的 embedding
- **AND** 系统 SHALL 在 turbopuffer 上执行向量 ANN 查询（rank_by vector ANN）
- **AND** 系统 SHALL 返回 top_k 条结果

## MODIFIED Requirements

### Requirement: Search Tool（基于 chunks + embedding + turbopuffer 的混合检索）
系统 SHALL 支持一种 `Tool.type=search` 的检索工具，用于在超大文本分块（chunks）之上执行语义检索，并返回结构化结果。

#### Scenario: Search Tool 被创建并绑定到 MCP v2（成功）
- **GIVEN** 当前用户有权限访问目标 `table_id`
- **WHEN** 用户创建一个 `Tool.type=search` 并将其绑定到某个 `mcp_v2`
- **THEN** MCP v2 的 `list_tools` SHALL 暴露该 Tool 的 `name/description/inputSchema`
- **AND** MCP v2 的 `call_tool(name)` SHALL 能执行检索并返回 JSON 结果

### Requirement: 创建 Search Tool 时触发 chunking 与 indexing（惰性/按需）
系统 SHALL 在创建 `Tool.type=search` 时，对 Tool.scope（`table_id + json_path/json_pointer`）内满足阈值的大字符串节点触发 chunking，并将 chunks 的 embedding 写入外部检索引擎（turbopuffer）以支持后续语义检索。

#### Scenario: scope 内存在大字符串节点时创建并写入索引（成功）
- **GIVEN** Tool.scope 下存在至少一个 `len(string) >= chunk_threshold_chars` 的字符串节点
- **WHEN** 用户创建 `Tool.type=search`
- **THEN** 系统 SHALL 遍历 scope 子树并提取这些字符串节点（以 RFC6901 `json_pointer` 精确定位）
- **AND** 系统 SHALL 为每个节点执行幂等 chunking（基于 `content_hash`）
- **AND** 系统 SHALL 为新创建或未索引的 chunks 生成 embedding 并 upsert 到 turbopuffer
- **AND** turbopuffer 写入的文档 MUST 至少包含 `id`、`vector`、`json_pointer` 与可用于回填的 chunk metadata（例如 `chunk_id` 等）
- **AND** 系统 SHALL 将 `turbopuffer_namespace` 与 `turbopuffer_doc_id` 写回 `chunks` 记录（用于后续检索与清理）

### Requirement: Search 返回结构包含命中 Chunk 的完整信息（无需 follow-up 建议）
系统 SHALL 返回结构化 JSON，且每条结果包含命中 chunk 的完整信息。系统 MAY 在检索后基于 chunk metadata（例如 `chunk_id`）从 `public.chunks` 回填 `chunk_text`，而无需在 turbopuffer 中存储 `chunk_text`。

#### Scenario: 每条结果返回完整 chunk 记录（成功）
- **WHEN** Search Tool 返回结果
- **THEN** 每条 result SHALL 至少包含：
  - `score`（融合后的分值或等价指标）
  - `chunk`（或等价的嵌套结构），其中至少包含：
    - `id`（若可获得）
    - `json_pointer`（原始完整字符串节点的绝对 RFC6901 指针）
    - `chunk_index` 与 `total_chunks`
    - `chunk_text`

## REMOVED Requirements

### Requirement: Turbopuffer 文档 schema（启用 BM25 所需）
**Reason**: 为减少 turbopuffer 存储冗余，不再写入 chunk 的全文字段到 turbopuffer，因此不再依赖 turbopuffer 的 BM25 能力。
**Migration**: Search Tool 在查询后通过 chunk metadata（例如 `chunk_id`）从 `public.chunks` 回填 `chunk_text`，并使用向量 ANN 检索。

### Requirement: Search 查询支持混合检索（Vector ANN + BM25）与结果融合
**Reason**: 不再将 chunk_text 写入 turbopuffer 后，无法在 turbopuffer 上执行 BM25；Search Tool 调整为向量 ANN 检索。
**Migration**: 保持输出结构不变；如需关键词检索，可在后续变更中引入独立的 DB/搜索引擎全文检索能力再恢复 hybrid。

