## Context
现有 ETL 以 FastAPI 进程内 `asyncio.Queue + workers` 执行，任务中间态保存在 `ETLQueue.tasks` 内存字典中；Supabase 仅写入提交/终态。该模式在多实例/重启场景下难以恢复阶段上下文，且 worker/缓存占用内存导致容量受限。

本变更目标是在 **尽量不改变现有 router 接口** 的前提下：
- 把“中间态 + 阶段产物指针”移动到 Redis（可跨进程/跨实例共享）
- 用 ARQ 承担队列与 worker，拆分链式 job
- 增加 cancel/retry 控制面
- 将 OCR 与后处理抽象为可插拔接口

## Goals / Non-Goals
### Goals
- **可观测的状态机**：任务具有明确阶段（OCR/后处理/完成），每个阶段失败可定位且可从阶段重试。
- **Redis 中间态**：查询路径优先 Redis，减少 DB 查询与进程内内存。
- **ARQ job 链**：OCR 与后处理分离，允许仅重试后处理。
- **控制面**：新增 cancel/retry 端点，且具备权限校验。
- **向后兼容**：原有端点与核心返回结构尽量不变。

### Non-Goals
- 不在本变更中引入新的前端 UI（如任务可视化面板）。
- 不改变 Supabase 表结构（除非实现阶段证明无法满足持久化需求；若发生将另起提案或在 tasks 中明确迁移步骤）。

## Decisions
### Decision: 用 Redis 作为任务“运行态真相源”，Supabase 作为“历史/终态存档”
- **Why**：Redis 适合高频更新与快速读取；Supabase 更适合长期存储与审计。
- **How**：
  - 提交时仍创建 Supabase `etl_task` 记录用于生成 `task_id`（兼容当前接口与 ID 语义）。
  - 运行态（进度、阶段、attempt、job_id、阶段产物指针）写入 Redis，设置 TTL。
  - 终态（completed/failed/cancelled）写回 Supabase，Redis 可保留短期缓存。

### Decision: 阶段产物不直接存 Redis，默认存 S3，Redis 存“指针”
- **Why**：MineRU markdown / 解析产物可能较大，存 Redis 会显著占用内存并影响稳定性。
- **How**：
  - OCR job 产出阶段文件仅需保存 **markdown 的指针**（S3 key），Redis 仅保存 `artifact_mineru_markdown_key`。
  - 当 LLM 失败且 OCR 已完成时，将 `artifact_key`（与必要元数据）写入 Supabase `metadata`，支持用户稍后决定重试。

### Decision: ARQ job 设计为显式链式（OCR job 成功后 enqueue PostProcess job）
- **Why**：解耦阶段，允许“仅重试后处理”，并天然支持扩展更多阶段（例如清洗、分块、embedding 等）。
- **How**：
  - `etl_ocr_job(task_id)`：负责 MineRU 解析，写入 Redis 阶段状态与产物指针；成功后 enqueue `etl_postprocess_job(task_id)`。
  - `etl_postprocess_job(task_id)`：读取 OCR 产物指针，调用规则引擎/LLM，产出最终 JSON，落库终态并清理/缩短 Redis TTL。
  - 取消/重试通过“检查 Redis 状态 + ARQ job 元信息（queued/running）”来决定可否操作。

## Redis State Model (Draft)
以 task 为中心的 hash（示例 key）：
- `etl:task:{task_id}`:
  - `status`: `pending|mineru_parsing|llm_processing|completed|failed|cancelled`
  - `phase`: `ocr|postprocess|finalize`
  - `progress`: `0-100`
  - `attempt_ocr`, `attempt_postprocess`
  - `arq_job_id_ocr`, `arq_job_id_postprocess`
  - `artifact_mineru_markdown_key`（S3 key）
  - `error_code`, `error_message`
  - `updated_at`

TTL 建议：运行态较长（例如 24h），终态较短（例如 1-6h），并允许配置。

## Control Plane API (Draft)
保持原接口不变，新增：
- `POST /api/v1/etl/tasks/{task_id}/cancel`
  - 仅允许 `pending` 且仍在队列中的任务取消；**已开始处理的任务不取消**（返回 409/400）。
- `POST /api/v1/etl/tasks/{task_id}/retry`
  - 请求体可选：`from_stage`（`mineru|postprocess`）、`force`、`reset_error` 等。
  - 若 OCR 已完成且存在 `artifact_mineru_markdown_key`，允许仅重试后处理。

## Rule / PostProcess (Draft)
- ETL 规则需要支持“跳过大模型阶段”（例如 `postprocess_mode=skip`），此时不调用 LLM，产出一个稳定的 JSON 包装（包含 markdown 指针/必要元信息）。
- 大模型后处理需要抽象为可替换策略（例如 `direct-json`、`chunked-summarize`、`chunked-extract`），并支持根据 markdown 大小阈值自动选择或由 rule 指定。
- 系统需要提供一个“全局默认规则”降低使用门槛：
  - 当用户未提供 `rule_id`（或未配置任何自定义规则）时，系统使用全局默认规则。
  - 全局默认规则默认 `postprocess_mode=skip`，并产出稳定 JSON 包装（不调用 LLM）。

## Risks / Trade-offs
- Redis TTL 过期会导致“运行态信息丢失” → 通过在关键节点把“可重试所需的最小指针”落 Supabase metadata 缓解。
- ARQ worker 与 API 进程的部署方式（同进程/独立进程）会影响运维 → 通过配置化与文档说明处理。
- 增加新的状态值（如 `cancelled`）可能影响严格枚举客户端 → 尽量保持原枚举并仅新增可选字段；若必须新增状态，需在 spec 明确“向后兼容策略”。

## Migration Plan
- 引入 Redis 配置并以“shadow write”方式写入 Redis 状态（实现阶段逐步切换读取优先级）。
- 切换队列实现到 ARQ，并保留旧队列实现作为短期 fallback（可通过配置开关）。
- 上线后观察：任务状态查询时延、worker 内存占用、失败可恢复性。

## Open Questions
- 本提案已确认：
  - cancel 仅支持 queued/pending，不支持中断运行中任务
  - 新增 `cancelled` 状态值
  - OCR 阶段仅需保存 markdown 指针即可支持后续重试

