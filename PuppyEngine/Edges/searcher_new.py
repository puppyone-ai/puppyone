# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import sys
import json
import math
import requests
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Tuple, Optional
from duckduckgo_search import DDGS
from transformers import AutoTokenizer
from Edges.Generator import lite_llm_chat
from Edges.ExecuteStorage import StorageServerClient
from Utils.PuppyEngineExceptions import global_exception_handler

# Global Storage Client
StorageClient = StorageServerClient()


### ======= ABSTRACT SEARCH STRATEGY ======= ###
class SearchStrategy(ABC):
    """Abstract base class for search strategies."""

    def __init__(
        self,
        query: str,
        extra_configs: dict = None,
    ):
        self.query = query
        self.extra_configs = extra_configs

    @abstractmethod
    def search(
        self,
        **kwargs
    ) -> List[Any]:
        pass


### ======= SEARCH STRATEGY IMPLEMENTATIONS ======= ###
class WebSearchStrategy(SearchStrategy):
    """Web Search using Google & DuckDuckGo."""

    def search(
        self,
        sub_search_type: str,
    ) -> List[dict]:
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


class LLMSearchStrategy(SearchStrategy):
    """LLM-based search using Perplexity API or DuckDuckGo Chat."""

    def search(
        self,
        sub_search_type: str,
    ) -> List[str]:
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


class ElasticSearchStrategy(SearchStrategy):
    """Elasticsearch-based search."""

    def __init__(
        self,
        query: str,
        extra_configs: dict = None
    ):
        super().__init__(query, extra_configs)
        self.url = os.getenv("ELASTICSEARCH_URL")
        self.api_key = os.getenv("ELASTICSEARCH_API_KEY")
        self.headers = {"Content-Type": "application/json", "Authorization": f"ApiKey {self.api_key}"}

    @global_exception_handler(3504, "Error Searching Using Elastic Search")
    def search(
        self
    ) -> List[dict]:
        index = self.extra_configs.get("index", "")
        url = f"{self.url}/{index}/_search"
        query_dict = {
            "query": {
                "match": {
                    "content": self.extra_configs.get("query", "")
                }
            }
        }
        response = requests.post(url, json=query_dict, headers=self.headers)
        if response.status_code != 200:
            raise ValueError(f"Failed to get search result from Elasticsearch, status code: {response.status_code}")
        return response.json()["hits"]["hits"]

    def bulk_insert_data(
        self
    ) -> dict:
        """
        Inserts multiple documents into Elasticsearch using the bulk API.

        :return: The bulk API response as a dictionary.
        """

        bulk_data = []

        index = self.extra_configs.get("index", "")
        documents = self.extra_configs.get("documents", [])
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
        self
    ):
        """
        Refreshes an Elasticsearch index.

        :return: The response from the Elasticsearch refresh operation.
        """

        url = f"{self.url}/{self.extra_configs.get('index', '')}/_refresh"
        response = requests.post(url, headers=self.headers)
        if response.status_code != 200:

            raise ValueError(f"Failed to refresh index, status code: {response.status_code}")
        return response.json()


### ======= BASE RETRIEVER STRATEGY (COMMON LOGIC) ======= ###
class BaseRetriever(SearchStrategy):
    """Abstract base class for retrievers, containing shared logic."""

    def __init__(
        self,
        query: str,
        extra_configs: dict = None,
        documents: List[str] = None,
        top_k: int = 10,
        threshold: Optional[float] = None
    ):
        super().__init__(query, extra_configs)
        self.documents = documents
        self.top_k = top_k
        self.threshold = threshold

    @abstractmethod
    def search(
        self
    ) -> List[Tuple[str, float]]:
        pass


class VectorRetrievalStrategy(BaseRetriever):
    """Vector-based search using an external Vector Database."""

    def search(
        self
    ) -> List[Tuple[str, float]]:
        return StorageClient.search_embedded_vector(
            collection_name=self.extra_configs.get("collection_name", ""),
            search_configs={
                "query": self.query,
                "model": self.extra_configs.get("model", "text-embedding-ada-002"),
                "vdb_type": self.extra_configs.get("db_type", "pgvector"),
                "top_k": self.top_k,
                "threshold": self.threshold,
            }
        )


class KeywordRetrievalStrategy(BaseRetriever):
    """Keyword-based search using BM25."""

    def __init__(
        self,
        query: str,
        extra_configs: dict = None,
        documents: List[str] = None,
        top_k: int = 5,
        threshold: Optional[float] = None,
    ):
        super().__init__(query, extra_configs, documents, top_k, threshold)
        self.tokenizer = AutoTokenizer.from_pretrained(self.extra_configs.get("model_name", "bert-base-multilingual-cased"))
        self.doc_count = len(self.documents)
        self.tokenized_corpus = [self._tokenize(doc) for doc in self.documents]
        self.avg_doc_len = sum(len(doc) for doc in self.tokenized_corpus) / self.doc_count
        self.inverted_index = self._build_inverted_index()
        self.doc_freq = self._calculate_doc_frequencies()
        self.k1 = 1.5  # BM25 constant
        self.b = 0.75  # BM25 constant

    def _tokenize(
        self,
        text: str
    ) -> List[str]:
        """
        Tokenize a document using the tokenizer.
        
        Args:
            text (str): The document to tokenize.
            
        Returns:
            List[str]: List of tokens.
        """

        return self.tokenizer.tokenize(text)

    def _build_inverted_index(
        self
    ) -> Dict[str, List[int]]:
        """
        Build an inverted index for the corpus.
        
        Returns:
            Dict[str, List[int]]: Dictionary mapping tokens to document indices.
        """

        inverted_index = {}
        for idx, tokens in enumerate(self.tokenized_corpus):
            for token in set(tokens):
                if token not in inverted_index:
                    inverted_index[token] = []
                inverted_index[token].append(idx)
        return inverted_index

    def _calculate_doc_frequencies(
        self
    ) -> Dict[str, int]:
        """
        Calculate document frequencies for all tokens in the corpus.
        
        Returns:
            Dict[str, int]: Dictionary of token and their document frequencies.
        """

        return {token: len(docs) for token, docs in self.inverted_index.items()}

    def _score(
        self,
        query: List[str],
        doc_idx: int
    ) -> float:
        """
        Calculate the BM25 score for a query against a single document.
        
        Args:
            query (List[str]): Tokenized query.
            doc_idx (int): Document index to score against.
            
        Returns:
            float: BM25 score.
        """

        doc_tokens = self.tokenized_corpus[doc_idx]
        doc_len = len(doc_tokens)
        score = 0.0

        for token in query:
            if token not in self.inverted_index:
                continue

            term_freq = doc_tokens.count(token)
            doc_freq = self.doc_freq[token]
            idf = math.log((self.doc_count - doc_freq + 0.5) / (doc_freq + 0.5) + 1)

            numerator = term_freq * (self.k1 + 1)
            denominator = term_freq + self.k1 * (1 - self.b + self.b * (doc_len / self.avg_doc_len))
            score += idf * (numerator / denominator)

        return score

    @global_exception_handler(3402, "Error Retrieving Using BM25 Scorer")
    def search(
        self
    ) -> List[Dict[str, float]]:
        """
        Search the corpus for a given query and return top-k results within the threshold.

        Args:
            query (str): Query string.
            top_k (int): Number of top results to return.
            threshold (float): Minimum score threshold to include a result.

        Returns:
            List[Dict[str, float]]: List of documents with their scores.
        """

        if self.query is None:
            raise ValueError("Query cannot be None.")

        tokenized_query = self._tokenize(self.query)
        raw_scores = []

        # Calculate scores for all documents
        for idx in range(self.doc_count):
            score = self._score(tokenized_query, idx)
            raw_scores.append({"doc_index": idx, "score": score})

        # Normalize scores
        max_score = max(raw_scores, key=lambda x: x["score"])["score"]
        min_score = min(raw_scores, key=lambda x: x["score"])["score"]
        score_range = max_score - min_score

        # Avoid division by zero
        if score_range == 0:
            normalized_scores = [{"doc_index": doc["doc_index"], "score": 1.0} for doc in raw_scores]
        else:
            normalized_scores = [
                {"doc_index": doc["doc_index"], "score": (doc["score"] - min_score) / score_range}
                for doc in raw_scores
            ]

        # Apply threshold if specified
        if self.threshold is not None:
            normalized_scores = [doc for doc in normalized_scores if doc["score"] >= self.threshold]

        # Sort and return top-k results
        return sorted(normalized_scores, key=lambda x: x["score"], reverse=True)[:self.top_k]


class LLMRetrievalStrategy(BaseRetriever):
    """RAG-based search combining LLM and document retrieval."""

    @global_exception_handler(3403, "Error Parsing Chunks from LLM Scorer")
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


### ======= SEARCH CLIENT FACTORY ======= ###
class SearchClient:
    """Factory class for dynamically selecting the appropriate search strategy."""

    @staticmethod
    def create(
        search_type: str,
        query: str,
        extra_configs: dict = None,
        **kwargs
    ) -> List[Any]:
        # search strategies
        search_strategies = {
            "web": WebSearchStrategy,
            "qa": LLMSearchStrategy,
            "elastic": ElasticSearchStrategy,
        }

        # Retrieval strategies
        retrieval_strategies = {
            "vector": VectorRetrievalStrategy,
            "keyword": KeywordRetrievalStrategy,
            "llm": LLMRetrievalStrategy,
        }

        search_type = search_type.lower()

        # Handle search strategies
        if search_type in search_strategies:
            return search_strategies[search_type](query, extra_configs)
        elif search_type in retrieval_strategies:
            documents = kwargs.pop("documents", None)
            top_k = kwargs.pop("top_k", 10)
            threshold = kwargs.pop("threshold", None)

            return retrieval_strategies[search_type](
                query=query,
                extra_configs=extra_configs,
                documents=documents,
                top_k=top_k,
                threshold=threshold
            )

        raise ValueError(f"Unsupported Search Type: {search_type}!")


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    # Web Search Example
    query = "What is the impact of climate change?"
    print(SearchClient.create("web", query, extra_configs={}).search(sub_search_type="google"))
    extra_configs = {
        "ddg_search_type": "text",
        "max_results": 10
    }
    print(SearchClient.create("web", query, extra_configs).search(sub_search_type="ddg"))

    # LLM Search Example
    print(SearchClient.create("qa", query, {"model": "sonar"}).search(sub_search_type="perplexity"))
    print(SearchClient.create("qa", query, {"model": "gpt-4o-mini"}).search(sub_search_type="ddg"))

    # Elasticsearch Example
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
    query = {
        "query": {
            "match": {
                "content": "Elasticsearch"
            }
        }
    }
    extra_configs = {
        "index": "my_index",
        "documents": documents
    }
    client = SearchClient.create("elastic", query, extra_configs)
    client.bulk_insert_data()
    client.refresh_index()
    print(client.search())

    # Keyword Retrieval Example
    query = "What did the fox do?"
    documents = [
        "The quick brown fox jumps over the lazy dog.",
        "A fast brown animal jumps over a sleepy canine.",
        "The sky is blue and the sun is bright.",
        "Blue skies and bright sunshine are beautiful.",
        "The dog is sleeping under the tree."
    ]
    documents = [
        "The quick brown fox jumps over the lazy dog.",
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
        "Hola, cómo estás? Estoy aprendiendo BM25 con Python.",
        "こんにちは、元気ですか？PythonでBM25を学んでいます。",
        "你好，你在做什么？我在用Python学习BM25。"
    ]
    extra_configs = {
        "model_name": "bert-base-multilingual-cased"
    }
    result = SearchClient.create(
        "keyword",
        query,
        extra_configs,
    ).search(
        documents=documents,
        top_k=2,
        threshold=0.5
    )
    print("\nKeyword Search Results:", result)

    # Vector Retrieval Example
    extra_configs = {
        "collection_name": "test_collection",
        "model": "text-embedding-ada-002",
        "db_type": "pgvector",
    }
    result = SearchClient.create(
        "vector",
        query,
        extra_configs,
    ).search(
        documents=documents,
        top_k=2,
        threshold=0.5
    )
    print("\nVector Search Results:", result)

    # LLM Retrieval Example
    extra_configs = {
        "llm_prompt_template": None
    }
    result = SearchClient.create(
        "llm",
        query,
        extra_configs,
    ).search(
        documents=documents,
        top_k=2,
        threshold=0.5
    )
    print("\nLLM Search Results:", result)
