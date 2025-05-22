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
        
        # PuppyEngine 目录
        self.ENGINE_ROOT = os.path.join(str(self.PROJECT_ROOT), "PuppyEngine")
        
        # PuppyStorage 目录
        self.STORAGE_MODULE_ROOT = os.path.join(str(self.PROJECT_ROOT), "PuppyStorage")
        
        # 工具目录
        self.TOOLS_ROOT = os.path.join(str(self.PROJECT_ROOT), "tools")
        
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
        """
        加载环境变量配置
        
        按照以下顺序查找 .env 文件:
        1. 项目根目录 .env
        2. PuppyEngine 目录 .env
        3. PuppyStorage 目录 .env
        """
        # 尝试加载项目根目录的 .env
        root_env_path = paths.PROJECT_ROOT / ".env"
        if root_env_path.exists():
            load_dotenv(root_env_path, override=True)
        
        # 尝试加载 PuppyEngine 目录的 .env
        engine_env_path = Path(paths.ENGINE_ROOT) / ".env"
        if engine_env_path.exists():
            load_dotenv(engine_env_path, override=True)
            
        # 尝试加载 PuppyStorage 目录的 .env
        storage_env_path = Path(paths.STORAGE_MODULE_ROOT) / ".env"
        if storage_env_path.exists():
            load_dotenv(storage_env_path, override=True)
            
    def get(self, key: str, default=None):
        """
        获取配置值
        
        Args:
            key: 配置键名
            default: 默认值
            
        Returns:
            配置值，如不存在则返回默认值
        """
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

# 判断环境: development, staging, production
ENV = os.getenv("PUPPY_ENV", "development").lower()

# 根据环境确定默认日志级别
LOG_LEVEL_MAP = {
    "development": "DEBUG",  # 开发环境显示所有日志
    "staging": "INFO",       # 测试环境显示信息级别以上
    "production": "WARNING"  # 生产环境只显示警告和错误
}

# 可以通过 PUPPY_LOG_LEVEL 环境变量覆盖默认设置
DEFAULT_LOG_LEVEL = os.getenv("PUPPY_LOG_LEVEL", LOG_LEVEL_MAP.get(ENV, "INFO")).upper() 