# 只导入工厂类
from .vector_db_factory import VectorDatabaseFactory

# 明确声明只有工厂类是公共API
__all__ = ["VectorDatabaseFactory"] 