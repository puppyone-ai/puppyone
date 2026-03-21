"""
Turbopuffer 配置

约定：
- 缺失关键配置（如 API Key）时：仅 warning，不阻断应用启动
- 但在真正发起请求时：需要抛出明确的模块异常，方便上层处理
"""

from __future__ import annotations

import logging

from pydantic import Field
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class TurbopufferConfig(BaseSettings):
    model_config = SettingsConfigDict(
        # 本项目在 `src.main` 里统一 `load_dotenv()`，这里仅从环境变量读取，避免测试/多环境下出现
        # “没设置 env var，但被 .env 隐式注入”的不可控行为。
        env_file=None,
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
