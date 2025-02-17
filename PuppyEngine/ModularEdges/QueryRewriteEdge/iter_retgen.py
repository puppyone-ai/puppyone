# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from typing import List
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.QueryRewriteEdge.base_rewrite import QueryRewriteStrategy


class IterRetgenStrategy(QueryRewriteStrategy):
    @global_exception_handler(3711, "Error Rewrite Using Iter-Retgen")
    def rewrite(
        self,
        iterations: int = 3
    ) -> List[str]:
        prompt = [
            {
                "role": "system",
                "content": f"""
Your task is to iteratively refine the retrieval and generation process for the given query over {iterations} iterations. 
With each iteration, generate a more refined query and retrieve more specific information.

Example:
User"s input:
"Explain the impact of climate change on polar bears."

Your output for each iteration might look like:
[
    "How does climate change affect polar bears in the Arctic region?",
    "What are the primary causes of habitat loss for polar bears?",
    "How do rising temperatures specifically affect the hunting patterns of polar bears?"
]

The goal is to narrow down the query with each iteration, getting closer to specific and detailed aspects of the original question.
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        iter_results = []
        current_query = self.original_query

        for i in range(iterations):
            # Generate the next iteration of the query refinement
            response = self._execute_lite_llm_chat(
                [
                    {"role": "system", "content": f"Iteration {i+1}: {prompt[0]['content']}"},
                    {"role": "user", "content": current_query}
                ]
            )
            refined_query = self._safe_eval(response)
            iter_results.append(refined_query)
            # Get the most refined one
            current_query = refined_query[-1]
        return iter_results
