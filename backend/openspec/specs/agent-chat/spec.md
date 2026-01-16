# agent-chat Specification

## Purpose
TBD - created by archiving change add-agent-backend. Update Purpose after archive.
## Requirements
### Requirement: Agent SSE endpoint
系统 SHALL 提供 `POST /agents` SSE 接口，支持流式返回文本与工具事件。

#### Scenario: 正常流式对话
- **WHEN** 客户端发送 `prompt` 与 `chatHistory`
- **THEN** 服务返回 `text/event-stream`
- **AND** 事件类型包含 `text`、`tool_start`、`tool_end`、`result`

#### Scenario: 缺少 prompt
- **WHEN** 请求缺少 `prompt`
- **THEN** 返回 400 错误

### Requirement: Sandbox action endpoint
系统 SHALL 提供 `POST /sandboxes` 与 `GET /sandboxes` 用于 sandbox 生命周期与调试。

#### Scenario: 启动与执行命令
- **WHEN** 客户端调用 `action=start` 且提供 `data`
- **THEN** 返回 `success=true` 并建立 sandbox 会话
- **AND** 后续 `action=exec` 可执行命令并返回输出

#### Scenario: 读取与停止
- **WHEN** 客户端调用 `action=read`
- **THEN** 返回 `data.json` 的解析内容
- **AND** `action=stop` 释放资源

### Requirement: Table data 读写回流
系统 SHALL 支持将 `table.data` 作为 sandbox 输入，并在结束前写回。

#### Scenario: 读写模式回流
- **WHEN** `bashAccessPoints` 模式为 `full`
- **AND** sandbox 结束时读到更新后的 JSON
- **THEN** 应合并到原始 `table.data` 并持久化

#### Scenario: 只读模式不回写
- **WHEN** `bashAccessPoints` 模式为 `readonly`
- **THEN** 不写回数据库

#### Scenario: 仅操作节点数据
- **WHEN** `bashAccessPoints` 提供 `path`
- **THEN** 系统只将该 `path` 下的节点数据写入 sandbox
- **AND** sandbox 结束后仅将该节点合并回原始 `table.data`

#### Scenario: 根路径操作整个 JSON
- **WHEN** `path` 为空字符串或 `/`
- **THEN** 视为操作整个 JSON

### Requirement: 工具选择逻辑
系统 SHALL 在有 bash 权限且能解析节点数据时启用 bash 工具，否则使用文件工具。

#### Scenario: bash 工具启用
- **WHEN** 请求包含 `bashAccessPoints` 且能定位节点数据
- **THEN** 仅启用 bash 工具

#### Scenario: 文件工具启用
- **WHEN** 不满足 bash 条件
- **THEN** 启用 `read_file`、`glob_search`、`grep_search`

