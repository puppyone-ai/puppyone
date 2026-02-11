# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import uuid
import logging
from typing import List, Dict, Any
from pymilvus import CollectionSchema, FieldSchema, DataType
from objs.vector.vdb.vdb_base import VectorDatabase
from utils.puppy_exception import global_exception_handler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ZillizVectorDatabase(VectorDatabase):
    def __init__(
        self,
        client_type: int
    ):
        super().__init__(client_type=client_type)
        self.connections = {}

    @global_exception_handler(2404, "Error Connecting to Zilliz Vector Database")
    def register_collection(
        self,
        collection_name: str
    ) -> None:
        """
        Connect to a collection in Zilliz.
        
        Args:
            collection_name (str): Name of the collection.
        """

        if collection_name not in self.connections:
            self.connections[collection_name] = self.zilliz_client
            logging.info(f"Connected to collection '{collection_name}' in Zilliz.")

    @global_exception_handler(2405, "Error Saving Embeddings to Zilliz Vector Database")
    def save_embeddings(
        self,
        collection_name: str,
        embeddings: List[List[float]],
        documents: List[str],
        create_new: bool = False,
        metadatas: List[Dict[str, Any]] = [{}]
    ) -> None:
        """
        Save embeddings to the specified collection in Zilliz.
        
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
            fields = [
                FieldSchema(name="id", dtype=DataType.VARCHAR, is_primary=True, max_length=64),
                FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=len(embeddings[0])),
                FieldSchema(name="metadata", dtype=DataType.OBJECT)
            ]
            schema = CollectionSchema(fields)
            client.create_collection(collection_name, schema)
            logging.info(f"Created new collection '{collection_name}' with specified schema.")

        ids = [metadata.get("id") for metadata in metadatas]
        if not ids:
            ids = [str(uuid.uuid4()) for _ in embeddings]

        data = [
            ids,
            embeddings,
            [{"document": documents[i], **metadatas[i]} for i in range(len(documents))]
        ]
        client.upsert(collection_name, data)
        logging.info(f"Inserted {len(embeddings)} embeddings into collection '{collection_name}'.")

    @global_exception_handler(2406, "Error Searching Embeddings in Zilliz Vector Database")
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
            metric_type (str): Similarity metric, could be "COSINE", "L2", "IP" (default: "COSINE").
            filter_tag (str): Tag to filter by.
            filter_str (str): Filter string.
            partition_names (List[str]): List of partition names.

        Returns:
            List[Dict[str, Any]]: List of search results.
        """

        client = self.connections.get(collection_name)
        if not client:
            raise ValueError(f"Not connected to collection '{collection_name}'.")

        search_params = {"metric_type": kwargs.get("metric_type", "COSINE"), "params": {"nprobe": 10}}
        partition_names = kwargs.get("partition_names")
        responses = client.search(
            collection_name=collection_name,
            data=[query_embedding],
            filter="embedding",
            limit=top_k,
            search_params=search_params,
            partition_names=partition_names
        )

        results = [{
            "id": result.id,
            "document": result.entity.get("document"),
            "score": result.distance
        } for result in responses[0]]
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

    # Zilliz Test
    zilliz_db = ZillizVectorDatabase(client_type=0)
    zilliz_db.register_collection("zilliz_test_collection")
    zilliz_db.save_embeddings(
        collection_name="zilliz_test_collection",
        embeddings=embeddings,
        documents=documents,
        create_new=True,
    )
    zilliz_results = zilliz_db.search_embeddings(
        collection_name="zilliz_test_collection",
        query_embedding=query_vector,
        top_k=5,
    )
    print("Zilliz Search Results:", zilliz_results)
