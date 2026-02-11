# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from typing import List
from Utils.puppy_exception import global_exception_handler
from ModularEdges.QueryRewriteEdge.base_rewrite import QueryRewriteStrategy


class StepBackPromptingStrategy(QueryRewriteStrategy):
    @global_exception_handler(3708, "Error Rewrite Using Step-Back Prompting")
    def rewrite(
        self
    ) -> List[str]:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to generate a more general or abstract version of the given query to retrieve broader context, followed by specific sub-queries for detailed retrieval.

Example:
User"s input:
"What are the economic effects of climate change in developing countries?"

Your output:
[
    "What are the effects of climate change?",
    "What are the economic effects of climate change?",
    "What are the economic effects of climate change in developing countries?"
]
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        step_back_queries = self._execute_lite_llm_chat(prompt)
        return self._safe_eval(step_back_queries)
