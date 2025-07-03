import os
from pathlib import Path
from dotenv import load_dotenv

class ConfigValidationError(Exception):
    """配置验证错误"""
    pass

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
        
        # 验证关键配置项
        self._validate_config()
    
    def _validate_config(self):
        """验证关键配置项的有效性"""
        errors = []
        warnings = []
        
        # 验证关键路径的访问权限
        critical_paths = {
            "PROJECT_ROOT": paths.PROJECT_ROOT,
            "STORAGE_ROOT": paths.STORAGE_ROOT
        }
        
        for path_name, path_value in critical_paths.items():
            if not path_value:
                errors.append(f"关键路径未设置: {path_name}")
                continue
                
            path_obj = Path(path_value)
            
            # 检查路径是否存在
            if not path_obj.exists():
                try:
                    path_obj.mkdir(parents=True, exist_ok=True)
                    warnings.append(f"自动创建目录: {path_name} -> {path_value}")
                except Exception as e:
                    errors.append(f"无法创建目录 {path_name} ({path_value}): {str(e)}")
                    continue
            
            # 检查读写权限
            if not os.access(path_value, os.R_OK):
                errors.append(f"路径不可读: {path_name} ({path_value})")
            
            if not os.access(path_value, os.W_OK):
                errors.append(f"路径不可写: {path_name} ({path_value})")
        
        # 验证Axiom配置（可选）
        axiom_token = os.getenv("AXIOM_TOKEN")
        axiom_org_id = os.getenv("AXIOM_ORG_ID") 
        axiom_dataset = os.getenv("AXIOM_DATASET")
        
        if any([axiom_token, axiom_org_id, axiom_dataset]):
            # 如果配置了任何Axiom参数，则检查完整性
            missing_axiom = []
            if not axiom_token:
                missing_axiom.append("AXIOM_TOKEN")
            if not axiom_org_id:
                missing_axiom.append("AXIOM_ORG_ID")
            if not axiom_dataset:
                missing_axiom.append("AXIOM_DATASET")
            
            if missing_axiom:
                warnings.append(
                    f"Axiom配置不完整，将使用本地日志: 缺少 {', '.join(missing_axiom)}"
                )
        
        # 验证数值型配置
        numeric_configs = {
            "STORAGE_MAX_SIZE_GB": ("存储最大容量(GB)", 1, 1000),
            "CLEANUP_INTERVAL_HOURS": ("清理间隔(小时)", 1, 168),  # 1小时到1周
        }
        
        for config_key, (description, min_val, max_val) in numeric_configs.items():
            value = os.getenv(config_key)
            if value:
                try:
                    num_value = float(value)
                    if not (min_val <= num_value <= max_val):
                        warnings.append(
                            f"{config_key} ({description}) 值超出推荐范围: {num_value}. "
                            f"推荐范围: {min_val}-{max_val}"
                        )
                except ValueError:
                    warnings.append(f"{config_key} ({description}) 应为数字，当前值: '{value}'")
        
        # 处理错误
        if errors:
            error_message = "PuppyStorage配置验证失败，服务无法启动:\n" + "\n".join(f"  - {error}" for error in errors)
            print(f"\n❌ {error_message}\n")
            raise ConfigValidationError(error_message)
        
        # 处理警告
        if warnings:
            warning_message = "\n".join(f"  ⚠️  {warning}" for warning in warnings)
            print(f"\n⚠️  PuppyStorage配置警告:\n{warning_message}\n")
        
        # 打印配置信息（用于调试）
        print(f"✅ PuppyStorage配置验证通过")
        print(f"   PROJECT_ROOT={paths.PROJECT_ROOT}")
        print(f"   STORAGE_ROOT={paths.STORAGE_ROOT}")
        if axiom_token and axiom_org_id and axiom_dataset:
            print(f"   Axiom日志: 已配置")
        else:
            print(f"   日志模式: 本地")
    
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