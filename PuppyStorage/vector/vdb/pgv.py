import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import uuid
from typing import List, Dict, Any

import vecs

from vector.vdb.vdb_base import VectorDatabase
from utils.puppy_exception import PuppyException, global_exception_handler
from utils.config import config
from utils.logger import log_info, log_error, log_warning


class PostgresVectorDatabase(VectorDatabase):
    """
    PostgreSQL Vector Database Client for vector storage and retrieval.
    
    Design principles:
    1. Lazy Loading: The database client is initialized only once and shared across instances
       to optimize connection pool usage.
    2. On-demand Index Creation: Indices are created only when needed during search operations,
       avoiding unnecessary resource usage while ensuring optimal query performance.
    3. Resilient Index Management: The system attempts to create indices when required and
       gracefully handles cases where indices already exist, making it resilient to service
       restarts.
    4. Flexible Metric Support: Supports multiple distance metrics (cosine, l1, l2, inner_product)
       that can be specified during search operations.
    
    This implementation balances storage efficiency with query performance by creating
    indices only for metrics that are actually used in searches.
    """
    
    # Class variable to ensure shared connection pool
    _client = None

    def __init__(self):
        """Initialize the PostgresVectorDatabase client"""
        if self.__class__._client is None:
            # Add configuration check
            if not config.get("SUPABASE_URL"):
                raise ValueError("SUPABASE_URL not configured")
            self.__class__._client = vecs.create_client(config.get("SUPABASE_URL"))
        
        self.client = self.__class__._client
        self._metric_value = {
            "cosine": "cosine_distance",
            "l1": "l1_distance",
            "l2": "l2_distance"
            # inner_product 不被 vecs 库支持
        }
        
    def _ensure_index(self, collection, metric):
        """
        确保指定的索引存在
        
        Args:
            collection: 集合对象
            metric: 度量方式 (cosine, l1, l2, inner_product)
            
        Returns:
            bool: 索引是否可用
        """
        # 检查度量方式是否支持
        measure = self._metric_value.get(metric)
        if not measure:
            log_warning(f"不支持的度量方式: {metric}")
            return False
            
        try:
            # 尝试创建索引 - 如果已存在会抛出异常
            collection.create_index(measure=measure)
            log_info(f"已创建 {metric} 索引")
            return True
        except PuppyException as e:
            # 检查异常是否表明索引已存在
            if "already exists" in str(e).lower():
                log_info(f"{metric} 索引已存在")
                return True
            # 其他异常表示创建失败
            log_warning(f"{metric} 索引创建失败: {str(e)}")
            return False

    @global_exception_handler(2401, "Error Saving Embeddings to Postgres Vector Database")
    def store_vectors(
        self,
        vectors: List[List[float]],
        contents: List[str],
        metadata: List[Dict[str, Any]] = None,
        collection_name: str = None,
        default_metric: str = "cosine"
    ) -> str:
        """
        Store vectors in PGVector database
        
        Args:
            vectors: List of vectors
            contents: List of contents
            metadata: List of metadata
            collection_name: Collection Name (optional, if not provided a new ID will be generated)
            default_metric: Default metric to create index for (default: "cosine")
            
        Returns:
            str: Collection ID
        """
        # Validate input
        if not vectors or len(vectors) == 0:
            raise PuppyException(2401, "Vector list cannot be empty during store vectors into PGVector")
        
        vector_dimension = len(vectors[0])
        
        # Validate all vectors have consistent dimensions
        for i, vec in enumerate(vectors):
            if len(vec) != vector_dimension:
                raise PuppyException(2401, "Vector dimension inconsistency", f"Vector {i} has dimension ({len(vec)}) inconsistent with the first vector's dimension ({vector_dimension})")
            
        # 2. Prepare record structure
        if metadata is None:
            metadata = [{} for _ in range(len(vectors))]
            
        records = [
            (str(uuid.uuid4()), vec, {"content": content, **meta})
            for vec, content, meta in zip(vectors, contents, metadata)
        ]
        
        # 3. Get or create collection
        collection = self.client.get_or_create_collection(
            name=collection_name, 
            dimension=vector_dimension
        )
        
        # 4. Insert records
        # Note: If collection dimension doesn't match vector dimension, this will fail
        # The vecs library will throw an exception which our global exception handler will catch
        collection.upsert(records=records)
        log_info(f"Inserted {len(records)} vectors into collection '{collection_name}'")
        
        # 5. Create default index
        if default_metric:
            self._ensure_index(collection, default_metric)

    @global_exception_handler(2402, "Error Searching in Postgres Vector Database")
    def search_vectors(
        self,
        collection_name: str,
        query_vector: List[float],
        top_k: int,
        **kwargs
    ) -> List[Dict[str, Any]]:
        """
        在向量数据库中搜索
        
        Args:
            collection_name: 集合名称
            query_vector: 查询向量
            top_k: 返回结果数量
            **kwargs: 额外参数，支持：
                - threshold: 相似度阈值
                - filters: 元数据过滤条件
                - metric: 相似度计算方法 (cosine, l1, l2, inner_product)
                
        Returns:
            搜索结果列表
        """
        # 获取参数
        threshold = kwargs.get("threshold")
        filters = kwargs.get("filters")
        metric = kwargs.get("metric", "cosine")
        
        # 1. Get collection
        try:   
            collection = self.client.get_or_create_collection(
                name=collection_name,
                dimension=len(query_vector)
            )
            
        except PuppyException as e:
            log_warning(f"Error getting collection '{collection_name}': {str(e)}")
            return []
        
        # 2. Ensure index exists
        self._ensure_index(collection, metric)
        
        # 3. Execute query
        measure = self._metric_value.get(metric, "cosine_distance")
        
        # 准备查询参数
        query_params = {
            "data": query_vector,
            "limit": top_k,
            "measure": measure,
            "include_value": True,
            "include_metadata": True,
        }
        
        # 只有在过滤器非空且有效时才添加filters条件
        if filters and isinstance(filters, dict) and len(filters) > 0:
            query_params["filters"] = filters
        
        try:
            records = collection.query(**query_params)
        except PuppyException as e:
            # Check if error is related to dimension mismatch
            if "dimension" in str(e).lower():
                log_warning(f"Dimension mismatch: Query vector dimension ({len(query_vector)}) does not match collection dimension")
            else:
                log_warning(f"Error querying collection '{collection_name}': {str(e)}")
            return []
        
        # 4. Process results
        results = []
        for record in records:
            # Record structure: (id, similarity_score, metadata)
            score = record[1]
            # Skip if there's a threshold and score is below threshold
            if threshold and (
                (measure.endswith("distance") and score > threshold)
            ):
                continue
            
            # Separate content and other metadata
            metadata = record[2] or {}
            content = metadata.pop("content", "")
            
            results.append({
                "id": record[0],
                "content": content,
                "metadata": metadata,
                "score": score,
            })
        
        return results

    @global_exception_handler(2404, "Error Deleting Postgres Vector Database")
    def delete_collection(
        self,
        collection_name: str,
        **kwargs
    ) -> bool:
        """
        删除指定集合

        Args:
            collection_name: 集合名称
            **kwargs: 额外参数
            
        Returns:
            操作是否成功
        """
        try:
            self.client.delete_collection(collection_name)
            log_info(f"Deleted collection: {collection_name}")
            return True
        except PuppyException as e:
            # Check if the error is because collection doesn't exist
            if "provide a dimension" in str(e).lower():
                log_warning(f"Collection '{collection_name}' does not exist, nothing to delete")
                return True
            else:
                # For other errors, log and raise
                log_error(f"Failed to delete collection '{collection_name}': {str(e)}")
                return False

if __name__ == "__main__":

    import numpy as np
    # Generate random embeddings and IDs
    rng = np.random.default_rng(seed=42)
    vectors = rng.random((10, 512)).tolist()
    documents = [f"Document content {i}" for i in range(10)]
    query_vector = rng.random(512).tolist()
    
    # 生成带有短UUID后缀的集合名称
    collection_name = f"test_collection_{str(uuid.uuid4())[:8]}"
    print(f"使用集合名称: {collection_name}")

    # Pgvector Test
    db = PostgresVectorDatabase()

    db.store_vectors(
        collection_name=collection_name,
        vectors=vectors,
        contents=documents,
        metadata=[{"content": content} for content in documents]
    )
    
    # 测试不同度量方式的搜索
    # 注意：移除了inner_product，因为vecs库不支持此度量方式
    metrics = ["cosine", "l1", "l2"]
    for metric in metrics:
        print(f"\n使用 {metric} 度量方式搜索:")
        pgvector_results = db.search_vectors(
            collection_name=collection_name,
            query_vector=query_vector,
            top_k=5,
            metric=metric
        )
        print(f"{metric} 搜索结果:", pgvector_results)

    db.delete_collection(
        collection_name=collection_name
    )

    print(db.client.list_collections())
