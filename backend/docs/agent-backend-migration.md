# Agent 聊天模块后端迁移方案（V1）

## 背景与范围
前端右侧 Agent 聊天目前由 `frontend/components/ChatSidebar.tsx` 驱动，通过 `/api/agent`（SSE）调用 Anthropic，必要时再经 `/api/sandbox` 使用沙盒执行 `bash`。V1 目标是快速上线：将同等行为迁移到后端（FastAPI），并保持接口行为与前端现有实现一致，不做过渡设计。

## 现状梳理（前端）
- 聊天流式输出：`/api/agent` 返回 `text/event-stream`，事件类型包含 `status`、`tool_start`、`tool_end`、`text`、`result`、`error`。
- 工具选择：有 `bashAccessPoints` 且能从 `tableData` 提取到目标节点时启用 `bash` 工具；否则走文件工具（`read_file` / `glob_search` / `grep_search`）。
- 沙盒生命周期：`/api/sandbox` 通过 `action` 执行 `start/exec/read/stop/status`。
- 聊天持久化：前端存在 Supabase 表 `chat_sessions`、`chat_messages` 的读写逻辑（`frontend/lib/chatApi.ts`），但 V1 后端迁移不要求持久化。

## 端到端执行链路（前端现状）
以下描述从用户在右侧 Chat 发起输入，到 Agent 自主操作数据，再到对话结束的完整链路，包含调用的 API 与触发的状态变化。

1) **用户输入与本地状态**
- 用户在 `ChatSidebar` 输入并发送消息，组件将该消息追加到本地 `messages`（UI 立即显示）。
- 如无会话会先创建会话；有会话则继续使用当前会话。

2) **可选的聊天持久化（前端 Supabase）**
- 创建会话：写入 `chat_sessions`。
- 用户消息：写入 `chat_messages`（role=user）。
- 预创建 assistant 空消息：写入 `chat_messages`（role=assistant，content 为空）。
- 这些操作失败会降级为纯本地消息，不影响后续请求 `/api/agent`。

3) **构建 Agent 请求（/api/agent）**
- 将本地消息生成 `chatHistory`（仅 user/assistant 的文本内容）。
- 从 `accessPoints` 提取 `bashAccessPoints`（含路径与只读/读写模式）。
- `tableData` 从前端状态传入（当前版本）；后端迁移后改为 `table_id`。
- 发起 `POST /api/agent`（SSE），携带：
  - `prompt`、`chatHistory`、`tableData`、`workingDirectory`、`bashAccessPoints`。

4) **Agent 与 Sandbox 交互**
- 若 `bashAccessPoints` 存在且 `tableData` 有对应节点：
  - `POST /api/sandbox`（action=start）创建沙盒并写入 `data.json`。
  - Agent 侧启用 Anthropic `bash` 工具，工具调用会触发：
    - `tool_start` 事件（前端开始显示工具执行中）
    - `tool_end` 事件（前端展示工具输出）
  - Agent 通过 `POST /api/sandbox`（action=exec）在沙盒里执行命令。
  - 沙盒结束时 `POST /api/sandbox`（action=read）读取 `data.json`。
  - 最终 `POST /api/sandbox`（action=stop）释放沙盒。
- 若没有 bash 权限或节点数据缺失：
  - Agent 改用本地文件工具（`read_file/glob_search/grep_search`），不经过 `/api/sandbox`。

5) **流式事件与 UI 状态更新**
- `/api/agent` 持续推送 SSE：
  - `text`：追加到 assistant 消息内容。
  - `tool_start/tool_end`：追加到消息 `parts`，UI 显示工具执行流程与输出。
  - `result`：若包含 `updatedData`，触发 `onDataUpdate` 更新前端表数据状态。
  - `error`：在 assistant 消息中追加错误提示。
- 流结束时 assistant 消息标记为非 streaming，并补齐未完成的 tool 状态。

6) **对话结束后的持久化更新**
- 如果聊天持久化开启，则使用 `updateChatMessage` 更新 assistant 消息的完整内容与 `parts`。
- 如果 `result` 中包含 `updatedData`：
  - 前端状态更新 `tableData`，进而触发表数据编辑器展示最新结果。
  - 后端迁移后该步骤将改为后端写回 `table.data`，前端仅刷新或重拉表数据。

## 方案选型
推荐方案 A：后端保留“Agent 路由 + Sandbox 路由”的结构，与前端设计一致，Agent 在服务内调用 Sandbox Service。
- 方案 A（推荐）：`/agents`（SSE）+ `/sandboxes`（action）。接口形态与前端一致，易于前后对齐、便于单独调试沙盒。
- 方案 B：仅保留 `/agents`，内部直接使用 e2b SDK，不暴露 `/sandboxes`。接口更少，但与现有结构不完全一致。
- 方案 C：`/agents` 只做代理，所有沙盒操作仍由独立服务对外提供。工程复杂度高，V1 不建议。

## 目标路由设计（后端前缀）
### 1) `POST /agents`（SSE）
**功能**：与前端 `/api/agent` 等价，保留流式事件协议。

**请求体（与前端一致，仅将 tableData 改为 table_id）**  
- `prompt: string`（必填）
- `chatHistory?: { role: "user"|"assistant"; content: string }[]`
- `table_id?: number`（新增，取代 `tableData`）
- `workingDirectory?: string`
- `bashAccessPoints?: { path: string; mode: "readonly"|"full" }[]`

**响应（SSE 事件）**  
事件类型与前端完全一致：`status` / `tool_start` / `tool_end` / `text` / `result` / `error`。  
`result` 事件在沙盒完成后返回：
- `success: boolean`
- `updatedData?: unknown`
- `modifiedPath?: string | null`

**核心流程**
1. 校验 `prompt`，解析 `bashAccessPoints`。
2. 若传入 `table_id`：通过 `TableService.get_by_id_with_access_check` 获取 `table.data`（JSONB）。
3. 使用 JSON 路径（如 `/users/0/name`）提取 `nodeData`：
   - 路径为空或 `/` 表示根节点。
   - 数组节点支持下标访问。
4. 若 `bashAccessPoints` 存在且 `nodeData` 非空：
   - 启动 e2b sandbox；`data.json` 写入 `/workspace/data.json`。
   - `readonly` 模式仅限制写回（不合并、不更新 DB），系统提示同前端。
   - 使用 Anthropic tools：仅启用 `bash`。
5. 否则：
   - 使用文件工具（`read_file`、`glob_search`、`grep_search`），`workingDirectory` 为执行根目录。
6. 循环调用 Anthropic（`maxIterations=15`），流式输出事件。
7. 沙盒结束时读取 `data.json`，如非只读则合并回原表数据：
   - `updatedData = mergeDataByPath(table.data, nodePath, updatedNodeData)`
   - 写回 `table.data`（DB 同步在沙盒断开前完成）
8. 发送 `result` 事件并结束流。

### 2) `POST /sandboxes`
**功能**：与前端 `/api/sandbox` 等价（action-based）。

**请求体**
- `action: "start"|"exec"|"read"|"stop"|"status"`
- `session_id: string`（必填）
- `data?: unknown`（start）
- `readonly?: boolean`（start）
- `command?: string`（exec）

**响应**
与现有前端一致：`success`、`output`、`error`、`data` 等字段。

### 3) `GET /sandboxes?session_id=...`
**功能**：获取单一 sandbox 状态或列出活跃 session（用于调试）。

## 功能清单（后端）
- Anthropic 消息流式输出 + 工具调用事件。
- `bash` 工具：通过 e2b 执行；`readonly` 模式不回写 DB。
- 文件工具：`read_file` / `glob_search` / `grep_search`（与前端一致）。
- JSON 节点提取与合并：保持与前端相同的 JSON 路径规则。
- 沙盒数据同步：断开前将 `updatedData` 写入 `table.data`。

## JSON 节点范围说明
- 当前前端仅操作 `json_path` 对应的节点数据；只有 `path` 为空或 `/` 时，才等价于全量 JSON 操作。
- 后端迁移方案已保持一致：sandbox 只接收节点数据，结束后仅合并该节点回 `table.data`。

## 数据与存储
- **不新增数据库表**。使用现有 `table.data`（JSONB）承载上下文数据。
- 前端 Supabase 聊天记录（`chat_sessions` / `chat_messages`）V1 不迁移到后端，不影响 `/agents` 能力。

## 权限与依赖
- 通过 `get_current_user` 与 `get_verified_table` 校验 `table_id` 权限。
- e2b SDK：使用 `upload/download` 完成 `data.json` 传输。
- Anthropic SDK：沿用前端的模型、迭代次数、工具结构与系统提示词模板。

## 前端对接变化（必要最小改动）
- `/api/agent` → `/agents`
- 请求体 `tableData` → `table_id`
- 其余字段与 SSE 事件协议保持不变

## 风险与注意事项
- **只读模式**：e2b 不提供原生只读挂载时，需依赖系统提示与“不回写 DB”的逻辑保证。
- **大体积 JSON**：上传/下载成本与超时风险需监控（可在后续版本考虑分块或增量同步）。
- **工作目录安全**：`workingDirectory` 若保留，需要限制在白名单目录。
