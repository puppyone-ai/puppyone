# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.QueryRewriteEdge.base_rewrite import QueryRewriteStrategy


class QueryScopingStrategy(QueryRewriteStrategy):
    @global_exception_handler(3705, "Error Rewrite Using Query Scoping")
    def rewrite(
        self
    ) -> str:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to focus or narrow down the given user query by adding specific constraints or clarifications, making the query more precise.

Example:
User"s input:
"latest smartphone releases"

Your output:
"latest smartphone releases in 2024"
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        scoped_query = self._execute_lite_llm_chat(prompt)
        return scoped_query.strip()
