# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from typing import List
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.QueryRewriteEdge.base_rewrite import QueryRewriteStrategy


class QueryToDocStrategy(QueryRewriteStrategy):
    @global_exception_handler(3710, "Error Rewrite Using Query-to-Doc")
    def rewrite(
        self
    ) -> str:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to generate a pseudo-document from the given query that captures all relevant context and information, to be used for enhanced retrieval.

Example:
User"s input:
"What is the history of the internet?"

Your output:
"The history of the internet began with the development of electronic computers in the 1950s. The initial concept of packet networking originated in several computer science laboratories in the United States, United Kingdom, and France. The US Department of Defense awarded contracts as early as the 1960s, including for the development of the ARPANET, which later became the foundation for the internet we know today."
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        pseudo_doc = self._execute_lite_llm_chat(prompt)
        return pseudo_doc
