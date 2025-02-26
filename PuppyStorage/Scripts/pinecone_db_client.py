# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import uuid
import logging
from typing import List, Dict, Any
from pinecone import ServerlessSpec
from Scripts.vector_db_base import VectorDatabase
from Utils.PuppyEngineExceptions import global_exception_handler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class PineconeVectorDatabase(VectorDatabase):
    def __init__(
        self,
        client_type: int
    ):
        super().__init__(client_type=client_type)
        self.connections = {}

    @global_exception_handler(2410, "Error Connecting to Pinecone Vector Database")
    def connect(
        self,
        collection_name: str
    ) -> None:
        """
        Connect to a collection in Pinecone.
        
        Args:
            collection_name (str): Name of the collection.
        """

        if collection_name not in self.connections:
            self.connections[collection_name] = self.pinecone_client
            logging.info(f"Connected to collection '{collection_name}' in Pinecone.")

    @global_exception_handler(2411, "Error Saving Embeddings to Pinecone Vector Database")
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
        Save embeddings to the specified collection in Pinecone.
        
        Args:
            collection_name (str): Name of the collection.
            embeddings (List[List[float]]): List of embeddings.
            documents (List[str]): List of documents.
            create_new (bool): Whether to create a new collection.
            metric (str): Similarity metric, could be "cosine", "dotproduct", or "euclidean" (default: "cosine"). Only used when creating a new collection.
            metadatas (List[Dict[str, Any]]): Additional metadata to store with the embeddings.
        """

        client = self.connections.get(collection_name)
        if not client:
            raise ValueError(f"Not connected to collection '{collection_name}'.")

        if create_new:
            if not collection_name.islower() or not collection_name.replace("-", "").isalnum():
                raise ValueError("Collection name must consist of lowercase alphanumeric characters or hyphens.")
            if collection_name not in [index['name'] for index in client.list_indexes()]:
                client.create_index(
                    name=collection_name,
                    dimension=len(embeddings[0]),
                    metric=metric,
                    spec=ServerlessSpec(cloud="aws", region="us-east-1"),
                )
                logging.info(f"Created new collection '{collection_name}' with specified configuration.")

        ids = [metadata.get("id") for metadata in metadatas]
        if not ids:
            ids = [str(uuid.uuid4()) for _ in embeddings]

        upsert_data = [
            {
                "id": vector_id,
                "values": vector_values,
                "metadata": {"document": document, **metadata},
            }
            for vector_id, vector_values, document, metadata in zip(ids, embeddings, documents, metadatas)
        ]

        index = client.Index(collection_name)
        index.upsert(vectors=upsert_data)
        logging.info(f"Inserted {len(embeddings)} embeddings into collection '{collection_name}'.")

    @global_exception_handler(2412, "Error Searching Embeddings in Pinecone Vector Database")
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

        index = client.Index(collection_name)
        query_response = index.query(
            vector=query_embedding,
            top_k=top_k,
            include_values=True,
            include_metadata=True,
        )

        results = [{
            "id": match['id'],
            "document": match['metadata'].get('document'),
            "score": match['score']
        } for match in query_response['matches']]
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

    # Pinecone Test
    pinecone_db = PineconeVectorDatabase(client_type=0)
    pinecone_db.connect("pinecone_test_collection")
    pinecone_db.save_embeddings(
        collection_name="pinecone_test_collection",
        embeddings=embeddings,
        documents=documents,
        create_new=True,
    )
    pinecone_results = pinecone_db.search_embeddings(
        collection_name="pinecone_test_collection",
        query_embedding=query_vector,
        top_k=5,
    )
    print("Pinecone Search Results:", pinecone_results)
