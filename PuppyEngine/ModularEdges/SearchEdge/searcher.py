# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import sys
from typing import Dict, Any
from ModularEdges.EdgeFactoryBase import EdgeFactoryBase
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.SearchEdge.web_search import WebSearchStrategy
from ModularEdges.SearchEdge.qa_search import LLMQASearchStrategy
from ModularEdges.SearchEdge.search_strategy import SearchStrategy
from ModularEdges.SearchEdge.llm_retrieval import LLMRetrievalStrategy
from ModularEdges.SearchEdge.elastic_search import ElasticSearchStrategy
from ModularEdges.SearchEdge.vector_search import VectorRetrievalStrategy
from ModularEdges.SearchEdge.keyword_search import KeywordRetrievalStrategy


class SearcherFactory(EdgeFactoryBase):
    """Factory class for dynamically selecting the appropriate search strategy."""

    @staticmethod
    @global_exception_handler(3500, "Error Executing Search Edge")
    def execute(
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> SearchStrategy:
        # search strategies
        search_strategies = {
            "web": WebSearchStrategy,
            "qa": LLMQASearchStrategy,
            "elastic": ElasticSearchStrategy,
        }

        # Retrieval strategies
        retrieval_strategies = {
            "vector": VectorRetrievalStrategy,
            "keyword": KeywordRetrievalStrategy,
            "llm": LLMRetrievalStrategy,
        }

        search_type = init_configs.get("search_type").lower()
        query = init_configs.get("query")
        extra_configs["sub_search_type"] = init_configs.get("sub_search_type").lower()

        # Handle search strategies
        if search_type in search_strategies:
            return search_strategies[search_type](query, extra_configs).search()
        elif search_type in retrieval_strategies:
            documents = extra_configs.pop("documents", None)
            top_k = extra_configs.pop("top_k", 10)
            threshold = extra_configs.pop("threshold", None)

            return retrieval_strategies[search_type](
                query=query,
                extra_configs=extra_configs,
                documents=documents,
                top_k=top_k,
                threshold=threshold
            ).search()

        raise ValueError(f"Unsupported Search Type: {search_type}!")


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    # Web Search Example
    query = "What is the impact of climate change?"
    print(SearcherFactory.execute(init_configs={"query": query, "search_type": "web"}, extra_configs={"sub_search_type": "google"}))
    extra_configs = {
        "ddg_search_type": "text",
        "max_results": 10
    }
    print(SearcherFactory.execute(init_configs={"query": query, "search_type": "web"}, extra_configs={"sub_search_type": "ddg"}))

    # LLM Search Example
    print(SearcherFactory.execute(init_configs={"query": query, "search_type": "qa"}, extra_configs={"model": "sonar", "sub_search_type": "perplexity"}))
    print(SearcherFactory.execute(init_configs={"query": query, "search_type": "qa"}, extra_configs={"model": "gpt-4o-mini", "sub_search_type": "ddg"}))

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
    print(SearcherFactory.execute(init_configs={"query": query, "search_type": "elastic"}, extra_configs=extra_configs))

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
        "model_name": "bert-base-multilingual-cased",
        "documents": documents,
        "top_k": 2,
        "threshold": 0.5
    }
    print("\nKeyword Search Results:", SearcherFactory.execute(init_configs={"query": query, "search_type": "keyword"}, extra_configs=extra_configs))

    # Vector Retrieval Example
    extra_configs = {
        "collection_name": "test_collection",
        "model": "text-embedding-ada-002",
        "db_type": "pgvector",
        "documents": documents,
        "top_k": 2,
        "threshold": 0.5
    }
    print("\nVector Search Results:", SearcherFactory.execute(init_configs={"query": query, "search_type": "vector"}, extra_configs=extra_configs))

    # LLM Retrieval Example
    extra_configs = {
        "llm_prompt_template": None,
        "documents": documents,
        "top_k": 2,
        "threshold": 0.5
    }
    print("\nLLM Search Results:", SearcherFactory.execute(init_configs={"query": query, "search_type": "llm"}, extra_configs=extra_configs))
