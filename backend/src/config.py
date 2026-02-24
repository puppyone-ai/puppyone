import json
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AliasChoices, Field, field_validator, model_validator
from pathlib import Path
from typing import Any, Literal, Optional


class Settings(BaseSettings):
    """应用配置"""

    model_config = SettingsConfigDict(
        env_file=".env", case_sensitive=True, extra="ignore", env_file_encoding="utf-8"
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls,
        init_settings,
        env_settings,
        dotenv_settings,
        file_secret_settings,
    ):
        # 让项目级 .env 优先生效，覆盖全局环境变量
        return (
            init_settings,
            dotenv_settings,
            env_settings,
            file_secret_settings,
        )

    # 服务配置
    APP_NAME: str = "ContextBase"
    APP_ENV: Literal["development", "test", "staging", "production"] = Field(
        default="development",
        validation_alias=AliasChoices("APP_ENV", "ENVIRONMENT"),
    )
    DEBUG: bool | None = None
    VERSION: str = "1.0.0"

    # 本地存储配置，现在基本都用Supabase
    DATA_PATH: Path = Path("./data")
    STORAGE_TYPE: Literal["json", "db", "supabase"] = "supabase"

    # CORS配置
    ALLOWED_HOSTS: list[str] | None = None

    @field_validator("ALLOWED_HOSTS", mode="before")
    @classmethod
    def normalize_allowed_hosts(cls, value: Any) -> Any:
        """支持 JSON 数组、单值字符串或逗号分隔字符串。"""
        if value is None:
            return None

        hosts: list[str]

        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return []

            if raw.startswith("["):
                try:
                    parsed = json.loads(raw)
                except json.JSONDecodeError as exc:
                    raise ValueError(
                        "ALLOWED_HOSTS must be a JSON array or comma-separated string"
                    ) from exc
                if not isinstance(parsed, list):
                    raise ValueError("ALLOWED_HOSTS JSON value must be an array")
                hosts = [str(item) for item in parsed]
            else:
                hosts = [item.strip() for item in raw.split(",")]
        elif isinstance(value, list):
            hosts = [str(item).strip() for item in value]
        else:
            return value

        normalized_hosts: list[str] = []
        for host in hosts:
            if not host:
                continue
            normalized_hosts.append(host if host == "*" else host.rstrip("/"))

        return normalized_hosts

    @model_validator(mode="after")
    def apply_runtime_defaults(self):
        """按环境补齐默认配置，降低生产误配风险。"""
        if self.DEBUG is None:
            self.DEBUG = self.APP_ENV in {"development", "test"}

        if self.ALLOWED_HOSTS is None:
            if self.APP_ENV in {"development", "test"}:
                self.ALLOWED_HOSTS = [
                    "http://localhost:3000",
                    "http://localhost:3001",
                    "http://127.0.0.1:3000",
                    "http://127.0.0.1:3001",
                ]
            else:
                self.ALLOWED_HOSTS = ["*"] if self.DEBUG else []

        return self

    # JWT配置
    JWT_SECRET: str = "ContextBase-256-bit-secret"
    JWT_ALGORITHM: str = "HS256"

    # Anthropic 配置
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_BASE_URL: str = ""
    ANTHROPIC_MODEL: str = "claude-sonnet-4-5-20250929"

    # 沙盒配置
    # - "e2b": 使用 E2B 云沙盒（需要 E2B_API_KEY）
    # - "docker": 使用本地 Docker 容器沙盒
    # - "auto": 自动选择（有 E2B_API_KEY 用 E2B，否则用 Docker）
    SANDBOX_TYPE: Literal["e2b", "docker", "auto"] = "auto"
    # 沙盒文件下载并发数
    SANDBOX_DOWNLOAD_CONCURRENCY: int = 10
    # 大文件流式处理阈值（字节），超过此大小使用流式传输
    SANDBOX_LARGE_FILE_THRESHOLD: int = 50 * 1024 * 1024  # 50MB

    # Workspace Provider 配置
    # - "auto": 自动检测平台（macOS → APFS Clone, Linux → OverlayFS, 其他 → 全量复制）
    # - "apfs": 强制使用 APFS Clone（macOS only）
    # - "overlayfs": 强制使用 OverlayFS（Linux only）
    # - "fallback": 强制使用全量复制
    WORKSPACE_PROVIDER: str = "auto"
    WORKSPACE_BASE_DIR: str = "/tmp/contextbase"

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

    # Notion 配置
    # 方式1: Internal Integration (简单，只需 API Key)
    NOTION_API_KEY: str = ""  # 格式: secret_xxx，从 https://www.notion.so/my-integrations 获取
    # 方式2: OAuth (适合多用户场景)
    # ========== OAuth 配置 ==========
    # 统一格式: /oauth/{provider}/callback
    
    # Notion OAuth 配置
    NOTION_CLIENT_ID: str = ""
    NOTION_CLIENT_SECRET: str = ""
    NOTION_REDIRECT_URI: str = "http://localhost:3000/oauth/notion/callback"

    # GitHub OAuth 配置
    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""
    GITHUB_REDIRECT_URI: str = "http://localhost:3000/oauth/github/callback"

    # Google Sheets OAuth 配置 (所有 Google 服务共用 Client ID/Secret)
    GOOGLE_SHEETS_CLIENT_ID: str = ""
    GOOGLE_SHEETS_CLIENT_SECRET: str = ""
    GOOGLE_SHEETS_REDIRECT_URI: str = "http://localhost:3000/oauth/google-sheets/callback"

    # Gmail OAuth 配置 (自动复用 Google Sheets 的 Client ID/Secret)
    GMAIL_CLIENT_ID: Optional[str] = None
    GMAIL_CLIENT_SECRET: Optional[str] = None
    GMAIL_REDIRECT_URI: str = "http://localhost:3000/oauth/gmail/callback"

    # Google Drive OAuth 配置 (自动复用 Google Sheets 的 Client ID/Secret)
    GOOGLE_DRIVE_CLIENT_ID: Optional[str] = None
    GOOGLE_DRIVE_CLIENT_SECRET: Optional[str] = None
    GOOGLE_DRIVE_REDIRECT_URI: str = "http://localhost:3000/oauth/google-drive/callback"

    # Google Calendar OAuth 配置 (自动复用 Google Sheets 的 Client ID/Secret)
    GOOGLE_CALENDAR_CLIENT_ID: Optional[str] = None
    GOOGLE_CALENDAR_CLIENT_SECRET: Optional[str] = None
    GOOGLE_CALENDAR_REDIRECT_URI: str = "http://localhost:3000/oauth/google-calendar/callback"

    # Google Docs OAuth 配置 (自动复用 Google Sheets 的 Client ID/Secret)
    GOOGLE_DOCS_CLIENT_ID: Optional[str] = None
    GOOGLE_DOCS_CLIENT_SECRET: Optional[str] = None
    GOOGLE_DOCS_REDIRECT_URI: str = "http://localhost:3000/oauth/google-docs/callback"

    # Linear OAuth 配置
    LINEAR_CLIENT_ID: str = ""
    LINEAR_CLIENT_SECRET: str = ""
    LINEAR_REDIRECT_URI: str = "http://localhost:3000/oauth/linear/callback"

    # Airtable OAuth 配置
    AIRTABLE_CLIENT_ID: str = ""
    AIRTABLE_CLIENT_SECRET: str = ""
    AIRTABLE_REDIRECT_URI: str = "http://localhost:3000/oauth/airtable/callback"

    # 服务间通信
    INTERNAL_API_SECRET: str = ""  # 内部服务通信密钥
    MCP_SERVER_URL: str = ""  # MCP服务的地址

    # 公共访问 URL（用于生成对外的 API 链接）
    # - 本地开发: http://localhost:8000
    # - Railway: https://your-app.railway.app
    # - 如果不设置，会从请求头自动推断
    PUBLIC_URL: str = ""

    # Context Publish 配置
    PUBLISH_DEFAULT_EXPIRES_DAYS: int = 7
    PUBLISH_KEY_LENGTH: int = 16
    PUBLISH_CACHE_TTL_SECONDS: int = 10

    # Search Tool indexing（异步）
    # - 仅用于异步 indexing 的 wait_for 超时控制，避免后台任务无限挂起
    SEARCH_INDEX_TIMEOUT_SECONDS: int = 120


settings = Settings()
