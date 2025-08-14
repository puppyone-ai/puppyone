[基于OSS的流式传输](https://linear.app/happypuppy/project/基于oss的流式传输-5a5657857d80)
### 目标与范围

* 目标：前端通过 v2 事件流实时展示任务进度与结果；大内容通过外部存储（如 S3）下载，不走事件通道。
* 范围：任务创建/事件订阅/状态机/内容拉取/错误处理/兼容性。

### 接口

* 创建任务
  * POST `/task`（Body: workflow.json；Header: Authorization）
  * 响应：`{ task_id, created_at, blocks_count, edges_count, estimated_usage }`
* 事件订阅（SSE）
  * GET `/task/{task_id}/stream`（Header: Authorization）
  * 返回事件流（每条为 JSON 行，字段含 `event_type`, `task_id`, `timestamp`）
* 任务状态（断线恢复/轮询）
  * GET `/task/{task_id}/status`（Header: Authorization）
  * 关键字段：`processed_blocks`, `total_blocks`, `progress_percentage`
* 外部存储下载（统一入口）
  * GET `/download/url?key={resource_key or file_key}`（Header: Authorization）
  * 响应：`{ download_url, key, expires_at }`
  * 使用方式：
    * S3/MinIO：直接请求返回的 `download_url`（预签名 URL）
    * 本地适配器：`download_url` 为 `/download/stream/{key}`，直接请求

### 事件类型与字段（核心）

* TASK_STARTED: `env_id, total_blocks, total_edges, timestamp`
* EDGE_STARTED/EDGE_COMPLETED: `edge_id, edge_type, output_blocks?, timestamp`
* EDGE_ERROR: `edge_id, error_message, error_type, timestamp`
* STREAM_STARTED: `block_id, version_id, content_type, timestamp`
* STREAM_ENDED: `block_id, resource_key, timestamp`
* STREAM_ERROR: `block_id, error, timestamp`
* BLOCK_UPDATED:
  * 通用：`block_id, storage_class, timestamp`
  * internal：额外 `content`
  * external：额外 `external_metadata={ resource_key, content_type, version_id, chunked, uploaded_at }`
* BATCH_COMPLETED: `edge_ids, output_blocks, timestamp`
* PROGRESS_UPDATE: `env_id, progress, timestamp`
* TASK_COMPLETED/TASK_FAILED

示例（external 路径）

```json
{ "event_type":"STREAM_STARTED","block_id":"b1","version_id":"v-123","content_type":"structured","timestamp":"..." }
{ "event_type":"STREAM_ENDED","block_id":"b1","resource_key":"user123/b1/v-123","timestamp":"..." }
{ "event_type":"BLOCK_UPDATED","block_id":"b1","storage_class":"external","external_metadata":{"resource_key":"user123/b1/v-123","content_type":"structured","version_id":"v-123","chunked":true,"uploaded_at":"..."},"timestamp":"..." }
```

### 事件顺序语义（单块保证）

* external：STREAM_STARTED → STREAM_ENDED → BLOCK_UPDATED（若 STREAM_ERROR/EDGE_ERROR，则不再发该块 BLOCK_UPDATED）
* internal：直接 BLOCK_UPDATED（无 STREAM\_\*）

### 前端状态机（每 block_id）

* pending → uploading(收到 STREAM_STARTED) → uploaded(收到 STREAM_ENDED) → ready(收到 BLOCK_UPDATED)
* internal：直接 ready
* error：任一 STREAM_ERROR/EDGE_ERROR

### 内容拉取策略

* internal：用 `BLOCK_UPDATED.content` 直接渲染
* external：
  * 从 `BLOCK_UPDATED.external_metadata.resource_key` 构造 key
  * 获取 manifest：`GET /download/url?key={resource_key}/manifest.json` → 请求返回的 `download_url`
  * 拉取 chunk：对每个 `chunk_name` 调 `GET /download/url?key={resource_key}/{chunk_name}` → 请求返回的 `download_url`
  * 处理：
    * `content_type=text/binary`：顺序拼接
    * `structured(jsonl)`：逐行增量解析，支持分页/虚拟列表
* 注意：只有获取预签名 URL 这一步需要 Authorization；访问 `download_url` 不需要 Authorization；`expires_at` 过期需重新获取。

### UI 行为建议

* 卡片按 `block_id` 聚合事件；显示状态 uploading/uploaded/ready/error
* external：展示“可下载/预览”操作；首屏可按需加载小预览
* 任务进度：`PROGRESS_UPDATE` 或累计 `BLOCK_UPDATED` / `total_blocks`
* 断线恢复：SSE 重连 + `/status` 补齐进度

### 错误与超时

* 长时间“uploading”：提示卡顿，可“重试/取消”
* 任一 ERROR：切 error；展示文案与重试入口
* `download_url` 过期：自动重新获取

### 兼容 v1（如仍在用）

* v1 批量 `data`：
  * internal：为内容
  * external：为指针对象 `{ storage_class:'external', external_metadata:{...} }`
* v1 消费者需改为按指针懒加载，不再假设 `data` 恒为内容

### 验收标准

* internal：直接展示；无 STREAM\_\*；进度准确
* external：遵循事件顺序；BLOCK_UPDATED 不含大内容；可成功按指针下载与预览/下载
* 断线重连：通过 `/status` 恢复进度并继续展示
* 错误流程：出现 STREAM_ERROR/EDGE_ERROR/TASK_FAILED 时 UI 正确降级
* 小结：
  * 事件类型保持不变；顺序与载荷已优化为数据最小化
  * S3/MinIO 直用预签名 `download_url`；本地返回 `/download/stream/{key}`
  * 前端以每块状态机 + 懒加载下载完成对接
    
    @liuzhening 

*Progress since Aug 1*: 25% → 63%