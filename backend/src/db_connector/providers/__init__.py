"""DB Provider Registry"""

from src.db_connector.providers.base import BaseDBProvider
from src.db_connector.providers.supabase_rest import SupabaseRestProvider

# 注册表：加新数据库在这里加一行
PROVIDERS: dict[str, type[BaseDBProvider]] = {
    "supabase": SupabaseRestProvider,
    # "mysql": MySQLProvider,
}


def get_provider(provider_type: str) -> BaseDBProvider:
    """获取对应的 Provider 实例"""
    cls = PROVIDERS.get(provider_type)
    if not cls:
        supported = ", ".join(PROVIDERS.keys())
        raise ValueError(f"Unsupported database provider: {provider_type}. Supported: {supported}")
    return cls()
