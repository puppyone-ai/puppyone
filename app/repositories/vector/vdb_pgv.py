"""
pgvector的实现
"""
from app.repositories.vector.vdb_base import VectorDatabase
from typing import List, Dict, Any

class PostgresVectorDatabase(VectorDatabase):
    """
    pgvector的实现
    """

    def __init__(self):
        pass

    def store_vectors(self, vectors: List[List[float]], contents: List[str], metadata: List[Dict[str, Any]] = None, collection_name: str = None, **kwargs) -> None:
        """
        """
        pass

    def search_vectors(self, collection_name: str, query_vector: List[float], top_k: int = 5, **kwargs) -> List[Dict[str, Any]]:
        """
        """
        pass