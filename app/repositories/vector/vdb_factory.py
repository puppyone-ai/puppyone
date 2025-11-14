import os
from app.repositories.vector.vdb_base import VectorDatabase

class VectorDatabaseFactory:
    # Lazy import to avoid loading all vector DB dependencies at startup
    # This allows the service to start with minimal requirements (e.g., E2E tests)
    
    @classmethod
    def _lazy_import_db(cls, db_type: str):
        """Lazy import vector database implementations"""
        if db_type == "pgvector":
            from app.repositories.vector.vdb_pgv import PostgresVectorDatabase
            return PostgresVectorDatabase
        elif db_type == "chroma":
            from app.repositories.vector.vdb_chroma import ChromaVectorDatabase
            return ChromaVectorDatabase
        else:
            return None

    @classmethod
    def get_database(
        cls,
        db_type: str
    ) -> VectorDatabase:
        db_client_class = cls._lazy_import_db(db_type.lower())
        if db_client_class is None:
            raise ValueError(f"Unsupported Vector Database Type: {db_type}")
        return db_client_class()


if __name__ == "__main__":
    import os
    import sys
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from dotenv import load_dotenv
    import numpy as np

    # Load environment variables
    load_dotenv()

    # Generate random embeddings and IDs
    rng = np.random.default_rng(seed=42)
    embeddings = rng.random((10, 512)).tolist()
    documents = [f"Document content {i}" for i in range(10)]
    query_vector = rng.random(512).tolist()
    
    # Pgvector Test
    pgvector_db = VectorDatabaseFactory.get_database("pgvector")
    pgvector_db.store_vectors(
        collection_name="test_collection",
        vectors=embeddings,
        contents=documents,
    )
    pgvector_results = pgvector_db.search_vectors(
        collection_name="test_collection",
        query_vector=query_vector,
        top_k=5,
    )
    print("Pgvector Search Results:", pgvector_results)
    
    # ChromaDB Test
    chroma_db = VectorDatabaseFactory.get_database("chroma")
    chroma_db.store_vectors(
        collection_name="test_collection",
        vectors=embeddings,
        contents=documents,
    )
    chroma_results = chroma_db.search_vectors(
        collection_name="test_collection",
        query_vector=query_vector,
        top_k=5,
    )
    print("ChromaDB Search Results:", chroma_results)
