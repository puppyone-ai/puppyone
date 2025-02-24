# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
import sys
import requests
from typing import List
from duckduckgo_search import DDGS
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.SearchEdge.search_strategy import SearchStrategy


class WebSearchStrategy(SearchStrategy):
    """Web Search using Google & DuckDuckGo."""

    def search(
        self,
    ) -> List[dict]:
        """
        Perform a search using the Google or DuckDuckGo API.

        :return: A list of dictionaries.
        """

        sub_search_type = self.extra_configs.get("sub_search_type", "google")
        if sub_search_type == "google":
            return self.google_search()
        elif sub_search_type == "ddg":
            return self.duckduckgo_search()
        raise ValueError(f"Unsupported Web Search Type: {sub_search_type}!")

    @global_exception_handler(3501, "Error Searching Using Google Search")
    def google_search(
        self
    ) -> List[dict]:
        """
        Perform a search using the Google Custom Search API.
        """

        url = "https://www.googleapis.com/customsearch/v1"
        params = {
            "q": self.query,
            "key": os.environ.get("GCP_API_KEY"),
            "cx": os.environ.get("CSE_ID"),
        }

        response = requests.get(url, params=params)
        if response.status_code != 200:
            raise ValueError(f"Failed to get the search result from Google, status code: {response.status_code}")
        return response.json()["items"]

    @global_exception_handler(3502, "Error Searching Using DuckDuckGo Search")
    def duckduckgo_search(
        self
    ) -> List[dict]:
        """
        Perform a search using the DuckDuckGo API.
        
        Supported Search Types:
        - text
        - answers
        - images
        - videos
        - news
        - suggestions
        - translate
        - maps
        """
        ddg_search_type = self.extra_configs.get("ddg_search_type", "text")
        ddg_max_results = self.extra_configs.get("ddg_max_results", 10)
        ddg_extra_configs = self.extra_configs.get("ddg_extra_configs", {})

        match ddg_search_type:
            case "text":
                results = DDGS().text(self.query, max_results=ddg_max_results)
            case "answers":
                results = DDGS().answers(self.query)
            case "images":
                results = DDGS().images(self.query, max_results=ddg_max_results)
            case "videos":
                results = DDGS().videos(self.query, max_results=ddg_max_results)
            case "news":
                results = DDGS().news(self.query, max_results=ddg_max_results)
            case "suggestions":
                results = DDGS().suggestions(self.query)
            case "translate":
                results = DDGS().translate(self.query, **ddg_extra_configs)
            case "maps":
                results = DDGS().maps(self.query, **ddg_extra_configs)
            case _:
                raise ValueError(f"Unsupported Duck Duck Go Search Type: {ddg_search_type}")

        return results


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    query = "What is the impact of climate change?"
    web_search = WebSearchStrategy(query, extra_configs={"sub_search_type": "google"})
    print(web_search.search())
    extra_configs = {
        "ddg_search_type": "text",
        "max_results": 10,
        "sub_search_type": "ddg"
    }
    web_search = WebSearchStrategy(query, extra_configs)
    print(web_search.search())
