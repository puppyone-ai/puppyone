from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path
from typing import Literal


class Settings(BaseSettings):
    """应用配置"""

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="ignore",
        env_file_encoding="utf-8"
    )

    # 服务配置
    APP_NAME: str = "ContextBase"
    DEBUG: bool = True
    VERSION: str = "1.0.0"

    # 本地存储配置，现在基本都用Supabase
    DATA_PATH: Path = Path("./data")
    STORAGE_TYPE: Literal["json", "db", "supabase"] = "supabase"

    # CORS配置
    ALLOWED_HOSTS: list[str] = ["*"]

    # JWT配置
    JWT_SECRET: str = "ContextBase-256-bit-secret"
    JWT_ALGORITHM: str = "HS256"

settings = Settings()
