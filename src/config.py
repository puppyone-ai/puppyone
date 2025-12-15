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

    # 测试配置
    SKIP_AUTH: bool = False  # 是否跳过鉴权（仅用于测试环境）

    # ETL 配置
    # - None: 自动模式（本地 DEBUG 默认关闭，非 DEBUG 默认开启）
    # - True/False: 强制开启/关闭（可通过环境变量 ENABLE_ETL 覆盖）
    ENABLE_ETL: bool | None = None

    @property
    def etl_enabled(self) -> bool:
        """ETL 是否启用（同时控制 ETL 路由导入与 ETL 服务启动）"""
        if self.ENABLE_ETL is not None:
            return self.ENABLE_ETL
        return not self.DEBUG

    # Notion OAuth 配置
    NOTION_CLIENT_ID: str = ""
    NOTION_CLIENT_SECRET: str = ""
    NOTION_REDIRECT_URI: str = "http://localhost:3000/oauth/callback"

settings = Settings()
