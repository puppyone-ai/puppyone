# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import logging
from typing import List, Dict, Any
from abc import ABC, abstractmethod

from pymilvus import MilvusClient
from qdrant_client import QdrantClient
from weaviate.classes.init import Auth
from weaviate import connect_to_weaviate_cloud
from pinecone.grpc import PineconeGRPC as Pinecone


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class VectorDatabase(ABC):

    _client: Any = None

    def __init__(
        self,
    ):
        # self.zilliz_client = MilvusClient(
        #     uri=os.environ.get("ZILLIZ_ENDPOINT"),
        #     token=os.environ.get("MILVUS_API_KEY"),
        # )
        # self.qdrant_client = QdrantClient(
        #     url=os.environ.get("QDRANT_URL"),
        #     api_key=os.environ.get("QDRANT_API_KEY")
        # )
        # self.weaviate_client = connect_to_weaviate_cloud(
        #     cluster_url=os.getenv("WEAVIATE_RESTFUL_URL"),
        #     auth_credentials=Auth.api_key(api_key=os.getenv("WEAVIATE_ADMIN_KEY")),
        #     headers={
        #         "X-OpenAI-Api-Key": os.getenv("DEEPBRICKS_API_KEY"),
        #         "X-OpenAI-BaseURL": os.getenv("DEEPBRICKS_BASE_URL")
        #     }
        # )

        pass

    @abstractmethod
    def store_vectors(
        self,
        collection_name: str,
        ids: List[str],
        vectors: List[List[float]],
        contents: List[str],
        metric: str = "cosine",
        metadatas: List[Dict[str, Any]] = [{}]
    ):
        pass

    @abstractmethod
    def search_vectors(
        self,
        collection_name: str,
        query_embedding: List[float],
        top_k: int,
        **kwargs
    ) -> List[Dict[str, Any]]:
        pass

