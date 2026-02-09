# Change: Update default ETL skip-mode output schema

## Why
当前默认规则（`postprocess_mode=skip`）产出的 JSON 包含大量元信息（task_id/user_id/project_id/markdown_s3_key 等），挂载到表后不利于阅读与下游使用。默认规则的核心价值是“把 OCR 解析出的 markdown 直接挂载出来”。

## What Changes
- **BREAKING**：当规则 `postprocess_mode=skip` 时，ETL 产出的 `output.json` 结构将从“元信息对象”变更为“以文件名为 key、markdown 内容为 value”的结构。
- 保留 `filename` 字段以便溯源，其余元信息不再写入 output。

## Impact
- Affected specs: `etl-core`
- Affected code: `src/etl/jobs/jobs.py`（`etl_postprocess_job` skip 分支）
- Downstream: `/etl/mount` 以及所有读取 skip 模式结果的客户端需要适配新结构。
