# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from typing import List
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.QueryRewriteEdge.base_rewrite import QueryRewriteStrategy


class MultiQueryStrategy(QueryRewriteStrategy):
    @global_exception_handler(3701, "Error Rewrite Using Multi-Query")
    def rewrite(
        self, 
        num_query: int
    ) -> List[str]:
        prompt = [
            {
                "role": "system",
                "content": f"""
Your task is to generate {num_query} different versions of the given user question to retrieve relevant documents from a vector database. 
By generating multiple perspectives on the user question, your goal is to help the user overcome some of the limitations of the distance-based similarity search.

Example:
User"s input:
"Who won a championship more recently, the Red Sox or the Patriots?"

Your output:
[
    "When was the last time the Red Sox won a championship?",
    "When was the last time the Patriots won a championship?"
]
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        multi_q = self._execute_lite_llm_chat(prompt)
        return self._safe_eval(multi_q)
