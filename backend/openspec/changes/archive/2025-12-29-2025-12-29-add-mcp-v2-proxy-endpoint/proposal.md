# Change: Add MCP v2 proxy endpoint (scheme B)

## Why
MCP v2 实例（`mcp_v2` + `mcp_binding`）已经实现“去 Context 化 + 多工具绑定”的新模型，但当前对外只有旧 `/mcp/server/{api_key}` 的代理入口；该入口依赖旧 `mcp` 实例校验，因此无法用 `mcp_v2.api_key` 直接访问共享 `mcp_service`（tools/list、tools/call）。

为保持清晰的版本边界，并避免改变旧端点语义，新增一个 **mcp_v2 专用代理端点**更符合演进路径。

## What Changes
- 新增对外代理端点：`/api/v1/mcp_v2/server/{api_key}[/{path:path}]`
  - 行为与旧 `/api/v1/mcp/server/{api_key}` 一致：校验 api_key 是否存在、检查启用状态、转发到共享 `mcp_service`，并注入 `X-API-KEY` header。
  - 代理端点不需要用户登录（仅依赖 api_key）。
- 明确数据加载链路：
  - `mcp_service` 在 `tools/list` / `tools/call` 时优先通过主服务 internal API `GET /internal/mcp-v2/{api_key}` 获取 `mcp_v2 + bound_tools` 配置（未命中再 fallback legacy）。

## Impact
- **AFFECTED specs**
  - `specs/mcp-instance-management/spec.md`（**ADDED**：mcp_v2 代理访问能力）
- **AFFECTED code**
  - `src/mcp_v2/router.py`（新增代理路由）
  - `src/mcp_v2/dependencies.py`（新增 api_key 校验依赖）

## Non-Goals
- 不改动旧 `/api/v1/mcp/server/{api_key}` 的行为与依赖链路。


