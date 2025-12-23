# ETL 前端对接文档（refactor-etl-arq-redis-state）

> 目的：帮助前端快速了解 **接口路径、字段、状态机、以及新增的 cancel/retry/默认规则**，避免对接踩坑。

## 1. 路由前缀与鉴权

没有改变

## 2. 核心变化概览（前端需要知道的）

- **执行引擎变更**：从进程内 `asyncio.Queue` → **ARQ worker + Redis 运行态**
  - 前端体验：接口路径基本不变，但任务状态更稳定可追踪，支持阶段重试/取消（受限）
- **状态来源变更**：
  - `GET /tasks/{id}`：**优先 Redis（运行态）**，终态回退 Supabase
  - `GET /tasks`：以 Supabase 列表为基底，用 Redis 覆盖仍在运行的最新状态
- **新增状态值**：`cancelled`
- **新增控制面端点**：
  - `POST /tasks/{task_id}/cancel`
  - `POST /tasks/{task_id}/retry`
- **submit 入参增强**：
  - `rule_id` 变为可选：不传则使用**全局默认规则**
  - 新增 `s3_key` 可选：用于上传后文件真实 key（推荐）
- **默认规则行为变化（BREAKING）**：
  - 全局默认规则默认 `postprocess_mode=skip`（不调用 LLM）
  - 输出改为“直接挂载 markdown 内容”（见第 5 节）

- **运行态“卡死”治理（新增）**：
  - ARQ job 超时会把任务标记为 `failed`（不再长期卡在 `mineru_parsing/llm_processing`）
  - 若运行态长期不更新（超过 `ETL_TASK_TIMEOUT + 30s`），查询状态时会自动回收为 `failed`（`error_stage=stale`）

## 3. 任务状态机（前端展示建议）

### 3.1 状态枚举

- `pending`：已创建任务并入队（尚未开始）
- `mineru_parsing`：OCR/MineRU 阶段执行中
- `llm_processing`：后处理阶段执行中（可能是 LLM，也可能是 skip 模式的包装输出）
- `completed`：成功完成（result 可用）
- `failed`：失败（error 可用；metadata 可能包含可重试指针）
- `cancelled`：已取消（仅允许取消 queued/pending）
  - 备注：现在支持 `force cancel`（见 4.5），用于处理卡死/误触发的 running 任务（控制面取消，不保证立刻中断外部 provider）

### 3.2 进度（progress）

- `progress` 为 0-100 的整数，用于粗粒度进度条
- 建议 UI：状态文本优先展示 `status`，进度条作为辅助

## 4. API 端点清单与示例

以下示例均以 **`/api/v1/etl`** 为 base。

### 4.1 提交任务：`POST /submit`

**请求体**

```json
{
  "project_id": 123,
  "filename": "invoice.pdf",
  "rule_id": 1,
  "s3_key": "users/<user_id>/raw/123/<uuid>.pdf"
}
```

- `rule_id`：可选。不传则使用全局默认规则（默认 skip-LLM）
- `s3_key`：可选但强烈建议传（上传接口返回的 key），避免文件名含特殊字符导致路径不一致

**响应**

```json
{
  "task_id": 10001,
  "status": "pending",
  "message": "Task submitted successfully"
}
```

### 4.2 查询任务：`GET /tasks/{task_id}`

**响应（运行态示例）**

```json
{
  "task_id": 10001,
  "user_id": "<user_id>",
  "project_id": 123,
  "filename": "invoice.pdf",
  "rule_id": 1,
  "status": "mineru_parsing",
  "progress": 40,
  "created_at": "2025-12-22T00:00:00Z",
  "updated_at": "2025-12-22T00:00:10Z",
  "result": null,
  "error": null,
  "metadata": {
    "s3_key": "users/<user_id>/raw/123/<uuid>.pdf",
    "provider_task_id": "mineru_xxx",
    "artifact_mineru_markdown_key": "users/<user_id>/etl_artifacts/123/10001/mineru.md",
    "error_stage": "postprocess"
  }
}
```

### 4.3 列表任务：`GET /tasks`

查询参数：
- `project_id`（可选）
- `status`（可选，取值同状态枚举）
- `limit` / `offset`（分页，前端可直接沿用）

### 4.4 批量查询：`GET /tasks/batch?task_ids=1,2,3`

返回存在且有权限的任务列表。

### 4.5 取消任务：`POST /tasks/{task_id}/cancel`

**语义**
- 默认仅允许取消 `pending`（queued/pending）任务
- 若任务已进入 `mineru_parsing/llm_processing`，默认返回 **409**
- 支持强制取消：`POST /tasks/{task_id}/cancel?force=true`
  - 允许把 running 任务直接标记为 `cancelled`（控制面取消：不能保证立刻中断 MineRU/LLM 等外部服务调用）
  - 取消后 worker 在关键节点会尊重 `cancelled` 并停止推进（避免被成功路径覆盖）

**响应**

```json
{
  "task_id": 10001,
  "status": "cancelled",
  "message": "Task cancelled successfully"
}
```

### 4.6 从阶段重试：`POST /tasks/{task_id}/retry`

**请求体**

```json
{ "from_stage": "mineru" }
```

或

```json
{ "from_stage": "postprocess" }
```

**语义**
- `mineru`：从 OCR 重新开始
- `postprocess`：仅重试后处理（要求已经存在 `artifact_mineru_markdown_key`）
- 若任务正在运行（`mineru_parsing/llm_processing`），返回 **409**
  - 提示：若任务疑似卡死，可先 `force cancel`，或等待运行态 stale 回收为 `failed` 后再 retry

### 4.7 规则列表：`GET /rules`

**变化点**
- 会自动确保“全局默认规则”存在并可见（若创建失败不影响列表返回）
- 返回中新增（可选）字段：
  - `postprocess_mode`: `llm|skip`
  - `postprocess_strategy`: `direct-json|chunked-summarize` 等

### 4.8 创建规则：`POST /rules`

**请求体（LLM 模式）**

```json
{
  "name": "invoice_llm",
  "description": "Extract invoice fields",
  "json_schema": { "type": "object", "properties": { "invoice_number": { "type": "string" } } },
  "system_prompt": "..."
}
```

**请求体（skip 模式）**

```json
{
  "name": "skip_llm",
  "description": "Only return markdown pointer wrapper",
  "postprocess_mode": "skip"
}
```

### 4.9 mount：`POST /tasks/{task_id}/mount`

仅当任务 `completed` 才允许挂载；否则 400。

## 5. “默认规则 / skip-LLM” 的输出格式（前端如何消费）

**BREAKING**：当使用全局默认规则（或规则设为 `postprocess_mode=skip`）时，最终输出 JSON 文件内容已从“元信息包装”改为“直接挂载 markdown 内容”。

```json
{
  "invoice": {
    "filename": "invoice.pdf",
    "content": "# ...markdown content..."
  }
}
```

前端建议：
- UI 上把它展示成 “已完成（OCR 结果可用）”
- 直接读取 `content` 渲染 markdown 即可（无需再通过 `markdown_s3_key` 二次拉取）

## 6. 兼容性/注意事项（重要）

- **路径**：对外调用仍是 `/api/v1/etl/...`
- **状态新增**：前端状态枚举要兼容 `cancelled`
- **取消限制**：默认只有 `pending` 可 cancel；running 默认 409，但支持 `?force=true`
- **重试限制**：running 409；`postprocess` 重试需要 markdown 指针存在
- **错误信息**：建议优先看 `error`；可选读 `metadata.error_stage`


