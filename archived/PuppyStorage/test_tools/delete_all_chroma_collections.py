import os
import sys
import chromadb
from chromadb.config import Settings

# 将项目根目录添加到Python模块搜索路径
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(script_dir)
sys.path.insert(0, project_root)

from utils.logger import log_info, log_error
from utils.config import config

# 获取本地存储路径
LOCAL_STORAGE_PATH = config.get("LOCAL_STORAGE_PATH", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "local_storage"))

def delete_all_chroma_collections(prefix="test_collectio"):
    """
    删除所有带有指定前缀的ChromaDB集合
    
    Args:
        prefix: 要删除的集合前缀，默认为"test_collection_"
    """
    # 设置持久化目录
    persist_directory = os.path.join(LOCAL_STORAGE_PATH, "chroma_db")
    
    # 确保目录存在
    if not os.path.exists(persist_directory):
        log_info(f"ChromaDB目录不存在: {persist_directory}")
        return
    
    # 初始化ChromaDB客户端
    client = chromadb.PersistentClient(
        path=persist_directory,
        settings=Settings(
            anonymized_telemetry=False,
            allow_reset=True
        )
    )
    
    # 获取所有集合
    collections = client.list_collections()
    
    # 过滤出前缀匹配的集合
    collections_to_delete = [c for c in collections if c.name.startswith(prefix)]
    
    log_info(f"Found {len(collections_to_delete)} ChromaDB collections with prefix '{prefix}' to delete (total collections: {len(collections)}).")
    
    # 删除每个集合
    for collection in collections_to_delete:
        collection_name = collection.name
        client.delete_collection(name=collection_name)
        log_info(f"Deleted ChromaDB collection: {collection_name}")


if __name__ == "__main__":
    # 从命令行参数获取前缀，如果没有提供则使用默认值
    prefix = sys.argv[1] if len(sys.argv) > 1 else "test_collection_"
    delete_all_chroma_collections(prefix) 