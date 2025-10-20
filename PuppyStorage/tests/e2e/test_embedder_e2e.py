"""
E2E tests for Embedder integration with storage backends
"""

import os
import pytest
import requests


@pytest.mark.e2e
def test_embedder_remote_openai():
    """
    E2E test for remote backend with OpenAI embedder (mocked via wiremock)
    
    Tests:
    - Vector store with OpenAI embeddings
    - Vector search
    """
    base_url = os.environ.get("PUPPYSTORAGE_URL", "http://localhost:8003")
    print(f"\n🧪 Testing remote backend with OpenAI embedder (mocked)")
    
    # Health check
    r = requests.get(f"{base_url}/health")
    assert r.status_code == 200
    
    # Auth mocked via wiremock
    headers = {"Authorization": "Bearer token"}
    
    # Store vectors with embedding
    store_response = requests.post(
        f"{base_url}/vectors/store",
        json={
            "user_id": "test_user_embedder",
            "collection_name": "test_embedder_collection",
            "items": [
                {
                    "id": "doc1",
                    "text": "This is a test document about artificial intelligence",
                    "metadata": {"category": "AI"}
                },
                {
                    "id": "doc2", 
                    "text": "Machine learning is a subset of AI",
                    "metadata": {"category": "ML"}
                }
            ],
            "provider": "openai",
            "model": "text-embedding-3-small"
        },
        headers=headers,
        timeout=30
    )
    
    print(f"Store response status: {store_response.status_code}")
    print(f"Store response: {store_response.text[:200]}")
    
    assert store_response.status_code == 200, f"Store failed: {store_response.text}"
    store_data = store_response.json()
    assert "stored" in store_data or "success" in store_data
    
    # Search vectors
    search_response = requests.post(
        f"{base_url}/vectors/search",
        json={
            "user_id": "test_user_embedder",
            "collection_name": "test_embedder_collection",
            "query_text": "artificial intelligence",
            "provider": "openai",
            "model": "text-embedding-3-small",
            "top_k": 2
        },
        headers=headers,
        timeout=30
    )
    
    print(f"Search response status: {search_response.status_code}")
    print(f"Search response: {search_response.text[:200]}")
    
    assert search_response.status_code == 200, f"Search failed: {search_response.text}"
    search_data = search_response.json()
    
    # Verify search results
    assert "results" in search_data or isinstance(search_data, list)
    results = search_data.get("results", search_data)
    assert len(results) > 0, "Search should return results"
    
    # Verify result structure
    first_result = results[0]
    assert "id" in first_result or "metadata" in first_result
    
    print(f"✅ Found {len(results)} results")


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
    
    # Store vectors with Ollama embedding (using lightweight all-minilm model)
    print("📝 Storing vectors with Ollama...")
    store_response = requests.post(
        f"{base_url}/vectors/store",
        json={
            "user_id": "test_user_ollama",
            "collection_name": "test_ollama_collection",
            "items": [
                {
                    "id": "doc1",
                    "text": "Artificial intelligence and machine learning",
                    "metadata": {"topic": "AI"}
                },
                {
                    "id": "doc2",
                    "text": "Natural language processing and text analysis",
                    "metadata": {"topic": "NLP"}
                }
            ],
            "provider": "ollama",
            "model": "all-minilm"
        },
        headers=headers,
        timeout=120  # Ollama may need time for first embedding
    )
    
    print(f"Store response: {store_response.status_code}")
    print(f"Store body: {store_response.text[:200]}")
    assert store_response.status_code == 200, f"Store failed: {store_response.text}"
    print("✅ Vectors stored successfully")
    
    # Search with Ollama
    print("🔍 Searching vectors with Ollama...")
    search_response = requests.post(
        f"{base_url}/vectors/search",
        json={
            "user_id": "test_user_ollama",
            "collection_name": "test_ollama_collection",
            "query_text": "machine learning AI",
            "provider": "ollama",
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

