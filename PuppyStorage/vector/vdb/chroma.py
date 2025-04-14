import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import chromadb
from typing import List, Dict, Any
from chromadb.config import Settings

from vector.vdb.vdb_base import VectorDatabase
from utils.puppy_exception import PuppyException, global_exception_handler
from utils.logger import log_info, log_error, log_warning
from utils.config import config

LOCAL_STORAGE_PATH = config.get("LOCAL_STORAGE_PATH", os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "local_storage"))

class ChromaVectorDatabase(VectorDatabase):
    """
    ChromaDB Vector Database Client for local vector storage and retrieval.
    """
    
    _client = None
    
    def __init__(self):
        """Initialize the ChromaDB client"""
        if self.__class__._client is None:
            # 设置本地持久化目录
            persist_directory = os.path.join(LOCAL_STORAGE_PATH, "chroma_db")
            
            # 确保目录存在
            os.makedirs(persist_directory, exist_ok=True)
            
            # 初始化ChromaDB客户端
            self.__class__._client = chromadb.PersistentClient(
                path=persist_directory,
                settings=Settings(
                    anonymized_telemetry=False,
                    allow_reset=True
                )
            )
            
        self.client = self.__class__._client
        
    @global_exception_handler(2501, "Error Storing Vectors in ChromaDB")
    def store_vectors(
        self,
        vectors: List[List[float]],
        contents: List[str],
        metadata: List[Dict[str, Any]] = None,
        collection_name: str = None,
        **kwargs
    ) -> None:
        """
        在 ChromaDB 中存储向量
        
        Args:
            vectors: 要存储的向量列表
            contents: 与向量对应的内容列表
            metadata: 与向量对应的元数据列表
            collection_name: 集合名称，如果不提供则使用默认值
            **kwargs: 额外参数，可能包括：
                - ids: 自定义ID列表（如未提供则自动生成）
        """
        if not vectors or len(vectors) == 0:
            raise PuppyException(2501, "Vector list cannot be empty")
            
        # 获取额外参数
        custom_ids = kwargs.get("ids")
        
        # 获取或创建集合
        collection = self.client.get_or_create_collection(name=collection_name)
        
        # 准备元数据
        if metadata is None:
            metadata = [{"content": content} for content in contents]
        else:
            # 确保每个metadata都包含content字段
            for i, meta in enumerate(metadata):
                if isinstance(meta, dict):
                    meta["content"] = contents[i]
                else:
                    metadata[i] = {"content": contents[i]}
            
        # 生成唯一ID
        if custom_ids and len(custom_ids) == len(vectors):
            ids = custom_ids
        else:
            ids = [str(i) for i in range(len(vectors))]
        
        # 添加向量到集合
        collection.add(
            embeddings=vectors,
            documents=contents,
            metadatas=metadata,
            ids=ids
        )
        
        log_info(f"Stored {len(vectors)} vectors in ChromaDB collection '{collection_name}'")
        
    @global_exception_handler(2502, "Error Searching Vectors in ChromaDB")
    def search_vectors(
        self,
        collection_name: str,
        query_vector: List[float],
        top_k: int = 5,
        **kwargs
    ) -> List[Dict[str, Any]]:
        """
        在 ChromaDB 中搜索向量
        
        Args:
            collection_name: 要搜索的集合名称
            query_vector: 查询向量
            top_k: 返回结果数量
            **kwargs: 额外参数，支持：
                - threshold: 相似度阈值
                - filters: 元数据过滤条件
                - metric: 虽然传入但在ChromaDB中不使用
        
        Returns:
            搜索结果列表
        """
        try:
            collection = self.client.get_collection(name=collection_name)
        except Exception as e:
            log_warning(f"Collection '{collection_name}' not found: {str(e)}")
            return []
            
        # 获取参数
        threshold = kwargs.get("threshold")
        filters = kwargs.get("filters")
        
        # 准备查询参数
        query_params = {
            "query_embeddings": [query_vector],
            "n_results": top_k
        }
        
        # 只有在过滤器非空且有效时才添加where条件
        if filters and isinstance(filters, dict) and len(filters) > 0:
            query_params["where"] = filters
        
        # 执行搜索
        results = collection.query(**query_params)
        
        # 处理结果
        processed_results = []
        if results["distances"] and len(results["distances"]) > 0 and len(results["ids"]) > 0:
            for i in range(len(results["ids"][0])):
                score = results["distances"][0][i]
                
                # 如果设置了阈值，跳过低于阈值的结果
                if threshold and score > threshold:
                    continue
                    
                processed_results.append({
                    "id": results["ids"][0][i],
                    "content": results["documents"][0][i],
                    "metadata": results["metadatas"][0][i],
                    "score": score
                })
                
        return processed_results
            
    @global_exception_handler(2504, "Error Deleting ChromaDB Collection")
    def delete_collection(
        self,
        collection_name: str,
        **kwargs
    ) -> bool:
        """
        删除ChromaDB集合
        
        Args:
            collection_name: 要删除的集合名称
            **kwargs: 额外参数
        
        Returns:
            操作是否成功
        """
        try:
            self.client.delete_collection(name=collection_name)
            log_info(f"Deleted ChromaDB collection '{collection_name}'")
            return True
        except Exception as e:
            log_warning(f"Error deleting collection '{collection_name}': {str(e)}")
            return False

if __name__ == "__main__":
    import numpy as np
    import uuid
    # 生成随机向量和内容
    rng = np.random.default_rng(seed=42)
    vectors = rng.random((10, 512)).tolist()
    documents = [f"Document content {i}" for i in range(10)]
    query_vector = rng.random(512).tolist()
    
    # 生成带有短UUID后缀的集合名称
    collection_name = f"test_collection_{str(uuid.uuid4())[:8]}"
    print(f"使用集合名称: {collection_name}")

    # ChromaDB测试
    db = ChromaVectorDatabase()

    # 存储向量
    db.store_vectors(
        collection_name=collection_name,
        vectors=vectors,
        contents=documents,
        metadata=[{"content": content} for content in documents]
    )
    
    # 搜索向量
    chroma_results = db.search_vectors(
        collection_name=collection_name,
        query_vector=query_vector,
        top_k=5
    )
    print("ChromaDB搜索结果:", chroma_results)

    # 删除集合
    db.delete_collection(
        collection_name=collection_name
    ) 