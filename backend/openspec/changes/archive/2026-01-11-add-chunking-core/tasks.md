## 1. Database / Schema
- [x] 1.1 新增 `chunks` 表 SQL（含索引、唯一约束、外键到 Context 表）
- [x] 1.2（如项目采用 migration 目录）增加对应 migration 文件，并补充字段注释（COMMENT）

## 2. Chunking 模块（内部）
- [x] 2.1 新增 `src/chunking/schemas.py`：Chunk、ChunkSegment、LargeStringNode、配置项（threshold/size/overlap 等）
- [x] 2.2 新增 `src/chunking/service.py`：`chunk_text` 与 `extract_large_strings` 的最小实现（与 `chunk-design.md` 一致）
- [x] 2.3 新增 `src/chunking/repository.py`：chunks 的写入/查询（至少支持按 `(table_id, json_pointer, content_hash)` 查询与幂等创建）
- [x] 2.4 实现 `ensure_chunks_for_pointer(table_id, json_pointer, content, config)`（核心幂等入口）
- [x] 2.5 加入安全阈值：`MAX_CONTENT_SIZE`、`MAX_CHUNKS_PER_NODE`（默认启用，可配置）

## 3. 测试
- [x] 3.1 单元测试：`chunk_text` 的边界（overlap、char_start/end、空白修剪）
- [x] 3.2 单元测试：`extract_large_strings` 的 JSON 遍历（dict/list/string、路径生成符合 JSON Pointer）
- [x] 3.3 repository 测试（mock/fixture）：同 hash 幂等、hash 变化产生新版本 chunks

## 4. 文档与验证
- [x] 4.1 更新/补充开发文档：如何调用 chunking API、如何生成/清理 chunks
- [x] 4.2 本变更完成后运行：`uv run ruff check --fix src && uv run ruff format src && uv run pytest`
  - 说明：`uv run pytest -m "not e2e"` 当前在仓库内存在 5 个测试收集错误（与本变更无关）；`uv run pytest tests/chunking` 已通过

