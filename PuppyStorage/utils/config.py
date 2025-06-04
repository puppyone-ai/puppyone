import os
from pathlib import Path
from dotenv import load_dotenv

# 定义项目关键路径
class PathManager:
    _instance = None
    
    def __new__(cls):
        if not cls._instance:
            cls._instance = super().__new__(cls)
            cls._instance._init_paths()
        return cls._instance
    
    def _init_paths(self):
        """初始化并计算项目的关键路径"""
        # 项目根目录 (PuppyAgent-Jack)
        self.PROJECT_ROOT = Path(__file__).parent.parent.parent
        
        # 存储根目录
        self.STORAGE_ROOT = self.get_path("LOCAL_STORAGE_PATH", 
                                          os.path.join(str(self.PROJECT_ROOT), "local_storage"))
        
        # 确保存储目录存在
        os.makedirs(self.STORAGE_ROOT, exist_ok=True)
    
    def get_path(self, env_key=None, default=None):
        """
        获取路径，优先使用环境变量，其次使用默认值
        
        Args:
            env_key: 环境变量键名
            default: 默认路径
            
        Returns:
            解析后的路径字符串
        """
        if env_key and os.getenv(env_key):
            return os.getenv(env_key)
        return default

# 路径管理器实例
paths = PathManager()

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
    
    def get_path(self, path_key: str):
        """
        获取预定义的项目路径
        
        Args:
            path_key: 路径键名，如 PROJECT_ROOT、STORAGE_ROOT 等
            
        Returns:
            对应的路径字符串，如果不存在则返回None
        """
        return getattr(paths, path_key, None)

# 单例配置实例
config = AppConfig() 