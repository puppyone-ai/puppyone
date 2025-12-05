from src.table.repository import TableRepositorySupabase
from src.table.service import TableService


def get_table_service() -> TableService:
    """
    table_service的依赖注入工厂。使用Supabase作为存储后端
    """
    return TableService(TableRepositorySupabase())
