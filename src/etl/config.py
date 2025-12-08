"""
ETL Configuration

Configuration settings for ETL service.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class ETLConfig(BaseSettings):
    """Configuration for ETL service."""
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Queue settings
    etl_queue_size: int = Field(
        default=30,
        description="Maximum ETL queue size"
    )

    etl_worker_count: int = Field(
        default=3,
        description="Number of ETL worker tasks"
    )

    # Task timeout
    etl_task_timeout: int = Field(
        default=300,
        description="ETL task timeout in seconds (10 minutes)"
    )

    # Cache and storage directories
    etl_cache_dir: str = Field(
        default=".mineru_cache",
        description="Directory for MineRU cache"
    )

    etl_rules_dir: str = Field(
        default=".etl_rules",
        description="Directory for ETL rules"
    )


# Global config instance
etl_config = ETLConfig()

