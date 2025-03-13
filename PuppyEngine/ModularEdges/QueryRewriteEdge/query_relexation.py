# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from Utils.puppy_exception import global_exception_handler
from ModularEdges.QueryRewriteEdge.base_rewrite import QueryRewriteStrategy


class QueryRelaxationStrategy(QueryRewriteStrategy):
    @global_exception_handler(3703, "Error Rewrite Using Query Relaxation")
    def rewrite(
        self
    ) -> str:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to relax the given query by broadening its scope. 
This may involve replacing specific terms with more general ones or removing restrictive conditions.

Example:
User"s input:
"best sushi restaurants in downtown San Francisco"

Your output:
"best sushi restaurants in San Francisco"
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        relaxed_query = self._execute_lite_llm_chat(prompt)
        return relaxed_query.strip()
