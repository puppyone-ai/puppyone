# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import sys
import json
import requests
from abc import ABC, abstractmethod
from typing import List, Tuple, Optional
from duckduckgo_search import DDGS
from Edges.Retriever import Retriever
from Edges.Generator import lite_llm_chat
from Utils.PuppyEngineExceptions import global_exception_handler


class BaseSearchClient(ABC):
    @abstractmethod
    def search(
        self,
        sub_search_type: str,
        extra_configs: dict
    ) -> List[dict]:
        pass


class WebSearchClient(BaseSearchClient):
    def __init__(
        self, 
        query: str
    ):
        self.query = query

    def search(
        self,
        sub_search_type: str,
        extra_configs: dict
    ) -> List[dict]:
        match sub_search_type:
            case "google":
                return self.google_search()
            case "ddg":
                return self.duckduckgo_search(
                    search_type=extra_configs.get("ddg_search_type", "text"),
                    max_results=extra_configs.get("ddg_max_results", 10),
                    extra_configs=extra_configs.get("ddg_extra_configs", {})
                )
            case "perplexity":
                return [self.perplexity_search(
                    model=extra_configs.get("model", "sonar")
                )]
            case _:
                raise ValueError(f"{sub_search_type} is unsupported for Web Search!")

    
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


    @global_exception_handler(3503, "Error Searching Using Perplexity Search")
    def perplexity_search(
        self,
        model: str 
    ) -> str:
        """
        Perform a search using the Perplexity API.

        Supported Models:
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
                "content": f"{self.query}"
            },
        ]

        response = lite_llm_chat(
            messages=messages,
            api_key=os.environ.get("PERPLEXITY_API_KEY"),
            base_url="https://api.perplexity.ai",
            model=model
        )

        return response



    @global_exception_handler(3502, "Error Searching Using DuckDuckGo Search")
    def duckduckgo_search(
        self,
        search_type: str = "text",
        max_results: int = 10,
        **extra_configs
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

        match search_type:
            case "text":
                results = DDGS().text(self.query, max_results=max_results)
            case "answers":
                results = DDGS().answers(self.query)
            case "images":
                results = DDGS().images(self.query, max_results=max_results)
            case "videos":
                results = DDGS().videos(self.query, max_results=max_results)
            case "news":
                results = DDGS().news(self.query, max_results=max_results)
            case "suggestions":
                results = DDGS().suggestions(self.query)
            case "translate":
                results = DDGS().translate(self.query, **extra_configs)
            case "maps":
                results = DDGS().maps(self.query, **extra_configs)
            case _:
                raise ValueError(f"Unsupported Duck Duck Go Search Type: {search_type}")

        return results


class ElasticsearchClient(BaseSearchClient):
    def __init__(
        self
    ):
        self.url = os.environ.get("ELASTICSEARCH_URL")
        self.api_key = os.environ.get("ELASTICSEARCH_API_KEY")
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"ApiKey {self.api_key}"
        }

    def search(
        self,
        sub_search_type: str,
        extra_configs: dict
    ) -> List[dict]:
        match sub_search_type:
            case "elastic":
                index = extra_configs.get("index", "")
                query = extra_configs.get("query", "")
                query_dict = {
                    "query": {
                        "match": {
                            "content": query
                        }
                    }
                }
                return self.search_data(index, query_dict)
            case _:
                raise ValueError(f"{sub_search_type} is unsupported for Elastic Search!")

    def bulk_insert_data(
        self,
        index: str,
        documents: list
    ) -> dict:
        """
        Inserts multiple documents into Elasticsearch using the bulk API.

        :param index: The name of the Elasticsearch index.
        :param documents: A list of documents where each document is a dict containing the document data and the document_id.
        :return: The bulk API response as a dictionary.
        """

        bulk_data = []

        for doc in documents:
            action = {"index": {"_index": index, "_id": doc.get("document_id")}}
            bulk_data.append(json.dumps(action))
            bulk_data.append(json.dumps(doc.get("document")))

        bulk_payload = "\n".join(bulk_data) + "\n"
        url = f"{self.url}/_bulk"
        response = requests.post(url, headers=self.headers, data=bulk_payload)

        if response.status_code != 200:
            raise ValueError(f"Failed to insert documents into Elasticsearch, status code: {response.status_code}, response: {response.content}")
        return response.json()

    def refresh_index(
        self,
        index: str
    ):
        url = f"{self.url}/{index}/_refresh"
        response = requests.post(url, headers=self.headers)
        if response.status_code != 200:
            raise ValueError(f"Failed to refresh index, status code: {response.status_code}")
        return response.json()

    @global_exception_handler(3504, "Error Searching Using Elastic Search")
    def search_data(
        self,
        index: str,
        query: dict
    ) -> List[dict]:
        url = f"{self.url}/{index}/_search"
        response = requests.post(url, json=query, headers=self.headers)
        if response.status_code != 200:
            raise ValueError(f"Failed to get search result from Elasticsearch, status code: {response.status_code}")
        return response.json()["hits"]["hits"]


class RAGSearchClient(BaseSearchClient):
    def __init__(
        self,
        query: str,
        top_k: int = 10,
        threshold: Optional[float] = None,
    ):
        self.query = query
        self.top_k = top_k
        self.threshold = threshold

    @global_exception_handler(3505, "Error Searching Using RAG Search")
    def search(
        self,
        sub_search_type: str,
        extra_configs: dict
    ) -> List[Tuple[str, float]]:
        """
        Perform a RAG-based search using the Retriever class with different retrieval methods.
        """

        sub_search_type = sub_search_type.lower()
        retriever = Retriever(sub_search_type, extra_configs.get("docs", []))
        if sub_search_type == "vector":
            retrieved_results = retriever.retrieve(
                top_k=self.top_k,
                threshold=self.threshold,
                query=query,
                model=extra_configs.get("model", "text-embedding-ada-002"),
                db_type=extra_configs.get("db_type", "pgvector"),
                collection_name=extra_configs.get("collection_name", "")
            )
        elif sub_search_type == "word":
            retrieved_results = retriever.retrieve(
                top_k=self.top_k,
                threshold=self.threshold,
                query=self.query
            )
        elif sub_search_type == "llm":
            llm_prompt_template = extra_configs.get("llm_prompt_template", None)
            retrieved_results = retriever.retrieve(
                top_k=self.top_k,
                threshold=self.threshold,
                query=self.query,
                llm_prompt_template=llm_prompt_template
            )
        else:
            raise ValueError(f"{sub_search_type} is unsupported for Vector Search!")

        if not extra_configs.get("show_score", False):
            retrieved_results = [result["document"] for result in retrieved_results]

        return retrieved_results


class SearchClientFactory:
    @staticmethod
    @global_exception_handler(3500, "Error Initializing Searching Client")
    def create_search_client(
        search_type: str,
        sub_search_type: str,
        query: str,
        extra_configs: dict = None
    ) -> list:
        search_clients = {
            "web": WebSearchClient,
            "elastic": ElasticsearchClient,
            "rag": lambda q, t, th: RAGSearchClient(q, t, th)
        }
        search_type = search_type.lower()
        search_client_class = search_clients.get(search_type)
        if not search_client_class:
            raise ValueError(f"Unsupported Searching Mode: {search_type}!")

        if search_type == "rag":
            top_k = extra_configs.get("top_k", 10)
            threshold = extra_configs.get("threshold", None)
            extra_configs.pop("top_k", None)
            extra_configs.pop("threshold", None)
            search_engine = search_client_class(query, top_k, threshold)
        else:
            search_engine = search_client_class(query)

        retrieved_results = search_engine.search(sub_search_type, extra_configs)
        return retrieved_results


if __name__ == "__main__":
    # Load environment variables
    from dotenv import load_dotenv
    load_dotenv()

    # Elasticsearch Example
    client = ElasticsearchClient()
    documents = [
        {
            "document_id": "1",
            "document": {
                "title": "Test Document 1",
                "content": "This is the first test document for Elasticsearch."
            }
        },
        {
            "document_id": "2",
            "document": {
                "title": "Test Document 2",
                "content": "This is the second test document for Elasticsearch."
            }
        }
    ]

    insert_response = client.bulk_insert_data(index="my_index", documents=documents)
    client.refresh_index("my_index")
    query = {
        "query": {
            "match": {
                "content": "Elasticsearch"
            }
        }
    }
    search_response = client.search_data(index="my_index", query=query)

    # Create the SearchEngine instance
    query = "What is the impact of climate change?"
    search_engine = WebSearchClient(query)
    print("\nGoogle Search Results:")
    print(search_engine.google_search())
    print("\nDuckDuckGo Search Results:")
    print(search_engine.duckduckgo_search())
    print("\nPerplexity Search Results:")
    print(search_engine.perplexity_search(model="sonar"))

    # RAG-based Search
    print("\nRAG-based Search Results:")
    query = "What did the fox do?"
    documents = [
        "The quick brown fox jumps over the lazy dog.",
        "A fast brown animal jumps over a sleepy canine.",
        "The sky is blue and the sun is bright.",
        "Blue skies and bright sunshine are beautiful.",
        "The dog is sleeping under the tree."
    ]
    rag = RAGSearchClient(query, 3, 0.5)
    extra_configs = {
        "provider": "huggingface",
        "model": "distilbert-base-uncased",
        "db_type": "pinecone",
        "db_name": "test_collection",
        "index_name": "test_index"
    }
    print(rag.search("vector", extra_configs))

    # Word Search
    print("\nWord Search Results:")
    query = "fox"
    chunks = [
        "The quick brown fox jumps over the lazy dog.",
        "A fast brown animal jumps over a sleepy canine.",
        "The sky is blue and the sun is bright.",
        "Blue skies and bright sunshine are beautiful.",
        "The dog is sleeping under the tree."
    ]
    print(rag.search("word", {}))
