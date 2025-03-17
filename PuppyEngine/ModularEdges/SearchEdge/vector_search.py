# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
import sys
from typing import List, Tuple
from ModularEdges.StorageEdge import StoragerFactory
from Utils.puppy_exception import global_exception_handler
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

        # Handle multiple collection configs
        collection_configs = self.extra_configs.get("collection_configs", [])
        collection_name_set = set([config.get("collection_name", "") for config in collection_configs])
        if len(collection_name_set) > 1:
            search_results = []
            for collection_config in collection_configs:
                collection_name = collection_config.get("collection_name", "")
                if collection_name in collection_name_set:
                    collection_name_set.remove(collection_name)

                search_results.extend(StorageClient.execute(
                    collection_name=collection_name,
                    search_configs={
                        "query": self.query,
                        "model": collection_config.get("model", "text-embedding-ada-002"),
                        "vdb_type": collection_config.get("db_type", "pgvector"),
                        "top_k": self.top_k,
                        "threshold": self.threshold,
                    }
                ))

            # Sort and return the top k results and pass the threshold
            search_results.sort(key=lambda x: x["score"], reverse=True)
            if self.top_k:
                search_results = search_results[:self.top_k]
            if self.threshold:
                search_results = [result for result in search_results if result["score"] >= self.threshold]

            return search_results

        return StorageClient.execute(
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
