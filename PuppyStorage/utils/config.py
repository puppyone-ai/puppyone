import os
from pathlib import Path
from dotenv import load_dotenv

class AppConfig:
    _instance = None
    
    def __new__(cls):
        if not cls._instance:
            cls._instance = super().__new__(cls)
            cls._instance._load()
        return cls._instance
    
    def _load(self):
        env_path = Path(__file__).parent.parent / ".env"
        load_dotenv(env_path, override=True)
        
    def get(self, key: str, default=None):
        return os.getenv(key, default)

# 单例配置实例
config = AppConfig() 