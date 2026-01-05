"""
Turbopuffer 配置

约定：
- 缺失关键配置（如 API Key）时：仅 warning，不阻断应用启动
- 但在真正发起请求时：需要抛出明确的模块异常，方便上层处理
"""

from __future__ import annotations

import logging
import os

from pydantic import Field
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

_ENV_FILE = ".env"
_ENV_FILE_FOR_SETTINGS = (
    _ENV_FILE if (os.path.isfile(_ENV_FILE) and os.access(_ENV_FILE, os.R_OK)) else None
)


class TurbopufferConfig(BaseSettings):
    model_config = SettingsConfigDict(
        # 在某些受限环境（如沙盒/CI）中 `.env` 可能不可读；此时不应阻断应用启动
        env_file=_ENV_FILE_FOR_SETTINGS,
        env_file_encoding="utf-8",
        extra="ignore",
        env_ignore_empty=True,
        populate_by_name=True,
    )

    api_key: str | None = Field(default=None, alias="TURBOPUFFER_API_KEY")
    region: str = Field(default="gcp-us-central1", alias="TURBOPUFFER_REGION")

    # 给未来扩展预留（如自定义 base_url / timeout），但本版本不强制使用
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


# 全局配置实例（与项目中其它模块保持一致的使用方式）
turbopuffer_config = TurbopufferConfig()
