"""
Turbopuffer configuration.

Conventions:
- When key config is missing (e.g. API Key): only warn, do not block app startup
- When actually making requests: throw explicit module exceptions for upstream handling
"""

from __future__ import annotations

import logging

from pydantic import Field
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class TurbopufferConfig(BaseSettings):
    model_config = SettingsConfigDict(
        # This project calls `load_dotenv()` centrally in `src.main`; here we only read from env vars
        # to avoid the uncontrollable behavior of “env var not set but implicitly injected by .env” in tests/multi-env.
        env_file=None,
        extra="ignore",
        env_ignore_empty=True,
        populate_by_name=True,
    )

    api_key: str | None = Field(default=None, alias="TURBOPUFFER_API_KEY")
    region: str = Field(default="gcp-us-central1", alias="TURBOPUFFER_REGION")

    # Reserved for future extension (e.g. custom base_url / timeout), not required in this version
    timeout_seconds: float = Field(default=30.0, alias="TURBOPUFFER_TIMEOUT_SECONDS")

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.api_key.strip())

    @model_validator(mode="after")
    def _warn_if_missing_key(self) -> "TurbopufferConfig":
        if not self.configured:
            logger.warning(
                "TURBOPUFFER_API_KEY is not set. Turbopuffer calls may fail at runtime."
            )
        return self


# Global config instance (consistent with the usage pattern of other modules in the project)
turbopuffer_config = TurbopufferConfig()
