# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import json
from typing import List, Dict
from ModularEdges.LLMEdge.generater import lite_llm_chat
from ModularEdges.RerankEdge.base_reranker import BaseReranker
from Utils.PuppyEngineExceptions import global_exception_handler


class LLMBasedReranker(BaseReranker):
    def __init__(
        self,
        model_name: str = None
    ):
        super().__init__(model_name)

    @global_exception_handler(3302, "Error Parsing Reranked Content from LLM")
    def _safe_parse_response(
        self,
        response: str
    ) -> List[dict]:
        json_str = ""
        bracket_count = 0
        inside_list = False

        for char in response:
            if char == "[":
                if not inside_list:
                    inside_list = True
                bracket_count += 1
            elif char == "]":
                bracket_count -= 1

            if inside_list:
                json_str += char

            if bracket_count == 0 and inside_list:
                break

        # Parsing the collected JSON-like string
        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            return []

    @global_exception_handler(3301, "Error Reranking Using LLM")
    def rerank(
        self,
        query: str,
        retrieval_chunks: List[str],
        top_k: int = 5
    ) -> List[Dict[str, float]]:
        sys_prompt = """
You will be provided with a list of strings and a query. Your task is to rank the strings based on their relevance to the given query and assign a score between 0 to 1 for each string, where 1 indicates the highest relevance and 0 indicates no relevance.

When ranking and scoring the strings, follow these guidelines:
- Do not rely solely on keyword matching. Instead, assess the overall context and meaning of each string in relation to the query.
- Consider the diversity of the content. Strings that offer unique or varied perspectives related to the query should be prioritized higher.
- Ensure that the top-ranked strings provide a comprehensive overview of the different aspects related to the query.

The input will be structured as follows:
A query string will be preceded by the label "query:".
A list of strings, each on a new line, will be provided following the label "doc:".

The output should be a ranked list of the strings along with their respective scores, from the most relevant and diverse to the least.
Provide the output in the following format:

{
    "docs": [
        {"doc": "Most relevant and diverse string", "score": 0.95},
        {"doc": "Second most relevant and diverse string", "score": 0.85},
        ...
        {"doc": "Least relevant and diverse string", "score": 0.70}
    ]
}

Here is an example you can use as a reference:
Example input:
query: "environmental impact of plastic waste"
docs:
"Plastic waste contributes to marine pollution."
"Plastic can take hundreds of years to decompose."
"Plastic waste management practices vary globally."
"Innovations in biodegradable plastics."

Example output:
{
    "docs": [
        {"doc": "Plastic waste contributes to marine pollution.", "score": 0.95},
        {"doc": "Innovations in biodegradable plastics.", "score": 0.85},
        {"doc": "Plastic can take hundreds of years to decompose.", "score": 0.80},
        {"doc": "Plastic waste management practices vary globally.", "score": 0.75}
    ]
}
"""
        prompt = [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": f"query: {query}\ndocs: {retrieval_chunks}"}
        ]

        structure = {
            "type": "json_schema",
            "json_schema": {
                "name": "rank_json",
                "schema": {
                    "type": "object",
                    "properties": {
                        "docs": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "doc": {"type": "string"},
                                    "score": {"type": "number"}
                                },
                                "required": ["doc", "score"]
                            }
                        }
                    },
                    "required": ["docs"]
                }
            }
        }

        response = lite_llm_chat(
            messages=prompt,
            model=self.model_name,
            temperature=0.9,
            max_tokens=4096,
            printing=False,
            stream=False,
            response_format=structure,
        )

        final_response = self._safe_parse_response(response)
        return final_response[:top_k]


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    query = "What is your name?"
    retrieval_chunks=["I am developer", "I am a human", "I am Jack", "Hello", "Working"]
    
    reranker = LLMBasedReranker(model_name="gpt-4o-2024-08-06")
    result = reranker.rerank(query=query, retrieval_chunks=retrieval_chunks, top_k=3)
    print("LLM-Based Reranker Results:", result)
