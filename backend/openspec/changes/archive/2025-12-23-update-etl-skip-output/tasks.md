## 1. Implementation
- [x] 1.1 Locate skip-mode output generation in `etl_postprocess_job`
- [x] 1.2 Change output schema to `{<file_base_name>: {"filename": <original>, "content": <markdown>}}`
- [x] 1.3 Ensure internal retry pointers keep using S3 key (task metadata) but do not leak into output
- [x] 1.4 Add a small backward-compatibility note or migration guidance

## 2. Validation
- [x] 2.1 Run lints for modified files
- [x] 2.2 Smoke test: run ETL with skip rule and inspect mounted JSON
