## Context
Search Tool 在创建时需要完成 scope 数据的 chunking/embedding/upsert（turbopuffer），该过程可能耗时较长。当前实现将该过程放在 `POST /api/v1/tools` 请求内同步执行，导致接口易超时且并发受限。

## Goals / Non-Goals
- Goals
  - 创建 Search Tool 接口快速返回（不等待 indexing 完成）
  - indexing 在后台异步执行，并将结果回写到独立状态表 `search_index_task`
  - 提供轮询接口，前端可查询 indexing 状态
  - 为 best-effort 路径补齐日志，便于排障
- Non-Goals
  - 不引入新的外部队列/worker 依赖（本次先用 FastAPI/Starlette 的 background task 能力）
  - 不改变 `SearchService.index_scope` 的核心逻辑与检索行为

## Decisions
- 异步执行机制
  - 使用 FastAPI `BackgroundTasks` 在响应返回后启动 indexing 协程（最小改动、易于部署）
  - 后续如需更强的可靠性/重试/解耦，可迁移到 ETL 的任务队列或独立 worker
- 状态存储
  - 使用独立表 `search_index_task` 存储索引任务状态，避免对 `tool.metadata` 做 jsonb 覆盖更新：
    - status: pending/indexing/ready/error
    - started_at/finished_at
    - nodes_count/chunks_count/indexed_chunks_count
    - last_error: 失败原因（截断）

## Risks / Trade-offs
- BackgroundTasks 仍运行在 Web 进程内，长任务会占用 worker 的 CPU/网络资源；但不会阻塞创建接口响应。
- 进程重启会中断后台任务；前端可通过轮询看到长期停留在 indexing 的状态（本次将增加超时/错误落库策略作为缓解）。

## Migration Plan
- 增加新接口，不移除旧接口；前端逐步切换到异步创建 + 轮询模式。

