# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import uuid
import logging
from typing import List, Dict, Any
from weaviate.classes.config import DataType
from weaviate.classes.config import Property, DataType, Configure
from Scripts.vector_db_base import VectorDatabase
from Utils.PuppyEngineExceptions import global_exception_handler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class WeaviateVectorDatabase(VectorDatabase):
    def __init__(
        self,
        client_type: int
    ):
        super().__init__(client_type=client_type)
        self.connections = {}

    @global_exception_handler(2413, "Error Connecting to Weaviate Vector Database")
    def register_collection(
        self,
        collection_name: str
    ) -> None:
        """
        Connect to a collection in Weaviate.
        
        Args:
            collection_name (str): Name of the collection.
        """

        if collection_name not in self.connections:
            self.connections[collection_name] = self.weaviate_client
            logging.info(f"Connected to collection '{collection_name}' in Weaviate.")

    @global_exception_handler(2414, "Error Saving Embeddings to Weaviate Vector Database")
    def save_embeddings(
        self,
        collection_name: str,
        embeddings: List[List[float]],
        documents: List[str],
        create_new: bool = False,
        metadatas: List[Dict[str, Any]] = [{}]
    ) -> None:
        """
        Save embeddings to the specified collection in Weaviate.
        
        Args:
            collection_name (str): Name of the collection.
            embeddings (List[List[float]]): List of embeddings.
            documents (List[str]): List of documents.
            create_new (bool): Whether to create a new collection.
            metadatas (List[Dict[str, Any]]): Additional metadata to store with the embeddings.
        """

        client = self.connections.get(collection_name)
        if not client:
            raise ValueError(f"Not connected to collection '{collection_name}'.")

        if create_new:
            client.collections.create(
                name=collection_name,
                properties=[
                    Property(name="vector_id", data_type=DataType.TEXT),
                    Property(name="embedding", data_type=DataType.NUMBER_ARRAY),
                    Property(name="metadata", data_type=DataType.OBJECT)
                ],
                vectorizer_config=[
                    Configure.NamedVectors.none(name="vector_id"),
                    Configure.NamedVectors.none(name="embedding")
                ],
            )
            logging.info(f"Created new collection '{collection_name}' with specified schema.")

        ids = [metadata.get("id") for metadata in metadatas]
        if not ids:
            ids = [str(uuid.uuid4()) for _ in embeddings]

        questions = client.collections.get(collection_name)
        with questions.batch.dynamic() as batch:
            for i in range(len(embeddings)):
                batch.add_object(
                    {
                        "vector_id": ids[i],
                        "embedding": embeddings[i],
                        "metadata":{"document": documents[i], **metadatas[i]}
                    },
                    vector={"embedding": embeddings[i]}
                )
        logging.info(f"Inserted {len(embeddings)} embeddings into collection '{collection_name}'.")

    @global_exception_handler(2415, "Error Searching Embeddings in Weaviate Vector Database")
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
            filter (str): Filter string.
            include_metadata (bool): Whether to include metadata in the results.
        
        Returns:
            List[Dict[str, Any]]: List of search results.
        """

        client = self.connections.get(collection_name)
        if not client:
            raise ValueError(f"Not connected to collection '{collection_name}'.")
        
        collection = client.collections.get(collection_name)
        limit = top_k
        filters = kwargs.get("filter")
        include_metadata = kwargs.get("include_metadata", True)
        response = collection.query.near_vector(
            near_vector=query_embedding,
            limit=limit,
            filters=filters,
            return_metadata=include_metadata,
            target_vector="embedding"
        )

        results = [{
            "id": obj.id,
            "document": obj.properties.get("document"),
            "score": obj.metadata.get("distance")
        } for obj in response.objects]
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

    # Weaviate Test
    weaviate_db = WeaviateVectorDatabase(client_type=0)
    weaviate_db.register_collection("weaviate_test_collection")
    weaviate_db.save_embeddings(
        collection_name="weaviate_test_collection",
        embeddings=embeddings,
        documents=documents,
        create_new=True,
    )
    weaviate_results = weaviate_db.search_embeddings(
        collection_name="weaviate_test_collection",
        query_embedding=query_vector,
        top_k=5,
    )
    print("Weaviate Search Results:", weaviate_results)
