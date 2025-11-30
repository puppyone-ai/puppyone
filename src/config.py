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

    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()

