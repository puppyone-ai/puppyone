## Context

本变更承接 `docs/chunk-design.md` 的 Phase 2~4：将已落地的 chunking 基建与 turbopuffer/embedding 能力组合为对 Agent 友好的 Search Tool。

系统现状（以实现为准）：

- 主服务已存在：
  - `src/chunking/*`：RFC6901 JSON Pointer 的大字符串提取与分块（幂等 `ensure_chunks_for_pointer`）
  - `src/turbopuffer/*`：turbopuffer SDK 封装（async-first，含 `multi_query`）
  - `src/llm/embedding_service.py`：embedding 批量生成（litellm 懒加载）
  - `src/tool/*`：Tool 实体 CRUD（`public.tool`），以及 mcp_v2 绑定关系（`mcp_binding`）
- MCP v2 的对外协议代理由 `mcp_service/` 实现：
  - v2 模式 `list_tools` 来自主服务返回的绑定工具列表（按 `tool.name` 暴露）
  - v2 模式 `call_tool` 通过 `tool.type` 分发，目前仅支持 get/query/create/update/delete/preview/select

设计目标（本变更）：

- 增加 `tool.type=search` 并在 v2 模式可执行
- 创建 Search Tool 时触发：对 scope 内的大字符串节点进行 chunking，并将 chunks 向量化写入 turbopuffer（同时把 doc_id/namespace 写回 `chunks` 表）
- Search 执行时：支持混合检索（向量 ANN + BM25），并以结构化结果返回（包含命中 chunk 的完整信息）

## Goals / Non-Goals

### Goals

- Search Tool 可被绑定到 mcp_v2，并在 MCP 协议的 `call_tool` 中执行
- 支持 embedding + turbopuffer 的混合检索（至少向量 ANN + BM25 + 结果融合）
- 返回结构必须包含：
  - 命中 chunk 的完整信息（chunk_text 直接返回）
  - 精确定位信息：`table_id + json_pointer + char_start/char_end + chunk_index/total_chunks`
  - `json_path` 需适配为 Search Tool 视角下、相对于 `tool.json_path` 的路径
- SQL/持久化方案贴合现有表结构（优先复用 `tool.metadata` 与 `chunks` 的预留字段）

### Non-Goals

- 不强制引入异步队列；若同步创建耗时不可接受，再在后续变更中引入队列化/后台重建
- 不要求对所有 data 更新自动重建索引（本阶段仅定义一致性策略与可手动触发的重建接口）

## Decisions

### Decision: Search 的实际检索与第三方依赖放在主服务侧，MCP service 仅做协议适配

- Why:
  - `mcp_service/` 当前通过 RPC 调主服务完成所有数据操作；保持单一职责（协议 adapter）更符合现有架构
  - turbopuffer / embedding 的配置与错误处理已有主服务模块；避免在 MCP service 复制配置与依赖

### Decision: Search Tool scope 以 Tool 的 `(table_id, json_path)`（RFC6901）为准

- Why:
  - 与现有 Tool 模型一致（Tool 已携带 `table_id` 与 `json_path`）
  - chunking 已支持 `extract_large_strings(data, base_pointer=...)`，可以自然支持对某个子树做遍历

### Decision: chunking 与 indexing 的幂等以 `content_hash` 为核心，doc_id 由确定性规则生成

- Why:
  - `content_hash=sha256(原始字符串)` 已是 chunking 基建的版本键
  - doc_id 需要稳定可复现，便于重复创建/重试时 upsert，而不是重复写入

建议规则：

- `turbopuffer_namespace = "project_{project_id}_table_{table_id}"`
- `turbopuffer_doc_id = "{table_id}:{json_pointer_encoded}:{content_hash_prefix}:chunk_{chunk_index}"`
  - 说明：加入 `content_hash_prefix`（例如前 12 位）可在同一 pointer 内容变更时自然“换一批 doc id”，同时保留 old docs 可做清理/回滚策略；若希望覆盖旧 docs，也可选择不带 hash（本变更默认带 hash，以简化一致性）

### Decision: Search 输出不提供“下一步建议”

- Why:
  - 上层 Agent 会自主决策下一步使用哪些 Tool；Search 只需返回足够的 chunk 定位信息与内容即可

## Data Flow

### 1) 创建 Search Tool（主服务）

- 输入：`ToolCreate(type="search", table_id, json_path, metadata.search_index=...)`
- 步骤：
  - 读取 scope 数据（`table_id + json_path` 子树）
  - `extract_large_strings(threshold=chunk_threshold_chars, base_pointer=json_path)` 找出大字符串节点
  - 对每个节点执行 `ensure_chunks_for_pointer(table_id, json_pointer=node_pointer, content=node_content)`
  - 对新增/未 index 的 chunks：
    - 批量生成 embeddings（`EmbeddingService.generate_embeddings_batch`）
    - 配置/更新 turbopuffer schema（为 BM25 的文本字段启用 `full_text_search`）
    - 批量 upsert 到 turbopuffer
    - 将 `turbopuffer_namespace/doc_id` 写回 `chunks` 表（用于后续查询与清理）
  - 在 `tool.metadata.search_index` 中记录 indexing 摘要（节点数、chunk 数、最后一次索引时间、失败原因等）

### 2) 执行 Search Tool（MCP service → 主服务）

- MCP service（v2）在 `call_tool` 中识别 `tool.type == "search"`，将请求转发给主服务内部 API（通过现有 RPC client 扩展）
- 主服务执行：
  - 校验 user/table 权限（沿用 Tool 与 Table 的访问控制）
  - 仅基于输入参数 `query/top_k` 与系统默认策略生成 query embedding 与检索请求
  - turbopuffer `multi_query`：
    - query1: `rank_by=("vector","ANN", query_vector)`
    - query2: `rank_by=("content","BM25", query_text)`
  - 对两个结果集执行融合（最小可用：RRF；后续可再调参/替换）
  - 将命中 rows 映射为 chunk 结果（包含完整 chunk 字段），并计算 `json_path`（相对于 `tool.json_path`）

## Schema Notes

### Search Tool 输入（MCP call_tool arguments）

- `query: str`（必填）
- `top_k: int`（可选，默认 5，上限 20）
  - 说明：本变更不对外暴露其它高级参数（例如权重/融合策略/截断长度等），由系统内部默认策略控制

### Search Tool 输出（JSON）

必须包含：

- `query`: 原始查询
- `results`: 数组，每项至少包含
  - `score`
  - `chunk`（命中 chunk 的完整信息：table_id/json_pointer/chunk_text/char_range/chunk_index/total_chunks/content_hash 等）
  - `json_path`（Tool 视角下的路径；相对于 `tool.json_path`）

## Risks / Trade-offs

- 创建 Search Tool 的同步耗时：embedding + turbopuffer 写入可能较慢
  - Mitigation: 先做批量 + 保护阈值；必要时在后续变更引入后台任务与 pending 状态
- 旧 spec 限制“其它模块不依赖 turbopuffer”：需要显式通过 spec 修改解除
- Tool 模型字段命名：主服务使用 `json_path`，chunking 使用 `json_pointer`，本变更需保持 RFC6901 语义一致并在边界处做字段映射（不引入新的命名）

## Migration Plan (High-level)

- Spec 通过后，在 apply 阶段：
  - 新增 `context-search` 模块与内部 API（主服务）
  - 扩展 Tool.type 枚举与默认描述模板（主服务与 MCP service）
  - 扩展 RPC client 支持 `search` 调用
  - （如需要）补充 `tool` 表字段/索引；否则先落在 `tool.metadata`

## Open Questions

- Search Tool 的索引状态是否需要提升为一等字段（例如 `tool.status`）？
  - 本变更默认：使用 `tool.metadata.search_index` 表达（最小侵入）；如后续需要 UI/运维强一致，再升级为显式列。

