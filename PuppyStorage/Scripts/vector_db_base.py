# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import logging
from typing import List, Dict, Any
from abc import ABC, abstractmethod
import vecs
from pymilvus import MilvusClient
from qdrant_client import QdrantClient
from weaviate.classes.init import Auth
from weaviate import connect_to_weaviate_cloud
from pinecone.grpc import PineconeGRPC as Pinecone


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
            self.zilliz_client = MilvusClient(
                uri=os.environ.get("ZILLIZ_ENDPOINT"),
                token=os.environ.get("MILVUS_API_KEY"),
            )
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
        create_new: bool = False,
        metadatas: List[Dict[str, Any]] = [{}]
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

