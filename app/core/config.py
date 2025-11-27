from pydantic_settings import BaseSettings
from pathlib import Path
from typing import Literal


class Settings(BaseSettings):
    """应用配置"""
    
    # 服务配置
    APP_NAME: str = "ContextBase"
    DEBUG: bool = True
    VERSION: str = "1.0.0"
    
    # 存储配置
    DATA_PATH: Path = Path("./data")
    STORAGE_TYPE: Literal["json", "db"] = "json"
    
    # CORS配置
    ALLOWED_HOSTS: list[str] = ["*"]

    # JWT配置
    JWT_SECRET: str = "ContextBase-256-bit-secret"
    JWT_ALGORITHM: str = "HS256"

    # 模型配置
    OLLAMA_ENDPOINT: str = "http://localhost:11434"
    OLLAMA_API_ENDPOINT: str = "http://localhost:11434"
    OPENAI_API_KEY: str = ""

    # 向量数据库配置
    CHROMA_PERSIST_DIRECTORY: Path = Path("./data/chroma_db")

    # 文件解析配置
    # 解析方式：'mineru' 使用 MinerU API，'local' 使用本地 Python 库
    FILE_PARSER_MODE: Literal["mineru", "local"] = "local"
    
    # MinerU API 配置
    MINERU_API_TOKEN: str = ""
    MINERU_API_URL: str = "https://mineru.net"
    MINERU_TIMEOUT: int = 300
    MINERU_OUTPUT_FORMAT: str = "markdown"
    MINERU_TEMP_STORAGE_DIR: Path = Path("./data/temp_files")
    # MinerU 文件访问 URL（用于生成 MinerU 可访问的文件 URL）
    # 如果为空，则使用 NEXT_PUBLIC_API_URL
    # 注意：这个 URL 必须能被 MinerU 服务器访问（不能是 localhost）
    MINERU_FILE_BASE_URL: str = ""

    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()