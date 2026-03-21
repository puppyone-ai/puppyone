"""
Chunking configuration.

Manages configuration for chunking behavior including thresholds, sizes, and limits.
All values can be configured via environment variables.
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class ChunkingConfig(BaseSettings):
    """Chunking behavior configuration (character-based).

    All values can be configured via environment variables:
    - CHUNK_THRESHOLD_CHARS: 超过此字符数的内容才会被分块 (default: 15000)
    - CHUNK_SIZE_CHARS: 每个分块的目标大小 (default: 1000)
    - CHUNK_OVERLAP_CHARS: 分块之间的重叠字符数 (default: 200)
    - MAX_CONTENT_SIZE_CHARS: 单个内容的最大字符数 (default: 500000)
    - MAX_CHUNKS_PER_NODE: 单个节点最大分块数 (default: 500)
    """

    model_config = SettingsConfigDict(
        env_file=None,  # 由 src.main 统一 load_dotenv()
        extra="ignore",
        env_ignore_empty=True,
        populate_by_name=True,
    )

    chunk_threshold_chars: int = Field(
        default=15000, ge=0, alias="CHUNK_THRESHOLD_CHARS"
    )
    chunk_size_chars: int = Field(default=1000, ge=1, alias="CHUNK_SIZE_CHARS")
    chunk_overlap_chars: int = Field(default=200, ge=0, alias="CHUNK_OVERLAP_CHARS")

    max_content_size_chars: int = Field(
        default=500_000, ge=1, alias="MAX_CONTENT_SIZE_CHARS"
    )
    max_chunks_per_node: int = Field(default=500, ge=1, alias="MAX_CHUNKS_PER_NODE")


# 全局配置实例（与项目中其它模块保持一致的使用方式）
chunking_config = ChunkingConfig()
