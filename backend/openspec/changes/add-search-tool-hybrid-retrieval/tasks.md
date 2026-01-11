## 1. Spec / Docs
- [ ] 1.1 新增 capability delta：`specs/context-search/spec.md`（Search Tool 创建 + 混合检索 + 返回结构）
- [ ] 1.2 修改 capability delta：`specs/mcp-tool-management/spec.md`（新增 Tool.type=search + 执行语义）
- [ ] 1.3 修改 capability delta：`specs/turbopuffer-search/spec.md`（允许业务模块依赖 turbopuffer；保持不新增对外路由）
- [ ] 1.4 严格校验：`openspec validate add-search-tool-hybrid-retrieval --strict`

## 2. 主服务（apply 阶段实现）
- [ ] 2.1 扩展 Tool.type（schema/验证）支持 `search`
- [ ] 2.2 新增/扩展 `src/search/*`（或等价模块）：
  - [ ] 2.2.1 Search 输入 schema：仅 `query/top_k`
  - [ ] 2.2.2 Indexing：从 `(table_id, json_path)` 读取 scope 数据 → extract_large_strings → ensure_chunks → embedding → 配置 turbopuffer schema（BM25）→ turbopuffer upsert → 回写 chunks.turbopuffer_*
  - [ ] 2.2.3 Query：hybrid multi_query + RRF 融合 + 结果映射（返回完整 chunk；输出 `json_path` 需适配为 Tool 视角）
- [ ] 2.3 在创建 Tool(type=search) 时触发 indexing（同步最小可用；必要时拆为后台任务）
- [ ] 2.4 新增内部 API（供 mcp_service RPC 调用）：
  - [ ] 2.4.1 `POST /internal/tools/{tool_id}/search`（或等价）：执行 search 并返回结构化结果
  - [ ] 2.4.2（可选）`POST /internal/tools/{tool_id}/search/reindex`：重建索引

## 3. MCP service（apply 阶段实现）
- [ ] 3.1 `list_tools` 的 v2 schema 兜底：为 `tool.type=search` 补默认 inputSchema
- [ ] 3.2 `call_tool` 的 v2 分发：支持 `tool.type=search`（通过 RPC 调主服务）
- [ ] 3.3 增加 `mcp_service/tool/description/search.txt`（若 legacy 也要支持）

## 4. SQL / Migration（apply 阶段实现）
- [ ] 4.1 复核 `chunks` 表：确保 `turbopuffer_namespace/turbopuffer_doc_id` 可用且有唯一索引（当前已存在 where-not-null unique index）
- [ ] 4.2 为 `tool` 表落地 search 配置与索引状态的持久化方案：
  - [ ] 4.2.1 最小方案：写入 `tool.metadata.search_index`（无需 schema 变更）
  - [ ] 4.2.2（可选）增强：新增显式列与索引（仅当需要按列查询/运维）

## 5. 测试与验证（apply 阶段实现）
- [ ] 5.1 单元测试：RRF 融合与结果去重/排序
- [ ] 5.2 集成测试：创建 search tool 触发 chunking + 写入（mock turbopuffer/embedding）
- [ ] 5.3 e2e（可选）：在有 turbopuffer/embedding 凭据的环境下跑端到端检索

