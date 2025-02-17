# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import sys
from typing import List
from duckduckgo_search import DDGS
from Edges.Generator import lite_llm_chat
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.SearchEdge.search_strategy import SearchStrategy


class LLMQASearchStrategy(SearchStrategy):
    """LLM-based search using Perplexity API or DuckDuckGo Chat."""

    def search(
        self,
    ) -> List[str]:
        """
        Perform a search using the Perplexity API or DuckDuckGo Chat.

        :return: A list of strings.
        """

        sub_search_type = self.extra_configs.get("sub_search_type", "perplexity")
        if sub_search_type == "perplexity":
            return [self.perplexity_search()]
        elif sub_search_type == "ddg":
            return [self.ddg_search()]
        raise ValueError(f"Unsupported LLM Search Type: {sub_search_type}!")

    @global_exception_handler(3503, "Error Searching Using Perplexity Search")
    def perplexity_search(
        self
    ) -> str:
        """
        Perform a search using the Perplexity API.

        Supported Models:
        - sonar-reasoning-pro
        - sonar-reasoning
        - sonar-pro
        - sonar
        """

        messages = [
            {
                "role": "system",
                "content": """
You are an artificial intelligence assistant and you need to engage in a helpful, detailed, polite conversation with a user.
"""
            },
            {
                "role": "user",
                "content": self.query
            },
        ]

        return lite_llm_chat(
            messages=messages,
            api_key=os.environ.get("PERPLEXITY_API_KEY"),
            base_url=os.environ.get("PERPLEXITY_BASE_URL"),
            model=self.extra_configs.get("model", "sonar")
        )

    @global_exception_handler(3502, "Error Searching Using DuckDuckGo Search")
    def ddg_search(
        self
    ) -> str:
        """
        Perform a search using the DuckDuckGo API.

        Supported Models:
        - claude-3-haiku
        - gpt-4o-mini
        - llama-3.1-70b
        - mixtral-8x7b
        """

        return DDGS().chat(self.query, self.extra_configs.get("model", "gpt-4o-mini"))


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    query = "What is the capital of France?"
    extra_configs = {
        "model": "sonar",
        "sub_search_type": "perplexity"
    }
    llm_search = LLMQASearchStrategy(query, extra_configs)
    print(llm_search.search())
    extra_configs = {
        "model": "gpt-4o-mini",
        "sub_search_type": "ddg"
    }
    llm_search = LLMQASearchStrategy(query, extra_configs)
    print(llm_search.search())
