# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
import sys
from typing import List, Tuple
from ModularEdges.StorageEdge import StoragerFactory
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.SearchEdge.search_strategy import BaseRetriever


# Global Storage Client
StorageClient = StoragerFactory()


class VectorRetrievalStrategy(BaseRetriever):
    """Vector-based search using an external Vector Database."""

    @global_exception_handler(3405, "Error Retrieving Using Vector Search")
    def search(
        self
    ) -> List[Tuple[str, float]]:
        """
        Perform a vector-based search using the StorageClient.

        :return: A list of tuples containing the document and its score.
        """

        return StorageClient.search_embedded_vector(
            collection_name=self.extra_configs.get("collection_name", ""),
            search_configs={

                "query": self.query,
                "model": self.extra_configs.get("model", "text-embedding-ada-002"),
                "vdb_type": self.extra_configs.get("db_type", "pgvector"),
                "top_k": self.top_k,
                "threshold": self.threshold,
            }
        )


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    query = "What is the capital of France?"
    documents = ["France is a country in Western Europe.", "Paris is the capital of France."]
    extra_configs = {
        "collection_name": "test_collection",
        "model": "text-embedding-ada-002",
        "db_type": "pgvector",
    }

    vector_retrieval = VectorRetrievalStrategy(query, extra_configs, documents, top_k=2, threshold=0.5)
    print(vector_retrieval.search())
