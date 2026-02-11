# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from typing import Dict, Any
from ModularEdges.EdgeFactoryBase import EdgeFactoryBase
from ModularEdges.DeepResearcherEdge.deep_researcher import DeepResearcherEdge
from Utils.puppy_exception import global_exception_handler


class DeepResearcherFactory(EdgeFactoryBase):
    """Factory class for DeepResearcherEdge."""

    @staticmethod
    @global_exception_handler(3803, "Error Executing Deep Researcher Factory")
    def execute(
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> str:
        """
        Execute the DeepResearcherEdge.
        
        Args:
            init_configs: Contains the query and basic configuration
            extra_configs: Contains tool configurations and advanced settings
            
        Returns:
            str: The final comprehensive research result
        """
        deep_researcher = DeepResearcherEdge()
        return deep_researcher.execute(init_configs, extra_configs)


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    # Example usage
    init_configs = {
        "query": "What are the latest developments in artificial intelligence?"
    }
    
    extra_configs = {
        "model": "openai/gpt-5",
        "temperature": 0.1,
        "max_tokens": 10000,
        "max_iterations": 3,
        "vector_search_configs": {
            "data_source": [
                {
                    "index_item": {
                        "collection_configs": {
                            "collection_name": "ai_research",
                            "model": "text-embedding-ada-002",
                            "vdb_type": "pgvector",
                            "user_id": "test_user",
                            "set_name": "ai_docs"
                        }
                    }
                }
            ],
            "top_k": 5,
            "threshold": 0.7
        },
        "google_search_configs": {
            "max_results": 5,
            "filter_unreachable_pages": True
        },
        "perplexity_search_configs": {
            "model": "gpt-4o-mini"
        }
    }
    
    result = DeepResearcherFactory.execute(init_configs, extra_configs)
    print("Deep Research Result:")
    print(result) 