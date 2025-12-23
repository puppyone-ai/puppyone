## Context

现有 ETL API 对前端暴露了分步骤的控制面：`/etl/upload` → `/etl/submit` → `/etl/tasks/{id}` 轮询 → `/etl/tasks/{id}/mount` 挂载到 Table。
此外，项目模块中存在文件夹导入端点 `/projects/{project_id}/import-folder`，其内部会创建 Table 并为二进制文件提交 ETL 任务，同时通过 `task.metadata.table_id/file_path` 走回调把结果写回表结构（`src/etl/callbacks.py`）。

本变更将这些能力收敛到 ETL 模块，并对前端提供更简单、更少步骤的 API。

## Goals / Non-Goals

- Goals
  - 前端无需显式调用 mount：在 `submit` 中声明目标 table/json_path 后，任务完成自动挂载。
  - 提供一体化 `upload_and_submit`：一次性提交所有参数，并在一个端点内处理 upload+submit（文件/文件夹统一）。
  - 文件夹导入入口归并到 ETL：对前端暴露统一入口，减少跨模块调用。
  - 保持轮询机制不变：仍通过 `GET /etl/tasks/{task_id}` 获取状态与结果。

- Non-Goals
  - 不在提案阶段决定所有请求体细节（若需，会在实现阶段按 OpenAPI 文档补齐）。
  - 不改变 OCR/后处理核心链路（MineRU/LLM/ARQ/Redis/Supabase）语义。

## Decisions

### Decision: `submit` 扩展为“可选挂载声明”

`POST /api/v1/etl/submit` 新增可选字段：
- `table_id?: int`
- `json_path?: str`（JSON Pointer，例：`/documents/invoices`）

行为：
- 若 `table_id/json_path` 未提供：系统在 `project_id` 下 **为每个文件新建一个 Table**，Table 命名使用短 hash（例如 8～12 位），并将任务输出挂载到该新表的默认路径（例如 `/` 或 `/data`，由实现阶段定稿）。
- 若提供 `table_id/json_path`：任务进入 `completed` 后，系统自动将结果挂载到该 table 的 json_path 下：
  - key 为原始文件名 + hash 后缀（用于避免多文件冲突）
  - value 为任务输出 JSON（从任务 result 的 `output_path` 下载并解析）

实现上可复用 `TableService.create_context_data()`；本变更不保留 folder-import 回填（`callbacks.py`）机制，相关逻辑可删除。

### Decision: 新增 `upload_and_submit` 一体化端点

新增 `POST /api/v1/etl/upload_and_submit`：
- 统一处理：
  - 上传（单文件或多文件/文件夹）
  - 提交任务（单任务或多任务）
  - 写入任务 metadata（例如 `s3_key`、可选挂载声明、可选相对路径）
- 返回值：
  - 对单文件：返回一个 `task_id` 与初始 `status`
  - 对多文件：返回 `task_ids[]` 与每个文件对应的 `task_id/status/upload_key`

轮询机制保持：客户端继续使用 `GET /api/v1/etl/tasks/{task_id}`（或 batch 查询）获得进度与终态。

### Decision: 上传失败时的可轮询失败状态（待确认）

upload 失败时系统仍 SHALL 创建一个 `task_id`，并将任务状态置为 `failed`（metadata 记录 `error_stage="upload"`），以保证前端轮询机制保持一致。

### Decision: 文件夹导入并入 ETL（入口迁移 + 兼容）

- 新能力通过 `upload_and_submit` 覆盖“文件夹/多文件”用例。
- 旧的 `/projects/{project_id}/import-folder` 不再保留：相关路由、schema、service 实现可直接删除。

## Risks / Trade-offs

- `submit` 变得更“重”（引入建表/挂载语义）：需要清晰定义默认建表规则与挂载路径，避免行为隐式导致困惑。
- 文件夹上传语义差异：现有 folder-import 是“树结构 table + 回填节点”，新需求倾向“多文件→多 table / 或挂载到单 table 的 json_path”。需要明确 UX 与命名/冲突策略。
- 自动挂载属于“完成后副作用”：需要幂等与重试策略（避免重复挂载/覆盖），实现阶段需定义 metadata 标记（例如 `mount_processed`）。

## Migration Plan

本变更不提供兼容迁移：直接以 `upload_and_submit` 取代旧接口，并删除旧接口与相关实现。

## Open Questions

（已确认）本提案不再保留 Open Questions；关键决策已明确写入上文：
- 未提供挂载目标：每文件新建 Table（短 hash 命名）。
- upload 失败：仍创建 task_id，状态为 failed，保持轮询一致。
- 多文件 key 冲突：使用 `filename + hash` 作为 key。


