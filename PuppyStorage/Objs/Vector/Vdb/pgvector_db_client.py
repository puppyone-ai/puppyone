import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

import uuid
import logging
from typing import List, Dict, Any

import vecs

from Objs.Vector.Vdb.vector_db_base import VectorDatabase
from Utils.PuppyEngineExceptions import global_exception_handler
from Utils.config import config


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
            "l2": "l2_distance",
            "inner_product": "inner_product"
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
            logging.warning(f"不支持的度量方式: {metric}")
            return False
            
        try:
            # 尝试创建索引 - 如果已存在会抛出异常
            collection.create_index(measure=measure)
            logging.info(f"已创建 {metric} 索引")
            return True
        except Exception as e:
            # 检查异常是否表明索引已存在
            if "already exists" in str(e).lower():
                logging.debug(f"{metric} 索引已存在")
                return True
            # 其他异常表示创建失败
            logging.warning(f"{metric} 索引创建失败: {str(e)}")
            return False

    @global_exception_handler(2401, "Error Saving Embeddings to Postgres Vector Database")
    def store_vectors(
        self,
        vectors: List[List[float]],
        contents: List[str],
        metadata: List[Dict[str, Any]] = None,
        collection_id: str = None,
        default_metric: str = "cosine"
    ) -> str:
        """
        Store vectors in PGVector database
        
        Args:
            vectors: List of vectors
            contents: List of contents
            metadata: List of metadata
            collection_id: Collection ID (optional, if not provided a new ID will be generated)
            default_metric: Default metric to create index for (default: "cosine")
            
        Returns:
            str: Collection ID
        """
        # 1. Prepare collection ID
        if not collection_id:
            collection_id = f"collection_{uuid.uuid4().hex}"
            
        # 2. Prepare record structure
        if metadata is None:
            metadata = [{} for _ in range(len(vectors))]
            
        records = [
            (str(uuid.uuid4()), vec, {"content": content, **meta})
            for vec, content, meta in zip(vectors, contents, metadata)
        ]
        
        # 3. Get or create collection
        collection = self.client.get_or_create_collection(
            name=collection_id, 
            dimension=len(vectors[0])
        )
        
        # 4. Insert records
        collection.upsert(records=records)
        logging.info(f"Inserted {len(records)} vectors into collection '{collection_id}'")
        
        # 5. Create default index
        if default_metric:
            self._ensure_index(collection, default_metric)
            
        return collection_id

    def retrieve_vectors(
        self,
        collection_id: str,
        ids: List[str]
    ) -> List[Dict[str, Any]]:
        """
        Retrieve vectors from PGVector database
        """

        collection = self.client.get_or_create_collection(name=collection_id)
        records = collection.get(ids=ids)
        return records

    @global_exception_handler(2402, "Error Searching in Postgres Vector Database")
    def search_vectors(
        self,
        collection_id: str,
        query_vector: List[float],
        top_k: int = 5,
        threshold: float = None,
        filters: Dict[str, Any] = None,
        metric: str = "cosine"
    ) -> List[Dict[str, Any]]:
        """
        Search in vector database
        
        Args:
            collection_id: Collection ID
            query_vector: Query vector
            top_k: Number of results to return
            threshold: Similarity threshold
            filters: Metadata filters
            metric: Similarity measure method
            
        Returns:
            List[Dict]: List of search results
        """
        # 1. Get collection
        try:
            collection = self.client.get_or_create_collection(name=collection_id)
        except Exception:
            logging.warning(f"Collection '{collection_id}' does not exist, attempting to create")
            return []
            
        # 2. Ensure index exists for the requested metric
        self._ensure_index(collection, metric)
            
        # 3. Execute query
        measure = self._metric_value.get(metric, "cosine_distance")
        records = collection.query(
            data=query_vector,
            limit=top_k,
            filters={},
            measure=measure,
            include_value=True,
            include_metadata=True,
        )
        
        # 4. Process results
        results = []
        for record in records:
            # Record structure: (id, similarity_score, metadata)
            score = record[1]
            # Skip if there's a threshold and score is below threshold
            if threshold and (
                (measure.endswith("distance") and score > threshold) or
                (measure == "inner_product" and score < threshold)
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

    @global_exception_handler(2403, "Error Cleaning Postgres Vector Database")
    def clean_vectors(
        self,
        collection_id: str
    ) -> None:
        """
        Delete specified collection. If collection does not exist,
        log a warning and continue without error.
        """
        try:
            self.client.delete_collection(collection_id)
            logging.info(f"Deleted collection: {collection_id}")
        except Exception as e:
            # Check if the error is because collection doesn't exist
            if "does not exist" in str(e).lower() or "not found" in str(e).lower():
                logging.warning(f"Collection '{collection_id}' does not exist, nothing to delete")
            else:
                # For other errors, log and raise
                logging.error(f"Failed to delete collection '{collection_id}': {str(e)}")
                raise


if __name__ == "__main__":

    import numpy as np
    # Generate random embeddings and IDs
    rng = np.random.default_rng(seed=42)
    vectors = rng.random((10, 512)).tolist()
    documents = [f"Document content {i}" for i in range(10)]
    query_vector = rng.random(512).tolist()

    # Pgvector Test
    pgvector_db = PostgresVectorDatabase()

    pgvector_db.clean_vectors(
        collection_id="test_collection"
    )

    pgvector_db.store_vectors(
        collection_id="test_collection",
        vectors=vectors,
        contents=documents,
        metadata=[{"content": content} for content in documents]
    )
    
    # 测试不同度量方式的搜索
    metrics = ["cosine", "l2", "inner_product"]
    for metric in metrics:
        print(f"\n使用 {metric} 度量方式搜索:")
        pgvector_results = pgvector_db.search_vectors(
            collection_id="test_collection",
            query_vector=query_vector,
            top_k=5,
            metric=metric
        )
        print(f"{metric} 搜索结果:", pgvector_results)
