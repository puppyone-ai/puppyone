# Turbopuffer E2E Tests

本目录包含 **Turbopuffer 端到端（e2e）测试**，用于验证：
- 写入/建索引（schema + distance_metric + upsert）
- 向量搜索、全文搜索（BM25）、混合搜索（multi_query + 简单 RRF）
- namespace 删除
- 其他辅助 API：metadata、warm cache、list namespaces、filter/patch/delete by filter

## 运行方式（示例）

在运行前请确保已设置环境变量：
- `TURBOPUFFER_API_KEY`
- （可选）`TURBOPUFFER_REGION`

跑两次：
第一次（留下 namespace，方便你去后台看修改是否生效）：
```bash
uv run pytest -q -s tests/e2e/turbopuffer/test_turbopuffer_e2e.py -k keep_namespace
```

第二次（删除上一次留下的 namespace）：
```bash
uv run pytest -q -s tests/e2e/turbopuffer/test_turbopuffer_e2e.py -k delete_namespace_from_last_run
```
（我已经本地分别跑过两条命令，两个测试都能单独通过。）

## 结果输出

测试运行时会将结果：
- 打印到 stdout（建议加 `-s` 查看）
- 同时写入：`tests/e2e/e2e_result.md`

注意：报告中 **不会** 写入任何 API Key 等敏感信息。
