# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import logging
from Objs.Vector.Vdb.vector_db_base import VectorDatabase
# from Objs.Vector.Vdb.zilliz_db_client import ZillizVectorDatabase
# from Objs.Vector.Vdb.qdrant_db_client import QdrantVectorDatabase
# from Objs.Vector.Vdb.pinecone_db_client import PineconeVectorDatabase
# from Objs.Vector.Vdb.weaviate_db_client import WeaviateVectorDatabase
from Objs.Vector.Vdb.pgvector_db_client import PostgresVectorDatabase

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class VectorDatabaseFactory:
    _db_mapping = {
        # "zilliz": ZillizVectorDatabase,  # wrenching
        # "qdrant": QdrantVectorDatabase,  # wrenching
        # "pinecone": PineconeVectorDatabase,  # wrenching
        # "weaviate": WeaviateVectorDatabase,  # wrenching
        "pgvector": PostgresVectorDatabase  # live
    }

    @classmethod
    def get_database(
        cls,
        db_type: str
    ) -> VectorDatabase:
        db_client = cls._db_mapping.get(db_type.lower())
        if db_client is None:
            raise ValueError(f"Unsupported Vector Database Type: {db_type}")
        return db_client()


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

    # # Zilliz Test
    # zilliz_db = VectorDatabaseFactory.get_database("zilliz")
    # zilliz_db.register_collection("zilliz_test_collection")
    # zilliz_db.save_embeddings(
    #     collection_name="zilliz_test_collection",
    #     embeddings=embeddings,
    #     documents=documents,
    #     create_new=True,
    # )
    # zilliz_results = zilliz_db.search_embeddings(
    #     collection_name="zilliz_test_collection",
    #     query_embedding=query_vector,
    #     top_k=5,
    # )
    # print("Zilliz Search Results:", zilliz_results)

    # # Qdrant Test
    # qdrant_db = VectorDatabaseFactory.get_database("qdrant")
    # qdrant_db.register_collection("qdrant_test_collection")
    # qdrant_db.save_embeddings(
    #     collection_name="qdrant_test_collection",
    #     embeddings=embeddings,
    #     documents=documents,
    #     create_new=True,
    # )
    # qdrant_results = qdrant_db.search_embeddings(
    #     collection_name="qdrant_test_collection",
    #     query_embedding=query_vector,
    #     top_k=5,
    # )
    # print("Qdrant Search Results:", qdrant_results)

    # # Pinecone Test
    # pinecone_db = VectorDatabaseFactory.get_database("pinecone")
    # pinecone_db.register_collection("pinecone_test_collection")
    # pinecone_db.save_embeddings(
    #     collection_name="pinecone_test_collection",
    #     embeddings=embeddings,
    #     documents=documents,
    #     create_new=True,
    # )
    # pinecone_results = pinecone_db.search_embeddings(
    #     collection_name="pinecone_test_collection",
    #     query_embedding=query_vector,
    #     top_k=5,
    # )
    # print("Pinecone Search Results:", pinecone_results)

    # # Weaviate Test
    # weaviate_db = VectorDatabaseFactory.get_database("weaviate")
    # weaviate_db.register_collection("weaviate_test_collection")
    # weaviate_db.save_embeddings(
    #     collection_name="weaviate_test_collection",
    #     embeddings=embeddings,
    #     documents=documents,
    #     create_new=True,
    # )
    # weaviate_results = weaviate_db.search_embeddings(
    #     collection_name="weaviate_test_collection",
    #     query_embedding=query_vector,
    #     top_k=5,
    # )
    # print("Weaviate Search Results:", weaviate_results)
    
    # Pgvector Test
    pgvector_db = VectorDatabaseFactory.get_database("pgvector")
    pgvector_db.register_collection("test_collection")
    pgvector_db.save_embeddings(
        collection_name="test_collection",
        embeddings=embeddings,
        documents=documents,
        create_new=True,
    )
    pgvector_results = pgvector_db.search_embeddings(
        collection_name="test_collection",
        query_embedding=query_vector,
        top_k=5,
    )
    print("Pgvector Search Results:", pgvector_results)
