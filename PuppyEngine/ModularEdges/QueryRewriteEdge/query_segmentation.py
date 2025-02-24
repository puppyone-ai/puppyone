# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from typing import List
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.QueryRewriteEdge.base_rewrite import QueryRewriteStrategy


class QuerySegmentationStrategy(QueryRewriteStrategy):
    @global_exception_handler(3704, "Error Rewrite Using Query Segmentation")
    def rewrite(
        self
    ) -> List[str]:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to segment the given complex query into smaller, independent sub-queries that can be answered individually.

Example:
User"s input:
"How to improve fuel efficiency in cars and what are the most efficient hybrid models?"

Your output:
[
    "How to improve fuel efficiency in cars?",
    "What are the most efficient hybrid models?"
]
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        segmented_query = self._execute_lite_llm_chat(prompt)
        return self._safe_eval(segmented_query)
