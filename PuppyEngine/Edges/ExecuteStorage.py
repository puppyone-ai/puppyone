# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import json
import logging
import requests
from typing import List, Dict, Any
from Utils.PuppyEngineExceptions import global_exception_handler


class StorageServerClient:
    def __init__(
        self,
        base_url: str = "http://127.0.0.1:8002"
    ):
        self.base_url = base_url
        self.headers = {
            "Content-Type": "application/json"
        }

    @global_exception_handler(3407, "Error Embedding and Saving Vector")
    def embed_and_save_vector(
        self,
        configs: dict,
        user_id: str
    ) -> Dict[str, Any]:
        url = f"{self.base_url}/vector/embed/{user_id}"
        response = requests.post(
            url,
            data=json.dumps(configs),
            headers=self.headers
        )
        collection_name = response.json()
        logging.info(f"Saved Vector Embeddings in Collection Name: {collection_name}")
        return collection_name

    @global_exception_handler(3408, "Error Deleting Vector Collection")
    def delete_vector_collection(
        self,
        collection_name: str,
        vdb_configs: dict
    ) -> None:
        url = f"{self.base_url}/vector/delete/{collection_name}"
        response = requests.delete(
            url,
            data=json.dumps(vdb_configs),
            headers=self.headers
        )
        response.raise_for_status()
        response_body = response.json()
        message = response_body.get("message", None)
        if message != "Collection Deleted Successfully":
            raise ValueError(f"Error Deleting Vector Collection: {collection_name}")
        logging.info(f"Deleted Vector Collection: {collection_name}")

    @global_exception_handler(3409, "Error Retrieving Similar Vectors")
    def search_embedded_vector(
        self,
        collection_name: str,
        search_configs: dict
    ) -> List[Dict[str, Any]]:
        url = f"{self.base_url}/vector/search/{collection_name}"
        response = requests.get(
            url,
            data=json.dumps(search_configs),
            headers=self.headers
        )
        response.raise_for_status()
        results = response.json()
        logging.info(f"Embedding Search Results: {results}")
        return results


if __name__ == "__main__":
    user_id = "test_user"
    embed_configs = {
        "chunks": [
            {
                "content": "The quick brown fox jumps over the lazy dog.",
                "metadata": {"id": 0, "extra": "metadata"}
            },
            {
                "content": "A fast brown animal jumps over a sleepy canine.",
                "metadata": {"id": 1, "extra": "metadata"}
            },
            {
                "content": "The sky is blue and the sun is bright.",
                "metadata": {"id": 2, "extra": "metadata"}
            },
            {
                "content": "Blue skies and bright sunshine are beautiful.",
                "metadata": {"id": 3, "extra": "metadata"}
            },
            {
                "content": "Blue skies and bright sunshine are beautiful.",
                "metadata": {"id": 4, "extra": "metadata"}
            }
        ],
        "vdb_type": "pgvector",
        "create_new": True,
        "model": "text-embedding-ada-002"
    }
    search_configs = {
        "query": "What did the fox do?",
        "vdb_type": "pgvector",
        "model": "text-embedding-ada-002",
        "top_k": 3,
        "threshold": 0.2
    }
    vdb_configs = {
        "vdb_type": "pgvector",
    }

    storage_client = StorageServerClient()
    collection_name = storage_client.embed_and_save_vector(embed_configs, user_id)
    storage_client.search_embedded_vector(collection_name, search_configs)
    storage_client.delete_vector_collection(collection_name, vdb_configs)
