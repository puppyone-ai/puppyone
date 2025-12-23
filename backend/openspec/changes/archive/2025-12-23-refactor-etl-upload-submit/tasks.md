## 1. Implementation

- [x] 1.1 扩展 ETL schemas：新增 `upload_and_submit` 响应模型（单/多文件）并提供每个文件的 task_id/status/s3_key/error。
- [x] 1.2 新增 `/api/v1/etl/upload_and_submit`：统一上传（单/多文件）与提交；upload 失败时也创建 task_id（failed），保持轮询一致；支持可选 `table_id/json_path`。
- [x] 1.3 Worker 完成后处理：产出 JSON 后自动挂载；若缺省挂载目标则为每个文件创建一个 Table（短 hash 命名）并挂载；多文件 key 冲突使用 `filename + hash`。
- [x] 1.4 删除旧接口与旧实现：移除 `/etl/upload`、`/etl/submit`、`/etl/tasks/{task_id}/mount`、`/projects/{project_id}/import-folder` 及相关 schemas/service；删除 callback 机制（`src/etl/callbacks.py`）。
- [x] 1.5 测试：更新 ETL API 单测以覆盖 upload_and_submit（成功/上传失败创建 failed task/旧路由 404）。

## 2. Validation

- [x] 2.1 运行 `openspec validate refactor-etl-upload-submit --strict` 并修复所有校验问题。
- [x] 2.2 在实现完成后更新本变更的 tasks 勾选状态为已完成（`- [x]`）。


