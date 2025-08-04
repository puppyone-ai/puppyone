import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) )

from typing import Dict, Any
from ModularEdges.EdgeFactoryBase import EdgeFactoryBase
from Utils.puppy_exception import global_exception_handler
from .deep_research_strategy import DeepResearchStrategy

class DeepResearcherFactory(EdgeFactoryBase):
    """Factory for Deep Research Edge."""

    @staticmethod
    @global_exception_handler(3917, "Error Executing Deep Research Edge")
    def execute(
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> Any:
        query = init_configs.get("query")
        return DeepResearchStrategy(query, extra_configs).search()

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    query = "What are the latest advances in quantum computing?"
    extra_configs = {
        "max_rounds": 2,
        "llm_model": "gpt-4o",
        "vector_config": {"data_source": [], "top_k": 3},
        "web_config": {"top_k": 3},
        "perplexity_config": {"model": "sonar", "sub_search_type": "perplexity"}
    }
    print(DeepResearcherFactory.execute(init_configs={"query": query}, extra_configs=extra_configs)) 