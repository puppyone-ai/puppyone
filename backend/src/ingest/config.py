"""
Ingest Module Configuration - Unified config for file and SaaS ingestion.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class IngestConfig(BaseSettings):
    """Unified ingest configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        env_ignore_empty=True,
    )

    # Feature flags
    ingest_file_enabled: bool = Field(
        default=True,
        description="Enable file ingestion (ETL)",
    )
    
    ingest_saas_enabled: bool = Field(
        default=True,
        description="Enable SaaS ingestion (Import)",
    )


# Global config instance
ingest_config = IngestConfig()



