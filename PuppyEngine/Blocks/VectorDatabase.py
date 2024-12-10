# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import uuid
import logging
from typing import List, Dict, Any
from abc import ABC, abstractmethod
import vecs
from psycopg2.extras import execute_values
from pymilvus import MilvusClient, CollectionSchema, FieldSchema, DataType
from qdrant_client import QdrantClient
from qdrant_client.http.models import VectorParams, Distance
from qdrant_client.models import Filter, FieldCondition, MatchValue
from pinecone import ServerlessSpec
from pinecone.grpc import PineconeGRPC as Pinecone
from weaviate.classes.init import Auth
from weaviate.classes.config import DataType
from weaviate import connect_to_weaviate_cloud
from weaviate.classes.config import Property, DataType, Configure
from Utils.PuppyEngineExceptions import PuppyEngineException, global_exception_handler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class VectorDatabase(ABC):
    def __init__(
        self,
        client_type: int
    ):
        self.collections = {}
        if client_type == 0:
            self.pgvector_client = vecs.create_client(os.environ.get("SUPABASE_URL"))
        else:
            # self.zilliz_client = MilvusClient(
            #     uri=os.environ.get("ZILLIZ_ENDPOINT"),
            #     token=os.environ.get("MILVUS_API_KEY"),
            # )
            self.qdrant_client = QdrantClient(
                url=os.environ.get("QDRANT_URL"),
                api_key=os.environ.get("QDRANT_API_KEY")
            )
            self.pinecone_client = Pinecone(api_key=os.environ.get("PINECONE_API_KEY"))
            self.weaviate_client = connect_to_weaviate_cloud(
                cluster_url=os.getenv("WEAVIATE_RESTFUL_URL"),
                auth_credentials=Auth.api_key(api_key=os.getenv("WEAVIATE_ADMIN_KEY")),
                headers={
                    "X-OpenAI-Api-Key": os.getenv("DEEPBRICKS_API_KEY"),
                    "X-OpenAI-BaseURL": os.getenv("DEEPBRICKS_BASE_URL")
                }
            )

    @abstractmethod
    def connect(
        self,
        collection_name: str,
    ):
        pass

    @abstractmethod
    def save_embeddings(
        self,
        collection_name: str,
        embeddings: List[List[float]],
        documents: List[str],
        ids: List[str] = None,
        create_new: bool = False,
        **kwargs
    ):
        pass

    @abstractmethod
    def search_embeddings(
        self,
        collection_name: str,
        query_embedding: List[float],
        top_k: int,
        **kwargs
    ) -> List[Dict[str, Any]]:
        pass


class ZillizVectorDatabase(VectorDatabase):
    def __init__(
        self,
        client_type: int
    ):
        super().__init__(client_type=client_type)
        self.connections = {}

    @global_exception_handler(1604, "Error Connecting to Zilliz Vector Database")
    def connect(
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

    @global_exception_handler(2209, "Error Saving Embeddings to Zilliz Vector Database")
    def save_embeddings(
        self,
        collection_name: str,
        embeddings: List[List[float]],
        documents: List[str],
        ids: List[str] = None,
        create_new: bool = False
    ) -> None:
        """
        Save embeddings to the specified collection in Zilliz.
        
        Args:
            collection_name (str): Name of the collection.
            embeddings (List[List[float]]): List of embeddings.
            documents (List[str]): List of documents.
            ids (List[str]): List of unique IDs.
            create_new (bool): Whether to create a new collection.
        """

        client = self.connections.get(collection_name)
        if not client:
            raise ValueError(f"Not connected to collection '{collection_name}'.")

        if create_new:
            fields = [
                FieldSchema(name="id", dtype=DataType.VARCHAR, is_primary=True, max_length=64),
                FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=len(embeddings[0])),
                FieldSchema(name="document", dtype=DataType.VARCHAR, max_length=1024)
            ]
            schema = CollectionSchema(fields)
            client.create_collection(collection_name, schema)
            logging.info(f"Created new collection '{collection_name}' with specified schema.")

        if not ids:
            ids = [str(uuid.uuid4()) for _ in embeddings]

        data = [
            ids,
            embeddings,
            documents
        ]
        client.upsert(collection_name, data)
        logging.info(f"Inserted {len(embeddings)} embeddings into collection '{collection_name}'.")

    @global_exception_handler(3612, "Error Searching Embeddings in Zilliz Vector Database")
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


class QdrantVectorDatabase(VectorDatabase):
    def __init__(
        self,
        client_type: int
    ):
        super().__init__(client_type=client_type)
        self.connections = {}

    @global_exception_handler(1606, "Error Connecting to Qdrant Vector Database")
    def connect(
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

    @global_exception_handler(2212, "Error Saving Embeddings to Qdrant Vector Database")
    def save_embeddings(
        self,
        collection_name: str,
        embeddings: List[List[float]],
        documents: List[str],
        ids: List[str] = None,
        create_new: bool = False,
        metric: str = "cosine"
    ) -> None:
        """
        Save embeddings to the specified collection in Qdrant.
        
        Args:
            collection_name (str): Name of the collection.
            embeddings (List[List[float]]): List of embeddings.
            documents (List[str]): List of documents.
            ids (List[str]): List of unique IDs.
            create_new (bool): Whether to create a new collection.
            metric (str): Similarity metric (default: "cosine").
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

        if not ids:
            ids = [str(uuid.uuid4()) for _ in embeddings]

        points = [
            {
                "id": ids[i],
                "vector": embeddings[i],
                "payload": {"document": documents[i]}
            }
            for i in range(len(embeddings))
        ]
        client.upsert(collection_name=collection_name, points=points)
        logging.info(f"Inserted {len(embeddings)} embeddings into collection '{collection_name}'.")

    @global_exception_handler(3613, "Error Searching Embeddings in Qdrant Vector Database")
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


class PineconeVectorDatabase(VectorDatabase):
    def __init__(
        self,
        client_type: int
    ):
        super().__init__(client_type=client_type)
        self.connections = {}

    @global_exception_handler(1608, "Error Connecting to Pinecone Vector Database")
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

    @global_exception_handler(2209, "Error Saving Embeddings to Pinecone Vector Database")
    def save_embeddings(
        self,
        collection_name: str,
        embeddings: List[List[float]],
        documents: List[str],
        ids: List[str] = None,
        create_new: bool = False,
        metric: str = "cosine"
    ) -> None:
        """
        Save embeddings to the specified collection in Pinecone.
        
        Args:
            collection_name (str): Name of the collection.
            embeddings (List[List[float]]): List of embeddings.
            documents (List[str]): List of documents.
            ids (List[str]): List of unique IDs.
            create_new (bool): Whether to create a new collection.
            metric (str): Similarity metric, could be "cosine", "dotproduct", or "euclidean" (default: "cosine"). Only used when creating a new collection.
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

        if not ids:
            ids = [str(uuid.uuid4()) for _ in embeddings]

        upsert_data = [
            {
                "id": vector_id,
                "values": vector_values,
                "metadata": {"document": document},
            }
            for vector_id, vector_values, document in zip(ids, embeddings, documents)
        ]

        index = client.Index(collection_name)
        index.upsert(vectors=upsert_data)
        logging.info(f"Inserted {len(embeddings)} embeddings into collection '{collection_name}'.")

    @global_exception_handler(3612, "Error Searching Embeddings in Pinecone Vector Database")
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
    

class WeaviateVectorDatabase(VectorDatabase):
    def __init__(
        self,
        client_type: int
    ):
        super().__init__(client_type=client_type)
        self.connections = {}

    @global_exception_handler(1612, "Error Connecting to Weaviate Vector Database")
    def connect(
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

    @global_exception_handler(2229, "Error Saving Embeddings to Weaviate Vector Database")
    def save_embeddings(
        self,
        collection_name: str,
        embeddings: List[List[float]],
        documents: List[str],
        ids: List[str] = None,
        create_new: bool = False
    ) -> None:
        """
        Save embeddings to the specified collection in Weaviate.
        
        Args:
            collection_name (str): Name of the collection.
            embeddings (List[List[float]]): List of embeddings.
            documents (List[str]): List of documents.
            ids (List[str]): List of unique IDs.
            create_new (bool): Whether to create a new collection.
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
                    Property(name="documents", data_type=DataType.TEXT),
                ],
                vectorizer_config=[
                    Configure.NamedVectors.none(name="vector_id"),
                    Configure.NamedVectors.none(name="embedding")
                ],
            )
            logging.info(f"Created new collection '{collection_name}' with specified schema.")

        if not ids:
            ids = [str(uuid.uuid4()) for _ in embeddings]

        questions = client.collections.get(collection_name)
        with questions.batch.dynamic() as batch:
            for i in range(len(embeddings)):
                batch.add_object(
                    {
                        "vector_id": ids[i],
                        "embedding": embeddings[i],
                        "documents": documents[i]
                    }, 
                    vector={"embedding": embeddings[i]}
                )
        logging.info(f"Inserted {len(embeddings)} embeddings into collection '{collection_name}'.")

    @global_exception_handler(3616, "Error Searching Embeddings in Weaviate Vector Database")
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
    
        
class PostgresVectorDatabase(VectorDatabase):
    def __init__(
        self,
        client_type: int
    ):
        """
        Initialize the PostgresVectorDatabase client.
        """

        super().__init__(client_type=client_type)        
        self.vecs = None
        self.connections = {}

    @global_exception_handler(1614, "Error Connecting to Postgres Vector Database")
    def connect(
        self,
        collection_name: str
    ) -> None:
        """
        Connect to a Postgres-based vector database collection.

        Args:
            collection_name (str): Name of the collection to connect to.
        """

        if collection_name not in self.connections:
            self.connections[collection_name] = self.pgvector_client
            logging.info(f"Connected to collection '{collection_name}' in Pgvector.")

    @global_exception_handler(2221, "Error Saving Embeddings to Postgres Vector Database")
    def save_embeddings(
        self,
        collection_name: str,
        embeddings: List[List[float]],
        documents: List[str],
        ids: List[str] = None,
        create_new: bool = False,
        metric: str = "cosine",
        **kwargs,
    ) -> None:
        """
        Save embeddings to the Postgres-based vector database.

        Args:
            collection_name (str): Name of the collection.
            embeddings (List[List[float]]): List of embeddings.
            documents (List[str]): List of associated documents.
            ids (List[str]): List of unique IDs.
            create_new (bool): Whether to create a new collection (if it doesn't exist).
            metric (str): Similarity metric to use for the collection (default: "cosine").
        """

        client = self.connections.get(collection_name)
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

        if not ids:
            ids = [str(uuid.uuid4()) for _ in embeddings]

        records = [
            (ids[i], embeddings[i], {"doc": documents[i]}) for i in range(len(embeddings))
        ]
        collection.upsert(records=records)
        logging.info(f"Inserted {len(records)} embeddings into collection '{collection_name}'.")

    @global_exception_handler(3617, "Error Searching in Postgres Vector Database")
    def search_embeddings(
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

        client = self.connections.get(collection_name)
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

    @global_exception_handler(2222, "Error Deleting Collection in Postgres Vector Database")
    def delete_index(
        self,
        collection_name: str
    ) -> None:
        """
        Delete a collection (index) from the Postgres-based vector database.

        Args:
            collection_name (str): Name of the collection to delete.
        """

        client = self.connections.get(collection_name)
        if not client:
            raise ValueError(f"Not connected to collection '{collection_name}'.")
        
        client.delete_collection(collection_name)
        logging.info(f"Deleted collection: {collection_name}")


class VectorDatabaseFactory:
    _db_mapping = {
        "zilliz": ZillizVectorDatabase,
        "qdrant": QdrantVectorDatabase,
        "pinecone": PineconeVectorDatabase,
        "weaviate": WeaviateVectorDatabase,
        "pgvector": PostgresVectorDatabase
    }

    @staticmethod
    def get_database(
        db_type: str
    ) -> VectorDatabase:
        db_class = VectorDatabaseFactory._db_mapping.get(db_type.lower())
        if db_class is None:
            raise PuppyEngineException(
                1601, "Unsupported Vector Database Type", f"Type: {db_type}"
            )
        client_type = 0 if db_type == "pgvector" else 1
        return db_class(client_type=client_type)


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
    # zilliz_db = VectorDatabaseFactory.get_database("zilliz")
    # zilliz_db.connect("zilliz_test_collection")
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
    # qdrant_db.connect("qdrant_test_collection")
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
    # pinecone_db.connect("pinecone_test_collection")
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
    # weaviate_db.connect("weaviate_test_collection")
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
    pgvector_db.connect("test_collection")
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
