# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
import sys
import json
from typing import List, Tuple
from Edges.Generator import lite_llm_chat
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.SearchEdge.search_strategy import BaseRetriever


class LLMRetrievalStrategy(BaseRetriever):
    """RAG-based search combining LLM and document retrieval."""

    @global_exception_handler(3403, "Error Parsing Chunks from LLM Scorer")
    def _safe_parse_response(
        self,
        response: str
    ) -> List[dict]:
        """
        Parses the response string to extract a list of dictionaries.

        :param response: The response string to parse.
        :return: A list of dictionaries.
        """

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

    @global_exception_handler(3404, "Error Retrieving Using LLM Scorer")
    def search(
        self
    ) -> List[Tuple[str, float]]:
        llm_prompt_template = self.extra_configs.get("llm_prompt_template", None) or """
Given the query and a list of documents, evaluate the relevance of the document to the query.
Consider the following aspects:
1. Keyword overlap
2. Semantic similarity in meaning
3. Matching language style and tone
4. Pattern recognition and textual structure
Please provide a relevance score between 0 and 1, with 1 being highly relevant.
Return in the format of a list of dictionaries, where each dictionary contains the document and the relevance score.

Example:
query: "What did the quick brown fox do?"
documents: ["The quick brown fox jumps over the lazy dog."]
Output:
[{ "document": "The quick brown fox jumps over the lazy dog.", "relevance": 0.8 }]
"""
        user_prompt = f"""
Given the query:
{self.query}

And the following documents: 
{self.documents}

Output:
"""

        messages = [
            {"role": "system", "content": llm_prompt_template},
            {"role": "user", "content": user_prompt},
        ]
        response = lite_llm_chat(
            messages=messages,
            model="gpt-4o",
            temperature=0.9,
            max_tokens=1024
        )

        # Parse the response string as a list of dictionaries
        relevances = []
        relevance_dicts = self._safe_parse_response(response)
        for d in relevance_dicts:
            relevance = float(d.get("relevance", 0.0))

            # Apply the threshold if specified
            if self.threshold is None or relevance >= self.threshold:
                relevances.append((d.get("document", ""), relevance))

        relevances = sorted(relevances, key=lambda x: x[1], reverse=True)
        return relevances[:self.top_k]


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    query = "What is the capital of France?"
    documents = ["France is a country in Western Europe.", "Paris is the capital of France."]
    extra_configs = {
        "llm_prompt_template": None
    }

    llm_retrieval = LLMRetrievalStrategy(query, extra_configs, documents, top_k=2, threshold=0.5)
    print(llm_retrieval.search())
