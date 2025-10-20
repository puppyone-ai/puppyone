"""
E2E tests for Embedder integration with storage backends
"""

import os
import pytest
import requests


@pytest.mark.e2e
def test_embedder_remote_openai():
    """
    E2E test for remote backend with OpenAI-compatible embedder
    
    Uses Ollama's OpenAI-compatible API (/v1/embeddings) with all-minilm model
    This tests:
    - Real embedding computation
    - OpenAI API compatibility
    - Vector store with OpenAI provider
    - Vector search
    """
    base_url = os.environ.get("PUPPYSTORAGE_URL", "http://localhost:8003")
    print(f"\n🧪 Testing remote backend with OpenAI-compatible embedder (Ollama)")
    
    # Health check
    r = requests.get(f"{base_url}/health", timeout=10)
    assert r.status_code == 200
    print("✅ Storage service healthy")
    
    # Auth mocked via wiremock
    headers = {"Authorization": "Bearer token"}
    
    # Store vectors using /embed endpoint with correct format
    print("📝 Storing vectors via /embed endpoint...")
    store_response = requests.post(
        f"{base_url}/embed",
        json={
            "user_id": "test_user_openai_compat",
            "set_name": "test_openai_set",
            "model": "all-minilm",
            "chunks": [
                {
                    "content": "Artificial intelligence and deep learning systems",
                    "metadata": {"category": "AI", "id": "doc1"}
                },
                {
                    "content": "Machine learning algorithms and neural networks",
                    "metadata": {"category": "ML", "id": "doc2"}
                },
                {
                    "content": "Natural language processing and text understanding",
                    "metadata": {"category": "NLP", "id": "doc3"}
                }
            ]
        },
        headers=headers,
        timeout=120
    )
    
    print(f"Store response status: {store_response.status_code}")
    print(f"Store response: {store_response.text[:200]}")
    
    assert store_response.status_code == 200, f"Store failed: {store_response.text}"
    store_data = store_response.json()
    assert "collection_name" in store_data
    collection_name = store_data["collection_name"]
    print(f"✅ Vectors stored successfully in collection: {collection_name}")
    
    # Search vectors
    print("🔍 Searching vectors...")
    search_response = requests.post(
        f"{base_url}/search",
        json={
            "user_id": "test_user_openai_compat",
            "set_name": "test_openai_set",
            "query_text": "deep learning AI",
            "model": "all-minilm",
            "top_k": 3
        },
        headers=headers,
        timeout=120
    )
    
    print(f"Search response status: {search_response.status_code}")
    print(f"Search response: {search_response.text[:200]}")
    
    assert search_response.status_code == 200, f"Search failed: {search_response.text}"
    search_data = search_response.json()
    
    # Verify search results
    assert "results" in search_data or isinstance(search_data, list)
    results = search_data.get("results", search_data)
    assert len(results) > 0, "Search should return results"
    print(f"✅ Found {len(results)} results")
    
    # Verify result structure
    first_result = results[0]
    assert "id" in first_result or "metadata" in first_result
    print(f"✅ OpenAI-compatible E2E test passed!")


@pytest.mark.e2e
def test_embedder_local_ollama():
    """
    E2E test for local backend with Ollama embedder
    
    Uses real Ollama service with all-minilm model (~46MB)
    Tests the complete flow: embedding → store → search
    """
    base_url = os.environ.get("PUPPYSTORAGE_URL", "http://localhost:8002")
    print(f"\n🧪 Testing local backend with Ollama embedder (all-minilm)")
    
    # Health check
    r = requests.get(f"{base_url}/health", timeout=10)
    assert r.status_code == 200
    print("✅ Storage service healthy")
    
    headers = {"Authorization": "Bearer token"}
    
    # Store vectors via /embed endpoint
    print("📝 Storing vectors via /embed endpoint...")
    store_response = requests.post(
        f"{base_url}/embed",
        json={
            "user_id": "test_user_ollama",
            "set_name": "test_ollama_set",
            "model": "all-minilm",
            "chunks": [
                {
                    "content": "Artificial intelligence and machine learning",
                    "metadata": {"topic": "AI", "id": "doc1"}
                },
                {
                    "content": "Natural language processing and text analysis",
                    "metadata": {"topic": "NLP", "id": "doc2"}
                }
            ]
        },
        headers=headers,
        timeout=120  # Ollama may need time for first embedding
    )
    
    print(f"Store response: {store_response.status_code}")
    print(f"Store body: {store_response.text[:200]}")
    assert store_response.status_code == 200, f"Store failed: {store_response.text}"
    store_data = store_response.json()
    assert "collection_name" in store_data
    collection_name = store_data["collection_name"]
    print(f"✅ Vectors stored successfully in collection: {collection_name}")
    
    # Search vectors
    print("🔍 Searching vectors...")
    search_response = requests.post(
        f"{base_url}/search",
        json={
            "user_id": "test_user_ollama",
            "set_name": "test_ollama_set",
            "query_text": "machine learning AI",
            "model": "all-minilm",
            "top_k": 2
        },
        headers=headers,
        timeout=120
    )
    
    print(f"Search response: {search_response.status_code}")
    print(f"Search body: {search_response.text[:200]}")
    assert search_response.status_code == 200, f"Search failed: {search_response.text}"
    
    search_data = search_response.json()
    results = search_data.get("results", search_data)
    assert len(results) > 0, "Should return search results"
    print(f"✅ Found {len(results)} results")
    
    # Verify result structure
    first_result = results[0]
    assert "id" in first_result or "metadata" in first_result
    print(f"✅ Ollama E2E test passed!")

