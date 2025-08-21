# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
import sys
from typing import List
from duckduckgo_search import DDGS
from ModularEdges.LLMEdge.llm_edge import remote_llm_chat
from Utils.puppy_exception import global_exception_handler
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
                "content": "You are an artificial intelligence assistant and you need to engage in a helpful, detailed, polite conversation with a user."
            },
            {
                "role": "user",
                "content": self.query
            },
        ]

        # Normalize model name: accept UI shorthand and map to valid OpenRouter IDs
        raw_model = self.extra_configs.get("model", "perplexity/sonar")
        model = raw_model if isinstance(raw_model, str) else list(raw_model.keys())[0]

        # Map UI-facing Perplexity online models to OpenRouter-supported IDs
        ui_to_openrouter = {
            "llama-3.1-sonar-small-128k-online": "perplexity/llama-3-sonar-small-32k-online",
            "llama-3.1-sonar-large-128k-online": "perplexity/llama-3-sonar-large-32k-online",
            "llama-3.1-sonar-huge-128k-online": "perplexity/sonar-pro",
        }

        if isinstance(model, str):
            # First, translate UI aliases
            if model in ui_to_openrouter:
                model = ui_to_openrouter[model]
            # Then, prefix plain names like "sonar"/"sonar-pro"
            elif "/" not in model:
                model = f"perplexity/{model}"

        return remote_llm_chat(
            messages=messages,
            # Use OpenRouter credentials for Perplexity via OpenRouter
            api_key=None,
            base_url=None,
            model=model,
            hoster="openrouter"
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
