"""
Import Module Configuration
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class ImportConfig(BaseSettings):
    """Configuration for import service."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        env_ignore_empty=True,
    )

    # Redis / ARQ settings
    import_redis_url: str = Field(
        default="redis://localhost:6379/0",
        description="Redis connection URL for import runtime state and ARQ",
    )

    import_redis_prefix: str = Field(
        default="import:",
        description="Redis key prefix for import runtime state",
    )

    import_state_ttl_seconds: int = Field(
        default=24 * 60 * 60,
        description="TTL for import runtime state in Redis (seconds)",
    )

    import_arq_queue_name: str = Field(
        default="import:queue",
        description="ARQ queue name for import jobs",
    )

    import_job_timeout_seconds: int = Field(
        default=1800,
        description="Import job timeout in seconds (30 minutes)",
    )

    import_max_jobs: int = Field(
        default=10,
        description="Maximum concurrent import jobs",
    )


# Global config instance
import_config = ImportConfig()

