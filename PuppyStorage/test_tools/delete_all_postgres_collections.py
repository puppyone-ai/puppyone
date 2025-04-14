import os
import sys
import vecs

# 将项目根目录添加到Python模块搜索路径
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(script_dir)
sys.path.insert(0, project_root)

from utils.logger import log_info, log_error
from utils.config import config


def delete_all_postgres_collections(prefix="test_collection"):
    """
    删除所有带有指定前缀的PostgreSQL集合
    
    Args:
        prefix: 要删除的集合前缀，默认为"test_collection_"
    """
    # Connect to the database
    database_uri = config.get("SUPABASE_URL")
    v = vecs.create_client(database_uri)

    # Retrieve all collections
    collections = v.list_collections()
    
    # 过滤出前缀匹配的集合
    collections_to_delete = [c for c in collections if c.name.startswith(prefix)]
    
    log_info(f"Found {len(collections_to_delete)} collections with prefix '{prefix}' to delete (total collections: {len(collections)}).")

    # Delete each collection
    for collection in collections_to_delete:
        # Ensure collection is a string
        collection_name = collection.name
        v.delete_collection(collection_name)
        log_info(f"Deleted collection: {collection_name}")


if __name__ == "__main__":
    # 从命令行参数获取前缀，如果没有提供则使用默认值
    prefix = sys.argv[1] if len(sys.argv) > 1 else "test_collection_"
    delete_all_postgres_collections(prefix)
