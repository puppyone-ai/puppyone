# Change: add-public-json-publish

## Why
当前系统支持将任意子 JSON 子树（`table_id + json_path`）生成 Tool，并通过 MCP/REST 间接访问。
但 LLM Agent 的很多工作流更适合通过 `curl` 直接获取某段子树的 **raw JSON**；为此需要一种“把子树发布为只读公开 URL”的能力。

## What Changes
- 新增一个“发布（publish）”实体：将某个 `table_id + json_path` 发布为一个可公开访问的只读 URL（携带不可猜测的 `publish_key`）。
- 新增一个无需登录的公开读取端点：根据 `publish_key` 返回该子树的 raw JSON（`application/json`）。
- 新增一组需要登录的管理端点：创建/列出/禁用/删除 publish 记录。

## Impact
- Affected specs:
  - New: `context-publish`
- Affected code (expected in apply stage):
  - New module: `src/context_publish/*`（router/service/repository/schemas/models）
  - Supabase: 新表（例如 `context_publish`）及对应 repository 方法
  - 路由注册：`src/main.py`
  - 复用：`src/table/service.py` 的 `get_context_data`（JSON Pointer 路径语义）
  - 可能需要补充：防滥用/速率限制/审计（本次先不做，见 design）


