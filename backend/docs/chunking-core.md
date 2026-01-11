# Chunking Core（分块基建）

本文件描述 `add-chunking-core` 变更落地后的最小使用方式：**只包含分块与持久化**，不包含搜索/Tool/MCP 集成。

## 数据库

- 表结构：`sql/chunks.sql`
- 迁移：`sql/migrations/2026-01-11_add_chunks_table.sql`

`chunks.table_id` 外键固定指向：`public.context_table(id)`

## 代码入口

### 文本分块

- 入口：`src/chunking/service.py` → `ChunkingService.chunk_text(...)`
- 配置：`src/chunking/schemas.py` → `ChunkingConfig`

### 从 JSON 提取大字符串节点

- 入口：`ChunkingService.extract_large_strings(data, threshold_chars=..., base_pointer="")`
- 返回：`LargeStringNode(json_pointer, content)`
- `json_pointer` 遵循 RFC6901，并对 key 进行 `~`/`/` 转义（`~0` / `~1`）

### 幂等持久化（核心）

入口：`src/chunking/repository.py` → `ensure_chunks_for_pointer(...)`

参数要点：
- `table_id`: `context_table.id`
- `json_pointer`: 目标字符串节点的 JSON Pointer（例如 `/articles/0/content`）
- `content`: 该节点的完整字符串
- `config`: 可选 `ChunkingConfig`

行为要点：
- 使用 `content_hash = sha256(content)` 做幂等：同一 `(table_id, json_pointer, content_hash)` 重复调用不会重复插入
- 默认启用安全阈值：
  - `max_content_size_chars`
  - `max_chunks_per_node`

## 测试

```bash
uv run pytest tests/chunking
```

