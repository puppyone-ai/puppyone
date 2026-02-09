# Change: 重构 ETL 执行引擎（Redis 状态 + ARQ 链式任务 + 控制面）

## Why
- 现有 ETL 采用“提交任务 + 进程内 asyncio.Queue + 内存缓存”的模式，中间状态仅在内存，导致任务生命周期难追踪、无法从阶段重试、worker 占用大量内存且扩容不友好。
- 任意阶段失败统一进入 `failed`，缺少可恢复的阶段信息与可控重试策略，影响稳定性与可运维性。

## What Changes
- **保持现有 ETL 对外 API 端点尽量不变**（`/api/v1/etl/submit`, `/api/v1/etl/tasks/{task_id}`, `/api/v1/etl/tasks`, `/api/v1/etl/upload`, `/api/v1/etl/tasks/{task_id}/mount`, `/api/v1/etl/health`, `/api/v1/etl/rules...`）。
- 将“中间状态存储”从 **进程内内存**迁移到 **Redis**：
  - 查询任务状态/列表时优先读 Redis 的最新状态；Redis 未命中再回退 Supabase（历史/终态）。
  - 仅在必要时写入 Supabase（提交时创建记录、终态/取消/需要长期保留的中间态快照）。
- 使用 **ARQ** 实现队列与 worker，将原本单 worker 串行/耦合的处理流程拆成 **链式 job**：
  - OCR（MineRU）与后处理（LLM+规则引擎）拆分为独立 job，可从阶段重试而不是从头执行。
- 增加“控制面”能力（新增合理端点）：
  - **取消任务**：仅允许取消 queued/pending（已提交但尚未执行）的任务；已开始执行不支持取消。
  - **从阶段重试**：支持从 `mineru` 或 `postprocess(llm)` 阶段重试；当 MineRU 已完成但 LLM 失败时，可持久化必要的阶段产物指针，允许用户决定是否重试。
- 面向接口编程（内部模块化）：
  - 定义 `OCRProvider` 与 `PostProcessor`（后处理）接口，MineRU/LLM 作为具体实现，后续可替换为其他 OCR 或后处理方案而不影响路由层与任务模型。
- 规则与后处理能力增强：
  - **ETL 规则**支持配置“跳过大模型阶段”（仅产出 OCR markdown 指针/内容的 JSON 包装，不调用 LLM）。
  - **大模型后处理**抽象为可插拔算法：当 markdown 很大时，可采用分块总结/分块提取等策略（可配置或自动选择）。
- 默认可用的全局规则：
  - 系统提供一个**全局 ETL 规则**降低用户使用门槛；当用户未配置/未指定规则时自动使用。
  - 全局规则默认 `postprocess_mode=skip`，产出“markdown → JSON 包装结果”（不调用 LLM）。

## Impact
- **Affected specs**:
  - `openspec/specs/etl-core/spec.md`（修改：队列实现、状态读取策略、持久化策略；新增：取消/重试/链式 job/接口化模块）
- **Affected code (implementation stage)**:
  - `src/etl/tasks/queue.py`、`src/etl/service.py`、`src/etl/dependencies.py`、`src/etl/router.py`
  - 新增 Redis 状态存储与 ARQ worker/job 定义（例如 `src/etl/executor/`、`src/etl/state/`、`src/etl/jobs/` 等）
- **Compatibility notes**:
  - 现有响应字段保持兼容；新增 `cancelled` 状态值，并在 `metadata` 中增加更细阶段信息/产物指针。
  - 新增端点用于 cancel/retry，不影响既有调用方。
  - `/etl/submit` 可在保持原字段兼容的同时支持“未指定 rule_id 时使用全局默认规则”。

