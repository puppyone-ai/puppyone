# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
import sys
import json
import requests
from typing import List
from Utils.puppy_exception import global_exception_handler
from ModularEdges.SearchEdge.search_strategy import SearchStrategy


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
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"ApiKey {self.api_key}"
        }

    @global_exception_handler(3504, "Error Searching Using Elastic Search")
    def search(
        self
    ) -> List[dict]:
        """
        Searches for documents in Elasticsearch.

        :return: A list of documents from Elasticsearch.
        """

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


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

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
    elastic_search = ElasticSearchStrategy(query, extra_configs)
    elastic_search.bulk_insert_data()
    elastic_search.refresh_index()
    print(elastic_search.search())
