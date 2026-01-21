# Change: Refactor turbopuffer storage to metadata-only for Search Tool

## Why
当前 Search Tool 会将每个 chunk 的 `chunk_text`（通过 turbopuffer 字段 `content`）写入 turbopuffer，导致索引存储膨胀、成本上升且与 `public.chunks` 的数据存在冗余。

## What Changes
- Search Tool indexing 写入 turbopuffer 时不再存储 `chunk_text/content`，仅写入向量 `vector`、`json_pointer` 与必要的 chunk metadata（如 `chunk_id`、`chunk_index`、`total_chunks`、`char_start`/`char_end`、`content_hash` 等）。
- Search Tool query 不再依赖 turbopuffer 的 BM25（因为不再写入全文字段）；检索使用向量 ANN。
- Search Tool 返回结果中的 `chunk_text` 改为在 search 之后基于 `chunk_id`（或等价 metadata）从 `public.chunks` 回填，以保持输出结构完整。

## Impact
- Affected specs: `openspec/specs/context-search/spec.md`
- Affected code:
  - `src/search/service.py`（indexing 写入结构 + search 查询策略 + chunk_text 回填）
  - `src/chunking/repository.py`（补充按 chunk_id 批量读取能力）
  - `src/mcp/description/search.txt`（描述与实现保持一致）

