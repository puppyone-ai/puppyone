# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from typing import List
from Utils.puppy_exception import global_exception_handler
from ModularEdges.QueryRewriteEdge.base_rewrite import QueryRewriteStrategy


class RewriteRetrieveReadStrategy(QueryRewriteStrategy):
    @global_exception_handler(3709, "Error Rewrite Using Rewrite-Retrieve-Read")
    def rewrite(
        self
    ) -> List[str]:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to rewrite the given query for improved retrieval, perform the retrieval, and then generate a final response based on the combined information.

Example:
User"s input:
"How to improve website SEO rankings?"

Your output:
[
    "How to improve SEO rankings for websites?",
    "How to improve Google search rankings?"
]
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        rewritten_queries = self._execute_lite_llm_chat(prompt)
        return self._safe_eval(rewritten_queries)
