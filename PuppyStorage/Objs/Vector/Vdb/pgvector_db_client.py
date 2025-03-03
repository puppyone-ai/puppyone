# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid
import logging
from typing import List, Dict, Any

import vecs

from Objs.Vector.Vdb.vector_db_base import VectorDatabase
from Utils.PuppyEngineExceptions import global_exception_handler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class PostgresVectorDatabase(VectorDatabase):

    def __init__(
        self
    ):
        """
        Initialize the PostgresVectorDatabase client.
        """
        if self.__class__._client is None:  # 只有首次实例化时才会创建连接
            self.__class__._client = vecs.create_client(os.environ.get("SUPABASE_URL"))

        self.client = self.__class__._client

    @global_exception_handler(2400, "Error Connecting to Postgres Vector Database")
    def register_collection(
        self,
        collection_name: str
    ) -> None:
        """
        Connect to a Postgres-based vector database collection.

        Args:
            collection_name (str): Name of the collection to connect to.
        """

        if collection_name not in self.collections:
            self.collections[collection_name] = self.client.get_or_create_collection(name=collection_name, dimension=len(embeddings[0]))
            logging.info(f"Connected to collection '{collection_name}' in Pgvector.")

    @global_exception_handler(2401, "Error Saving Embeddings to Postgres Vector Database")
    def store_vectors(
        self,
        collection_name: str,
        embeddings: List[List[float]],
        documents: List[str],
        create_new: bool = False,
        metric: str = "cosine",
        metadatas: List[Dict[str, Any]] = [{}]
    ) -> None:
        """
        Save embeddings to the Postgres-based vector database.

        Args:
            collection_name (str): Name of the collection.
            embeddings (List[List[float]]): List of embeddings.
            documents (List[str]): List of associated documents.
            create_new (bool): Whether to create a new collection (if it doesn't exist).
            metric (str): Similarity metric to use for the collection (default: "cosine").
            metadatas (List[Dict[str, Any]]): Additional metadata to store with the embeddings.
        """

        client = self.collections.get(collection_name)
        if not client:
            raise ValueError(f"Not connected to collection '{collection_name}'.")

        collection = client.get_or_create_collection(name=collection_name, dimension=len(embeddings[0]))
        if create_new:
            logging.info(f"Created new collection: {collection_name}")

        metric_value = {
            "cosine": "cosine_distance",
            "l1": "l1_distance",
            "l2": "l2_distance",
            "inner_product": "inner_product"
        }
        collection.create_index(measure=metric_value.get(metric, "cosine_distance"))

        ids = [metadata.get("id") for metadata in metadatas]
        if not ids:
            ids = [str(uuid.uuid4()) for _ in embeddings]

        records = [
            (ids[i], embeddings[i], {"doc": documents[i], **metadatas[i]}) for i in range(len(embeddings))
        ]
        collection.upsert(records=records)
        logging.info(f"Inserted {len(records)} embeddings into collection '{collection_name}'.")

    @global_exception_handler(2402, "Error Searching in Postgres Vector Database")
    def retrive_vectors(
        self,
        collection_name: str,
        query_embedding: List[float],
        top_k: int,
        **kwargs,
    ) -> List[Dict[str, Any]]:
        """
        Search for embeddings in the Postgres-based vector database.

        Args:
            collection_name (str): Name of the collection to search.
            query_embedding (List[float]): Query embedding vector.
            top_k (int): Number of nearest neighbors to return.

        Returns:
            List[Dict[str, Any]]: List of results, including IDs, documents, and scores.
        """

        client = self.collections.get(collection_name)
        if not client:
            raise ValueError(f"Not connected to collection '{collection_name}'.")

        collection = client.get_or_create_collection(name=collection_name, dimension=len(query_embedding))
        response = collection.query(
            data=query_embedding,
            limit=top_k,
            filters={},
            measure="cosine_distance",
            include_value=True,
            include_metadata=True,
        )

        results = [
            {
                "id": record[0],
                "document": record[2].get("doc"),
                "score": record[1],
            } for record in response
        ]
        return results

    @global_exception_handler(2403, "Error Deleting Collection in Postgres Vector Database")
    def delete_index(
        self,
        collection_name: str
    ) -> None:
        """
        Delete a collection (index) from the Postgres-based vector database.

        Args:
            collection_name (str): Name of the collection to delete.
        """

        client = self.collections.get(collection_name)
        if not client:
            raise ValueError(f"Not connected to collection '{collection_name}'.")

        client.delete_collection(collection_name)
        logging.info(f"Deleted collection: {collection_name}")


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
    pgvector_db = PostgresVectorDatabase()
    pgvector_db.register_collection("test_collection")
    pgvector_db.store_vectors(
        collection_name="test_collection",
        embeddings=embeddings,
        documents=documents,
        create_new=True,
    )
    pgvector_results = pgvector_db.retrive_vectors(
        collection_name="test_collection",
        query_embedding=query_vector,
        top_k=5,
    )
    print("Pgvector Search Results:", pgvector_results)
