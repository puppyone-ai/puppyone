## 前端对接更新说明（MCP v2 + Tool 独立化）

- **更新日期**：2025-12-29
- **影响范围**：前端控制台（管理 MCP/Tool/绑定）、以及任何通过 MCP 协议调用后端的客户端
- **后端统一前缀**：`/api/v1`

---

## 1. 本次更新概览（给前端的结论）

### 1.1 重点变化（必读）

- **重大变更：旧版 MCP（`src.mcp`）对外路由已下线**
  - 后端已明确：旧版 `/mcp` 路由不再对外暴露，统一使用 **MCP v2**（`/api/v1/mcp`）。
- **Tool 从“附属于 MCP 的 JSON 配置”升级为“独立实体”**
  - 前端需要先创建 `Tool`（`/api/v1/tools`），再把 `Tool` 绑定到某个 `MCP v2 实例`（`/api/v1/mcp/{api_key}/bindings`）。
- **新增 MCP v2 的“代理路由（proxy）”**
  - 新增：`/api/v1/mcp/server/{api_key}/...`（**不需要登录 token**，只需要 `api_key`），用于转发 MCP 协议请求到共享 MCP Server，并支持 SSE（`Accept: text/event-stream`）。

### 1.2 对前端的核心收益

- Tool 可复用：同一个 Tool 可被绑定到不同 MCP v2 实例（由 binding 控制启用/禁用）。
- MCP v2 实例可以组合多个 Tool：前端可按“发布一个 MCP Server”视角管理工具集合。

---

## 2. 统一约定（鉴权、响应体、错误处理）

### 2.1 鉴权（管理类接口）

除特殊说明外，管理类接口都需要：

- **Header**：`Authorization: Bearer <jwt>`
- 后端可在开发环境开启 `SKIP_AUTH=1` 跳过鉴权（仅后端自用；前端无需依赖该行为）。

### 2.2 统一响应体 `ApiResponse<T>`

除 MCP proxy（见 4.2）外，所有对外 API 都返回：

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

- **成功**：`code=0`
- **失败**：`code!=0`，同时 HTTP status 可能为 400/401/403/404/422/500
- 后端会透出 `X-Request-Id` 响应头（方便前端/后端联调定位）

### 2.3 常用错误码（业务 code）

- `1006`：参数校验失败（HTTP 422）
- `1004`：资源不存在/无权限视为不可见（HTTP 404）
- `3001`：MCP 实例不可用/不可达/被禁用（常见于 proxy 调用失败）

---

## 3. 破坏性变更（前端需要重点关注）

### 3.1 旧版 MCP 路由下线

- 旧版 MCP（`src.mcp`）对外路由已下线，避免与 v2 的 `/mcp` 前缀冲突。
- 如前端/客户端仍在使用旧路径，请统一迁移到 MCP v2（见第 5 节迁移步骤）。

### 3.2 Tool 实体化（数据结构变化）

历史上 Tool 作为 MCP 实例的 `tools_definition/register_tools`（JSONB）存在；本次更新后：

- **Tool** 是独立实体（有 `id`、可 CRUD）
- MCP v2 与 Tool 之间通过 **binding** 关系关联（可启用/禁用）

---

## 4. 接口清单（本次新增/变化重点）

> Base URL：`/api/v1`

### 4.1 Tool 管理（需要登录）

- `GET /tools?skip=0&limit=100`：获取当前用户 Tool 列表
- `POST /tools`：创建 Tool
- `GET /tools/{tool_id}`：获取 Tool
- `PUT /tools/{tool_id}`：更新 Tool（仅更新请求体传入字段）
- `DELETE /tools/{tool_id}`：删除 Tool

### 4.2 MCP v2 管理（需要登录）

- `GET /mcp/list?skip=0&limit=100`：获取 MCP v2 实例列表
- `POST /mcp`：创建 MCP v2 实例（只创建入口，不绑定 Tool）
- `POST /mcp/with_bindings`：创建 MCP v2 实例并批量绑定 Tool（原子操作，推荐）
- `GET /mcp/{api_key}`：获取 MCP v2 实例详情
- `PUT /mcp/{api_key}`：更新 MCP v2（`name`/`status`）
- `DELETE /mcp/{api_key}`：删除 MCP v2 实例

### 4.3 MCP v2 绑定管理（需要登录）

- `POST /mcp/{api_key}/bindings`：批量绑定 Tool（支持一次绑多个）
- `PUT /mcp/{api_key}/bindings/{tool_id}`：更新绑定状态（启用/禁用）
- `DELETE /mcp/{api_key}/bindings/{tool_id}`：解绑 Tool

### 4.4 MCP v2 代理路由（不需要登录）

用于 MCP 协议调用（对接 Cursor/Claude/自研 Agent 等）：

- `ANY /mcp/server/{api_key}`
- `ANY /mcp/server/{api_key}/{path:path}`

关键说明：

- **无需 Bearer token**：只依赖路径里的 `api_key`
- 后端会自动将 `X-API-KEY = api_key` 注入到下游共享 MCP Server
- 若 `Accept` 包含 `text/event-stream`，会走 SSE 流式转发（read timeout 为无限）
- proxy 返回的响应体与下游保持一致；响应头仅透传 `mcp-*` 或 `x-*`（以及 `content-type`）

---

## 5. 实体/请求体变化（前端需要关心的字段）

### 5.1 Tool（`ToolCreate/ToolOut`）

创建请求（`POST /tools`）核心字段：

- **table_id**（int，必填）：Context 所属 Table
- **json_path**（string，默认 `""`）：JSON Pointer 挂载点（根路径用空字符串）
- **type**（枚举，必填）：Tool 类型（见 5.3）
- **name**（string，必填）：工具唯一调用名（建议在同一 MCP 内唯一）
- **alias/description**（可选）：前端展示与说明
- **input_schema/output_schema/metadata**（可选）：扩展字段（自定义 Tool 或高级能力时使用）

返回实体（`ToolOut`）包含：

- `id`、`created_at`、`user_id`
- 以及上述所有字段（`table_id` 在输出中可能为 `null`，但创建时必须提供）

### 5.2 MCP v2（`McpV2Create/McpV2Out`）

- 创建：`POST /mcp` 返回 `data={ api_key, id }`
- 实体字段：
  - `id`、`created_at`、`updated_at`
  - `user_id`
  - `name`（可选）
  - `api_key`（用于 proxy 调用）
  - `status`（bool，`false` 时 proxy 会拒绝请求）

### 5.3 Tool 类型枚举（`ToolTypeKey`）

目前支持：

- `get_data_schema`
- `get_all_data`
- `query_data`（注意：历史上的 `get` 已改为 `query`）
- `create`
- `update`
- `delete`
- `preview`（新增）
- `select`（新增）

### 5.4 Binding（绑定关系）

批量绑定请求（`POST /mcp/{api_key}/bindings`）：

```json
{
  "bindings": [
    { "tool_id": 1, "status": true },
    { "tool_id": 2, "status": true }
  ]
}
```

约束：

- `bindings` 至少 1 个
- `tool_id` 在同一请求内必须唯一（否则 422）

---

## 6. 前端迁移步骤（推荐流程）

### 6.1 创建 Tool（控制台侧）

1) 前端调用 `POST /api/v1/tools` 创建 Tool
2) 保存返回的 `tool_id`

### 6.2 创建 MCP v2 并绑定 Tool（推荐原子接口）

调用 `POST /api/v1/mcp/with_bindings`：

```json
{
  "name": "my-mcp",
  "bindings": [
    { "tool_id": 1, "status": true }
  ]
}
```

保存返回的：

- `api_key`：给 MCP 客户端使用
- `id`：仅用于后台管理展示（可选）

### 6.3 通过 proxy 使用 MCP（给 MCP 客户端）

后续 MCP 协议请求统一打到：

- `/api/v1/mcp/server/{api_key}/mcp/...`

说明：

- 该接口 **不需要 Bearer token**
- 若需要流式：`Accept: text/event-stream`

### 6.4 启用/禁用（灰度/下线能力）

- `PUT /api/v1/mcp/{api_key}`：将 `status=false` 可快速下线该实例对外能力
- `PUT /api/v1/mcp/{api_key}/bindings/{tool_id}`：可对单个 Tool 做开关

---

## 7. 相关接口（未必是本次变更重点，但前端可能会用到）

### 7.1 Table（知识库/上下文数据）

- `GET /tables`：获取项目及其下表格
- `GET /tables/{table_id}`：获取表格详情
- `POST /tables`：创建表格
- `PUT /tables/{table_id}`：更新表格
- `DELETE /tables/{table_id}`：删除表格

Context Data（按 JSON Pointer 操作 table.data）：

- `POST /tables/{table_id}/data`：在挂载点批量创建元素
- `GET /tables/{table_id}/data?json_pointer_path=`：读取挂载点数据（根路径用空字符串）
- `PUT /tables/{table_id}/data`：在挂载点批量更新元素
- `DELETE /tables/{table_id}/data`：在挂载点批量删除元素

### 7.2 Project（项目）

- `GET /projects`
- `GET /projects/{project_id}`
- `POST /projects`
- `PUT /projects/{project_id}`
- `DELETE /projects/{project_id}`

### 7.3 Connect（URL 解析与导入）

- `POST /connect/parse`：解析 URL（返回预览、字段信息）
- `POST /connect/import`：导入到项目/表（支持 `import_mode=add_to_existing|replace_all|keep_separate`；`target_path/merge_strategy` 属于 legacy 兼容）

---

## 8. 前端自测清单（建议作为验收用例）

- 创建 Tool 成功，`GET /tools` 可见且字段符合预期（`table_id/json_path/type/name`）
- 创建 MCP v2（带 bindings）成功，能拿到 `api_key`
- proxy 调用：
  - `status=true` 时正常转发
  - `status=false` 时 proxy 返回不可用（通常表现为 404/3001）
- binding 开关：
  - 禁用某个 tool 后，MCP 客户端侧 list/call 不应再出现/可用该 tool


