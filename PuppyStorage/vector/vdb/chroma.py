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
    ) -> None:
        """
        Store vectors in ChromaDB
        
        Args:
            vectors: List of vectors to store
            contents: List of contents corresponding to vectors
            metadata: List of metadata for each vector
            collection_name: Name of the collection to store vectors in
        """
        if not vectors or len(vectors) == 0:
            raise PuppyException(2501, "Vector list cannot be empty")
            
        # 获取或创建集合
        collection = self.client.get_or_create_collection(name=collection_name)
        
        # 准备元数据
        if metadata is None:
            metadata = [{"content": content} for content in contents]
        else:
            # 确保每个metadata都包含content字段
            for i, meta in enumerate(metadata):
                meta["content"] = contents[i]
                
        # 生成唯一ID
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
        threshold: float = None,
        filters: Dict[str, Any] = None,
    ) -> List[Dict[str, Any]]:
        """
        Search vectors in ChromaDB
        
        Args:
            collection_name: Name of the collection to search in
            query_vector: Query vector
            top_k: Number of results to return
            threshold: Similarity threshold
            filters: Metadata filters
            
        Returns:
            List of search results
        """
        try:
            collection = self.client.get_collection(name=collection_name)
        except Exception as e:
            log_warning(f"Collection '{collection_name}' not found: {str(e)}")
            return []
            
        # 执行搜索
        results = collection.query(
            query_embeddings=[query_vector],
            n_results=top_k,
            where=filters
        )
        
        # 处理结果
        processed_results = []
        if results["distances"] and results["documents"]:
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
        
    @global_exception_handler(2503, "Error Deleting Vectors from ChromaDB")
    def delete_vectors(
        self,
        collection_name: str,
        ids: List[str] = None
    ) -> None:
        """
        Delete vectors from ChromaDB
        
        Args:
            collection_name: Collection name
            ids: List of vector IDs to delete
        """
        try:
            collection = self.client.get_collection(name=collection_name)
            if ids:
                collection.delete(ids=ids)
            else:
                collection.delete()
            log_info(f"Deleted vectors from ChromaDB collection '{collection_name}'")
        except Exception as e:
            log_warning(f"Error deleting vectors from collection '{collection_name}': {str(e)}")
            
    @global_exception_handler(2504, "Error Deleting ChromaDB Collection")
    def delete_collection(
        self,
        collection_name: str
    ) -> None:
        """
        Delete a ChromaDB collection
        
        Args:
            collection_name: Name of the collection to delete
        """
        try:
            self.client.delete_collection(name=collection_name)
            log_info(f"Deleted ChromaDB collection '{collection_name}'")
        except Exception as e:
            log_warning(f"Error deleting collection '{collection_name}': {str(e)}")

if __name__ == "__main__":
    import numpy as np
    # 生成随机向量和内容
    rng = np.random.default_rng(seed=42)
    vectors = rng.random((10, 512)).tolist()
    documents = [f"Document content {i}" for i in range(10)]
    query_vector = rng.random(512).tolist()

    # ChromaDB测试
    db = ChromaVectorDatabase()

    # 存储向量
    db.store_vectors(
        collection_name="test_collection",
        vectors=vectors,
        contents=documents,
        metadata=[{"content": content} for content in documents]
    )
    
    # 搜索向量
    chroma_results = db.search_vectors(
        collection_name="test_collection",
        query_vector=query_vector,
        top_k=5
    )
    print("ChromaDB搜索结果:", chroma_results)

    # 删除向量
    db.delete_vectors(
        collection_name="test_collection"
    )

    # 删除集合
    db.delete_collection(
        collection_name="test_collection"
    ) 