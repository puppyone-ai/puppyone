# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from typing import List
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.QueryRewriteEdge.base_rewrite import QueryRewriteStrategy


class SubQuestionQueryStrategy(QueryRewriteStrategy):
    @global_exception_handler(3706, "Error Rewrite Using Sub-Question Query")
    def rewrite(
        self
    ) -> List[str]:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to break down the given complex query into smaller, more specific sub-questions that can be addressed individually.

Example:
User"s input:
"How do renewable energy sources compare in terms of cost, efficiency, and environmental impact?"

Your output:
[
    "How do renewable energy sources compare in terms of cost?",
    "How do renewable energy sources compare in terms of efficiency?",
    "How do renewable energy sources compare in terms of environmental impact?"
]
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        sub_questions = self._execute_lite_llm_chat(prompt)
        return self._safe_eval(sub_questions)
