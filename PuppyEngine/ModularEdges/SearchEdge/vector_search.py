# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
import sys
import logging
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

        # Handle data sources
        data_sources = self.extra_configs.get("data_source", [])
        if not data_sources:
            raise ValueError("No data sources provided")

        # Single data source: direct pass-through (Storage handles top_k)
        if len(data_sources) == 1:
            collection_configs = data_sources[0].get("index_item", {}).get("collection_configs", {})
            search_results = StorageClient.execute(
                collection_name=collection_configs.get("collection_name", ""),
                search_configs={
                    "query": self.query,
                    "model": collection_configs.get("model", "text-embedding-ada-002"),
                    "vdb_type": collection_configs.get("vdb_type", "pgvector"),
                    "top_k": self.top_k,
                    "threshold": self.threshold,
                    "user_id": collection_configs.get("user_id", ""),
                    "set_name": collection_configs.get("set_name", ""),
                }
            )
            search_results = [res.get("metadata", {}).get("retrieval_content", "") for res in search_results]
            return search_results
        
        # Multiple data sources: request more candidates, then merge and rank
        search_results = []
        # Request 2x candidates from each source to ensure quality after merging
        per_source_top_k = (self.top_k * 2) if self.top_k else None
        
        for data_source in data_sources:
            collection_configs = data_source.get("index_item", {}).get("collection_configs", {})
            results = StorageClient.execute(
                collection_name=collection_configs.get("collection_name", ""),
                search_configs={
                    "query": self.query,
                    "model": collection_configs.get("model", "text-embedding-ada-002"),
                    "vdb_type": collection_configs.get("vdb_type", "pgvector"),
                    "top_k": per_source_top_k,
                    "threshold": self.threshold,
                    "user_id": collection_configs.get("user_id", ""),
                    "set_name": collection_configs.get("set_name", ""),
                }
            )
            search_results.extend(results)

        # Deduplicate by metadata.id (keep highest score)
        seen_ids = {}
        deduplicated_results = []
        for result in sorted(search_results, key=lambda x: x["score"], reverse=True):
            # Use metadata.id as dedup key if available, otherwise use retrieval_content
            result_id = result.get("metadata", {}).get("id")
            dedup_key = result_id if result_id is not None else result.get("metadata", {}).get("retrieval_content", "")
            
            if dedup_key not in seen_ids:
                seen_ids[dedup_key] = True
                deduplicated_results.append(result)
        
        # Apply final top_k and threshold after deduplication
        if self.top_k:
            deduplicated_results = deduplicated_results[:self.top_k]
        if self.threshold:
            deduplicated_results = [result for result in deduplicated_results if result["score"] >= self.threshold]

        deduplicated_results = [res.get("metadata", {}).get("retrieval_content", "") for res in deduplicated_results]
        return deduplicated_results


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
