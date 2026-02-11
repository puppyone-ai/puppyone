import os
import sys

# 将项目根目录添加到Python模块搜索路径
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(script_dir)
sys.path.insert(0, project_root)

from utils.logger import log_info
from delete_all_postgres_collections import delete_all_postgres_collections
from delete_all_chroma_collections import delete_all_chroma_collections

def clean_test_collections(prefix="test_collection_"):
    """
    同时清理PostgreSQL和ChromaDB中带有指定前缀的测试集合
    
    Args:
        prefix: 要删除的集合前缀，默认为"test_collection_"
    """
    log_info(f"开始清理带有前缀 '{prefix}' 的测试集合...")
    
    # 清理PostgreSQL集合
    try:
        delete_all_postgres_collections(prefix)
    except Exception as e:
        log_info(f"清理PostgreSQL集合时出错: {str(e)}")
    
    # 清理ChromaDB集合
    try:
        delete_all_chroma_collections(prefix)
    except Exception as e:
        log_info(f"清理ChromaDB集合时出错: {str(e)}")
    
    log_info("测试集合清理完成")

if __name__ == "__main__":
    # 从命令行参数获取前缀，如果没有提供则使用默认值
    prefix = sys.argv[1] if len(sys.argv) > 1 else "test_collection_"
    clean_test_collections(prefix) 