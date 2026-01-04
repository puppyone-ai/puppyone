## Context
系统已有的核心抽象是“Context（`table.data` + `json_path`）”，并支持通过：
- Tool（`tool` 表）绑定 `table_id + json_path`，再由 MCP v2（`mcp_v2` + `mcp_binding`）对外暴露；
- Internal API 通过 `table_id + json_path` 获取 `context-data`（JSON Pointer）用于 MCP Server 执行链路。

本变更希望新增一种更轻量的暴露方式：将某个子 JSON 子树发布为一个公开 URL，使 LLM Agent 可通过 `curl` 拉取 raw JSON。

## Goals / Non-Goals
- Goals
  - 提供**最小可用**的 publish 能力：创建发布链接 + 公开读取 raw JSON + 可撤销。
  - 公开读取端点**无需登录**，仅依赖不可猜测的 `publish_key`（类似 share link）。
  - 与现有 `table_id + json_path` 的 JSON Pointer 语义保持一致，避免引入新的路径表达式。
- Non-Goals（本次）
  - 不把 publish 作为 Tool.type 的一种（避免耦合 Tool 执行语义与对外暴露形态）。
  - 不引入前端改造要求（先提供后端 API；前端是否适配由后续决定）。
  - 不做复杂治理能力（速率限制、访问审计、按 IP 白名单等），但保留扩展点。

## Decisions
### Decision: publish 默认 7 天过期（可选覆盖）
- **做法**：创建 publish 时默认 `expires_at = now() + 7 days`；允许创建时显式传入 `expires_at`（包括更短/更长）；owner 允许更新 `expires_at` 与手动禁用（revoke）。
- **原因**：默认降低长期泄露风险，同时保留灵活性。

### Decision: 使用独立 publish 实体（而不是特殊 Tool）
- **做法**：新增 `context_publish`（命名可在实现阶段落定）表/实体，字段包含：
  - `id`
  - `user_id`
  - `table_id`
  - `json_path`（JSON Pointer）
  - `publish_key`（不可猜测的公开 key，固定长度 16）
  - `status`（enabled/disabled）
  - `expires_at`（默认 7 天后过期；可选覆盖）
  - `created_at` / `updated_at`
- **原因**：
  - Tool 的主语义是“对 Context 的操作封装并可被 MCP call_tool 执行”；publish 是“只读暴露”，生命周期/权限/内容协商都不同。
  - 独立实体更容易维护（数据模型清晰、权限边界明确、后续可扩展成 AEI 类型或 share link 体系）。

### Decision: 公开读取端点返回 `application/json`
- **做法**：公开 GET 端点直接返回 JSON（浏览器也会显示为 raw JSON；curl 直接可用）。
- **原因**：满足“网页只展示 raw_data”同时兼容 Agent 的 curl 访问，无需额外 HTML 模板或前端适配。

### Decision: publish_key 采用不透明随机串（避免 JWT 可解码泄露信息）
- **做法**：生成高熵随机 key（固定长度 16；字符集建议 URL-safe，例如 base62/base64url 子集）。
- **原因**：与 `mcp_v2.api_key` 的 JWT 方案不同，publish 更偏“分享链接”，应避免可被 base64 解码读出 user_id 等元信息。

### Decision: 公开读取路径使用缓存（避免每次都查询 DB）
- **做法**：对 `publish_key -> publish_record` 使用进程内缓存（TTL 可配置，默认短 TTL），并在 revoke/disable/update/delete 时主动失效相关 key。
- **原因**：公开读取链路可能被高频 curl 拉取；缓存可以显著减少 DB 压力并降低延迟，同时通过失效保证权限/过期语义及时生效。

## Alternatives considered
### A) 作为“特殊 Tool”实现 publish
- **优点**：复用 tool 表与管理 UI（如果已有）。
- **缺点**：把“暴露形态（URL）”塞进“执行形态（call_tool）”里，耦合强；还可能要求前端把 Tool 展示成链接/页面，改造成本不确定。

### B) 作为 AEI 的一种新 type（例如 `aei.type=json_page`）
- **优点**：与 ADI/AEI 的长期架构一致。
- **缺点**：当前 AEI 体系仍在演进（已有 change `refactor-context-exposure-adi-aei`），直接落在 AEI 可能扩大改动面；本次目标是最小可用。

## Risks / Trade-offs
- **分享链接泄露风险**：publish_key 一旦泄露即等同公开访问 → 通过支持 disabled/revoke 降低风险；后续可加 expires_at 默认值。
- **数据变化可见性**：链接返回的是“当前实时数据”而不是快照 → 这是预期行为；若需要快照需另做 snapshot publish（非本次）。
- **潜在滥用（高频抓取）**：本次不做 rate limit；后续可在网关或应用层添加。

## Migration Plan
- 无迁移需求（新增能力）。

## Open Questions
（已确认）
- publish 默认 `expires_at = 7 days`，允许覆盖；到期对外 404；owner 可更新 expires_at 与 revoke。
- 短链接形态优先（如 `/p/{key}`），key 采用高熵随机 token，长度 16。


