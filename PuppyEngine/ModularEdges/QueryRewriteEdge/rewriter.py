# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from typing import List, Union, Dict, Any
from ModularEdges.EdgeFactoryBase import EdgeFactoryBase
from ModularEdges.QueryRewriteEdge.iter_retgen import IterRetgenStrategy
from ModularEdges.QueryRewriteEdge.multi_query import MultiQueryStrategy
from ModularEdges.QueryRewriteEdge.query_to_doc import QueryToDocStrategy
from ModularEdges.QueryRewriteEdge.query_expansion import ExpansionStrategy
from ModularEdges.QueryRewriteEdge.query_scoping import QueryScopingStrategy
from ModularEdges.QueryRewriteEdge.query_relexation import QueryRelaxationStrategy
from ModularEdges.QueryRewriteEdge.sub_question_query import SubQuestionQueryStrategy
from ModularEdges.QueryRewriteEdge.query_segmentation import QuerySegmentationStrategy
from Utils.PuppyEngineExceptions import global_exception_handler, PuppyEngineException
from ModularEdges.QueryRewriteEdge.step_back_prompting import StepBackPromptingStrategy
from ModularEdges.QueryRewriteEdge.rewrite_retrieve_read import RewriteRetrieveReadStrategy
from ModularEdges.QueryRewriteEdge.hyde_query_conversion import HydeQueryConversionStrategy


class QueryRewriterFactory(EdgeFactoryBase):
    """Factory for creating query rewrite strategies"""

    _strategies = {
        "multi": MultiQueryStrategy,
        "expansion": ExpansionStrategy,
        "relaxation": QueryRelaxationStrategy,
        "segmentation": QuerySegmentationStrategy,
        "scoping": QueryScopingStrategy,
        "sub_question": SubQuestionQueryStrategy,
        "hyde": HydeQueryConversionStrategy,
        "step_back": StepBackPromptingStrategy,
        "rrr": RewriteRetrieveReadStrategy,
        "query2doc": QueryToDocStrategy,
        "iter": IterRetgenStrategy
    }

    @classmethod
    @global_exception_handler(3019, "Error Executing Query Rewrite Edge")
    def execute(
        cls,
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> Union[str, List[str]]:
        strategy_type = init_configs.get("strategy_type")

        strategy_class = cls._strategies.get(strategy_type)
        if not strategy_class:
            raise PuppyEngineException(3700, "Invalid Strategy", 
                                     f"Strategy type {strategy_type} not supported")

        strategy = strategy_class(init_configs.get("query"), init_configs.get("model"))
        return strategy.rewrite(**extra_configs)


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    # Example usage
    query = "What is the impact of climate change?"

    # Multi-query rewrite
    result = QueryRewriterFactory.execute(init_configs={"strategy_type": "multi", "query": query}, extra_configs={"num_query": 3})
    print("Multi-query:", result)

    # Query expansion
    result = QueryRewriterFactory.execute(init_configs={"strategy_type": "expansion", "query": query})
    print("Expansion:", result)

    # Iterative rewrite
    result = QueryRewriterFactory.execute(init_configs={"strategy_type": "iter", "query": query}, extra_configs={"iterations": 3})
    print("Iterative:", result)
