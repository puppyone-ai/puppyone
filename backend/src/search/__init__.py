"""Search module.

提供：
- Search Tool 的 indexing（chunking + embedding + turbopuffer 写入）
- Search Tool 的 query（ANN 向量检索 + 基于 chunk_id 回表回填 chunk_text）
"""
