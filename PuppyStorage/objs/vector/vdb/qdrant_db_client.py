# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import uuid
import logging
from typing import List, Dict, Any
from qdrant_client.http.models import VectorParams, Distance
from qdrant_client.models import Filter, FieldCondition, MatchValue
from Scripts.vector_db_base import VectorDatabase
from Utils.PuppyEngineExceptions import global_exception_handler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class QdrantVectorDatabase(VectorDatabase):
    def __init__(
        self,
        client_type: int
    ):
        super().__init__(client_type=client_type)
        self.connections = {}

    @global_exception_handler(2407, "Error Connecting to Qdrant Vector Database")
    def register_collection(
        self,
        collection_name: str
    ) -> None:
        """
        Connect to a collection in Qdrant.
        
        Args:
            collection_name (str): Name of the collection.
        """

        if collection_name not in self.connections:
            self.connections[collection_name] = self.qdrant_client
            logging.info(f"Connected to collection '{collection_name}' in Qdrant.")

    @global_exception_handler(2408, "Error Saving Embeddings to Qdrant Vector Database")
    def save_embeddings(
        self,
        collection_name: str,
        embeddings: List[List[float]],
        documents: List[str],
        create_new: bool = False,
        metric: str = "cosine",
        metadatas: List[Dict[str, Any]] = [{}]
    ) -> None:
        """
        Save embeddings to the specified collection in Qdrant.
        
        Args:
            collection_name (str): Name of the collection.
            embeddings (List[List[float]]): List of embeddings.
            documents (List[str]): List of documents.
            create_new (bool): Whether to create a new collection.
            metric (str): Similarity metric (default: "cosine").
            metadatas (List[Dict[str, Any]]): Additional metadata to store with the embeddings.
        """

        client = self.connections.get(collection_name)
        if not client:
            raise ValueError(f"Not connected to collection '{collection_name}'.")

        if create_new:
            metric_dict = {
                "cosine": Distance.COSINE,
                "euclidean": Distance.EUCLID,
                "manhattan": Distance.MANHATTAN,
                "dot": Distance.DOT
            }
            metric = metric.lower()
            client.create_collection(
                    collection_name=collection_name,
                    vectors_config=VectorParams(size=len(embeddings[0]), distance=metric_dict.get(metric)),
            )
            logging.info(f"Created new collection '{collection_name}' with specified configuration.")

        ids = [metadata.get("id") for metadata in metadatas]
        if not ids:
            ids = [str(uuid.uuid4()) for _ in embeddings]

        points = [
            {
                "id": ids[i],
                "vector": embeddings[i],
                "payload": {"document": documents[i], **metadatas[i]}
            }
            for i in range(len(embeddings))
        ]
        client.upsert(collection_name=collection_name, points=points)
        logging.info(f"Inserted {len(embeddings)} embeddings into collection '{collection_name}'.")

    @global_exception_handler(2409, "Error Searching Embeddings in Qdrant Vector Database")
    def search_embeddings(
        self,
        collection_name: str,
        query_embedding: List[float],
        top_k: int,
        **kwargs
    ) -> List[Dict[str, Any]]:
        """
        Search for nearest embeddings in the collection.

        Args:

            collection_name (str): Name of the collection.
            query_embedding (List[float]): Query embedding.
            top_k (int): Number of nearest results to return.
            filter_tag (str): Tag to filter by.
            filter_str (str): Filter string.
            with_payload (bool): Whether to include payload in the results.
 
        Returns:
            List[Dict[str, Any]]: List of search results.
        """

        client = self.connections.get(collection_name)
        if not client:
            raise ValueError(f"Not connected to collection '{collection_name}'.")

        filter_tag, filter_str = kwargs.get("filter_tag"), kwargs.get("filter_str")
        with_payload = kwargs.get("with_payload", True)
        response = client.search(
            collection_name=collection_name,
            query_vector=query_embedding,
            query_filter=(
                Filter(
                    must=[
                        FieldCondition(
                            key=filter_tag, match=MatchValue(value=filter_str)
                        )
                    ]
                )
                if filter_tag and filter_str
                else None
            ),
            with_payload=with_payload,
            limit=top_k,
        )

        results = [{
            "id": result.id,
            "document": result.payload.get("document"),
            "score": result.score
            } for result in response
        ]
        return results


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

    # Qdrant Test
    qdrant_db = QdrantVectorDatabase(client_type=0)
    qdrant_db.register_collection("qdrant_test_collection")
    qdrant_db.save_embeddings(
        collection_name="qdrant_test_collection",
        embeddings=embeddings,
        documents=documents,
        create_new=True,
    )
    qdrant_results = qdrant_db.search_embeddings(
        collection_name="qdrant_test_collection",
        query_embedding=query_vector,
        top_k=5,
    )
    print("Qdrant Search Results:", qdrant_results)
