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
    - CHUNK_THRESHOLD_CHARS: Content exceeding this character count will be chunked (default: 15000)
    - CHUNK_SIZE_CHARS: Target size per chunk (default: 1000)
    - CHUNK_OVERLAP_CHARS: Number of overlapping characters between chunks (default: 200)
    - MAX_CONTENT_SIZE_CHARS: Maximum character count for a single content (default: 500000)
    - MAX_CHUNKS_PER_NODE: Maximum number of chunks per node (default: 500)
    """

    model_config = SettingsConfigDict(
        env_file=None,  # load_dotenv() is called centrally in src.main
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


# Global config instance (consistent with the usage pattern of other modules in the project)
chunking_config = ChunkingConfig()
