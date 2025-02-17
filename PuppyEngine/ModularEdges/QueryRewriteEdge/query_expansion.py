# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from typing import List
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.QueryRewriteEdge.base_rewrite import QueryRewriteStrategy


class ExpansionStrategy(QueryRewriteStrategy):
    @global_exception_handler(3702, "Error Rewrite Using Query Expansion")
    def rewrite(
        self
    ) -> List[str]:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to expand the given user query by adding related terms, synonyms, and relevant keywords. 
The goal is to enhance the query"s ability to retrieve more comprehensive results from the database.

Example:
User"s input:
"renewable energy sources"

Your output:
[
    "renewable energy sources",
    "alternative energy sources",
    "green energy",
    "sustainable energy sources"
]
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        expanded_query = self._execute_lite_llm_chat(prompt)
        return self._safe_eval(expanded_query)
