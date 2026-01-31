"""
SaaS Import Configuration

Configuration settings for SaaS import service.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class SyncConfig(BaseSettings):
    """Configuration for SaaS sync/import service."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        env_ignore_empty=True,
    )

    # Redis settings (reuse ETL Redis for simplicity)
    sync_redis_url: str = Field(
        default="redis://localhost:6379/0",
        description="Redis connection URL for sync runtime state and ARQ",
        alias="ETL_REDIS_URL",  # Reuse ETL Redis URL
    )

    sync_redis_prefix: str = Field(
        default="sync:", description="Redis key prefix for sync runtime state"
    )

    sync_state_ttl_seconds: int = Field(
        default=24 * 60 * 60, description="TTL for sync runtime state in Redis (seconds)"
    )

    sync_state_terminal_ttl_seconds: int = Field(
        default=60 * 60, description="TTL for terminal state cache in Redis (seconds)"
    )

    # ARQ settings (reuse ETL queue for unified worker)
    sync_arq_queue_name: str = Field(
        default="etl",  # Same queue as ETL for unified worker
        description="ARQ queue name for sync jobs",
        alias="ETL_ARQ_QUEUE_NAME",
    )

    # Task settings
    sync_task_timeout: int = Field(
        default=600, description="Sync task timeout in seconds (10 minutes)"
    )

    sync_max_file_size_mb: int = Field(
        default=100, description="Maximum file size for sync (MB)"
    )

    sync_max_files_per_repo: int = Field(
        default=10000, description="Maximum files to sync per repository"
    )

    # GitHub specific
    github_download_chunk_size: int = Field(
        default=64 * 1024, description="Chunk size for GitHub ZIP download (bytes)"
    )


# Global config instance
sync_config = SyncConfig()

