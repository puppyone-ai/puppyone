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
    NOTION_REDIRECT_URI: str = "http://localhost:3000/oauth/callback/notion"

    # GitHub OAuth 配置
    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""
    GITHUB_REDIRECT_URI: str = "http://localhost:3000/oauth/callback/github"

    # Google Sheets OAuth 配置
    GOOGLE_SHEETS_CLIENT_ID: str = ""
    GOOGLE_SHEETS_CLIENT_SECRET: str = ""
    GOOGLE_SHEETS_REDIRECT_URI: str = "http://localhost:3000/oauth/callback/google-sheets"

    # Linear OAuth 配置
    LINEAR_CLIENT_ID: str = ""
    LINEAR_CLIENT_SECRET: str = ""
    LINEAR_REDIRECT_URI: str = "http://localhost:3000/oauth/callback/linear"

    # Airtable OAuth 配置
    AIRTABLE_CLIENT_ID: str = ""
    AIRTABLE_CLIENT_SECRET: str = ""
    AIRTABLE_REDIRECT_URI: str = "http://localhost:3000/oauth/callback/airtable"

    # 服务间通信
    INTERNAL_API_SECRET: str = ""   # 内部服务通信密钥
    MCP_SERVER_URL: str = ""        # MCP服务的地址
    
    # 公共访问 URL（用于生成对外的 API 链接）
    # - 本地开发: http://localhost:8000
    # - Railway: https://your-app.railway.app
    # - 如果不设置，会从请求头自动推断
    PUBLIC_URL: str = ""

settings = Settings()
