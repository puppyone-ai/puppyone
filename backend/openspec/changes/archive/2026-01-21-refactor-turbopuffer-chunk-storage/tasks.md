## 1. Implementation
- [x] 1.1 更新 Search Tool indexing：turbopuffer upsert_rows 移除 `content`/`chunk_text` 写入，仅保留 `vector` + metadata
- [x] 1.2 更新 Search Tool query：从 hybrid（ANN+BM25）调整为 ANN，并保留现有输出结构
- [x] 1.3 增强 `ChunkRepository`：支持按 chunk_id 批量/多次读取 chunks，用于回填 `chunk_text`
- [x] 1.4 更新 Search Tool 返回：基于 turbopuffer row.attributes 中的 `chunk_id` 回表补齐 `chunk_text`
- [x] 1.5 更新 `src/mcp/description/search.txt` 与 OpenSpec delta 保持一致
- [x] 1.6 运行最小回归检查（lint/类型检查/基础单测如有）

