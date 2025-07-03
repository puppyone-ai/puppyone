import os
from pathlib import Path
from dotenv import load_dotenv

class ConfigValidationError(Exception):
    """配置验证错误"""
    pass

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
        
        # 验证 DEPLOYMENT_TYPE
        deployment_type = os.getenv("DEPLOYMENT_TYPE", "local").lower()
        valid_deployment_types = ["local", "remote"]
        if deployment_type not in valid_deployment_types:
            errors.append(
                f"无效的 DEPLOYMENT_TYPE: '{deployment_type}'. "
                f"有效值: {', '.join(valid_deployment_types)}"
            )
        
        # 如果是 remote 模式，验证必需的配置
        if deployment_type == "remote":
            required_remote_configs = {
                "USER_SYSTEM_URL": "用户系统URL",
                "SERVICE_KEY": "服务密钥"
            }
            
            for config_key, description in required_remote_configs.items():
                value = os.getenv(config_key)
                if not value or value.strip() == "":
                    errors.append(f"remote模式下缺少必需配置: {config_key} ({description})")
        
        # 验证数值型配置
        numeric_configs = {
            "AUTH_TIMEOUT": ("认证超时时间", 1, 60),
            "USAGE_TIMEOUT": ("使用量查询超时时间", 1, 60),
            "USAGE_MAX_RETRIES": ("使用量查询最大重试次数", 0, 10),
        }
        
        for config_key, (description, min_val, max_val) in numeric_configs.items():
            value = os.getenv(config_key)
            if value:
                try:
                    num_value = int(value)
                    if not (min_val <= num_value <= max_val):
                        errors.append(
                            f"{config_key} ({description}) 值超出范围: {num_value}. "
                            f"有效范围: {min_val}-{max_val}"
                        )
                except ValueError:
                    errors.append(f"{config_key} ({description}) 必须是数字，当前值: '{value}'")
        
        # 如果有错误，抛出异常阻止服务启动
        if errors:
            error_message = "配置验证失败，服务无法启动:\n" + "\n".join(f"  - {error}" for error in errors)
            print(f"\n❌ {error_message}\n")
            raise ConfigValidationError(error_message)
        
        # 打印配置信息（用于调试）
        print(f"✅ 配置验证通过: DEPLOYMENT_TYPE={deployment_type}")
        if deployment_type == "remote":
            user_system_url = os.getenv("USER_SYSTEM_URL", "未设置")
            print(f"   USER_SYSTEM_URL={user_system_url}")
            print(f"   SERVICE_KEY={'已设置' if os.getenv('SERVICE_KEY') else '未设置'}")

    def get(self, key: str, default=None):
        return os.getenv(key, default)

# 单例配置实例
config = AppConfig()
