# Change: Add backend Agent + Sandbox API

## Why
当前右侧 Agent 逻辑运行在前端。为快速上线与安全控制，需要迁移到后端并保持行为一致。

## What Changes
- 新增后端 `POST /agents`（SSE）与 `POST /sandboxes`/`GET /sandboxes` 路由
- 后端接入 Anthropic SDK 与 e2b SDK
- 读取 `table.data` 作为 sandbox 初始数据并在结束前回写（只读模式不回写）

## Impact
- Affected specs: `specs/agent-chat/spec.md`
- Affected code: `src/agent/*`, `src/sandbox/*`, `src/table/*`, `src/main.py`
