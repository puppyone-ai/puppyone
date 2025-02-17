# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.QueryRewriteEdge.base_rewrite import QueryRewriteStrategy


class HydeQueryConversionStrategy(QueryRewriteStrategy):
    @global_exception_handler(3707, "Error Rewrite Using HYDE Query")
    def rewrite(
        self
    ) -> str:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to convert the given query into a detailed pseudo-document that captures the context and intent of the query.

Example:
User"s input:
"Who is the current president of the USA?"

Your output:
"The current president of the United States is Joe Biden, who assumed office on January 20, 2021. Biden, a member of the Democratic Party, previously served as the 47th vice president from 2009 to 2017 under President Barack Obama."
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        pseudo_doc = self._execute_lite_llm_chat(prompt)
        return pseudo_doc.strip()
