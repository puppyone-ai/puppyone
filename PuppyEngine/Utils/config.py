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
        # 加载.env文件（如果存在），但不覆盖已有的环境变量
        # 这样Railway等平台的环境变量会保持更高优先级
        env_path = Path(__file__).parent.parent / ".env"
        load_dotenv(env_path, override=False)

    def get(self, key: str, default=None):
        return os.getenv(key, default)

# 单例配置实例
config = AppConfig()
