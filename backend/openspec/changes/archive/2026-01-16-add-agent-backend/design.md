## Context
右侧 Agent 聊天与 sandbox 行为目前在前端实现。后端需提供等价能力以便快速上线与统一管控。

## Goals / Non-Goals
- Goals: 后端提供 `POST /agents`（SSE）与 `POST/GET /sandboxes`，行为与前端一致；支持 table.data 读写回流；支持只读模式。
- Non-Goals: 不迁移聊天持久化、不做前端对接改造、不引入新的数据库表。

## Decisions
- Decision: 采用方案 A，独立 `agents` 与 `sandboxes` 路由。
- Decision: `table_id` 替换前端 `tableData`，后端从 `table.data` 读取。
- Decision: 使用 e2b SDK 进行 sandbox 文件上传/下载与命令执行。

## Risks / Trade-offs
- 风险: 大体积 JSON 上传/下载性能与超时
- 风险: 只读模式仅靠提示词与写回逻辑保证，需要日志与审计

## Migration Plan
1. 新增 `agent` 与 `sandbox` 模块并接入路由
2. 实现 SSE 与 Anthropic 工具调用
3. 实现 e2b sandbox 生命周期与数据同步
4. 增加单元/集成测试

## Open Questions
- 是否需要限制 `workingDirectory` 的可访问范围
