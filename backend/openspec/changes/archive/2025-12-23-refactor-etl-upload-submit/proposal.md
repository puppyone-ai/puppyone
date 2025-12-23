# Change: Refactor ETL upload/submit/mount flow (frontend-simplified)

## Why

当前前端要实现“上传文件 → 解析 → 挂载到 table 的 json_path”需要分别调用 `upload`、`submit`、`mount`、`get_status` 多个接口，流程复杂且容易出错。与此同时，`src/project/router.py` 中的文件夹导入也与 ETL 的二进制解析能力强耦合，应该统一归并到 ETL 的控制面，降低前端集成成本。

## What Changes

- 新增一条对前端友好的 **`upload_and_submit`** 一体化接口，统一 upload + submit（并自动处理“文件 vs 文件夹/多文件”）。
- `submit` 支持传入可选的 `table_id` 与 `json_path`，实现 **任务完成后自动挂载**（前端不再需要显式调用 mount）。
- 文件夹导入能力从 `project` 模块归并到 `etl` 模块：新增/统一入口由 ETL 负责触发“多文件上传 + 多任务提交 + 完成后挂载/建表”。
- **替换旧接口**：`upload_and_submit` 将直接取代旧的 `/etl/upload`、`/etl/submit` 与 `/projects/{project_id}/import-folder`；本变更不考虑兼容性，旧接口与相关实现可直接删除。

## Impact

- Affected specs:
  - `openspec/specs/etl-core/spec.md`
- Affected code (implementation stage):
  - `src/etl/router.py`, `src/etl/schemas.py`, `src/etl/service.py`
  - `src/etl/jobs/jobs.py`（任务完成后挂载/建表逻辑）
  - `src/project/router.py`, `src/project/service.py`（删除 import-folder 相关内容）
  - `src/table/service.py`（挂载能力复用）


