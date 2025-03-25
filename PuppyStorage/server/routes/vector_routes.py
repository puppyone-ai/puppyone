import os
import sys
import hashlib
# Modify path to ensure correct module imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

# TODO: Maybe only need to use multi-modal embedding in the future?
from objs.vector.embedder import TextEmbedder 
from objs.vector.vector_db_factory import VectorDatabaseFactory

from utils.puppy_exception import PuppyException
from utils.logger import log_info, log_error

# Create router
vector_router = APIRouter(prefix="/vector", tags=["vector"])

def _generate_collection_name(user_id: str, model: str, set_name: str) -> str:
    """
    Private helper function to generate collection name
    
    Args:
        user_id (str): User ID
        model (str): Model name
        set_name (str): Set name
        
    Returns:
        str: Generated collection name
    """
    def hash_and_truncate(text: str, length: int = 8) -> str:
        # Add validation to handle None values
        if text is None:
            text = "default"
        return hashlib.md5(text.encode()).hexdigest()[:length]
    
    # Add validation for all parameters
    user_id = user_id or "default_user"
    model = model or "default_model"
    set_name = set_name or "default_set"
    
    model_hash = hash_and_truncate(model)
    set_hash = hash_and_truncate(set_name)
    return f"{user_id}{model_hash}{set_hash}"

@vector_router.post("/embed")
async def embed(request: Request):
    try:
        data = await request.json()
        chunks = data.get("chunks", [])
        model = data.get("model", "text-embedding-ada-002")
        set_name = data.get("set_name", "default")
        user_id = data.get("user_id", "rose123")
        
        collection_name = _generate_collection_name(user_id, model, set_name)
        
        # 1. Embedding process - completed at the routing layer
        chunks_content = [chunk.get("content", "") for chunk in chunks]
        with TextEmbedder(model_name=model) as embedder:
            vectors = embedder.embed(chunks_content)
            
        # 2. Storage processing - handed to database layer
        vdb_type = data.get("vdb_type", "pgvector")
        vdb = VectorDatabaseFactory.get_database(db_type=vdb_type)
        
        # Pass vector data to database after preparation
        # 传递collection_name参数
        vdb.store_vectors(
            vectors=vectors,
            contents=chunks_content,
            metadata=[c.get("metadata", {}) for c in chunks],
            collection_name=collection_name
        )
        
        return JSONResponse(content={
            "user_id": user_id,
            "model": model,
            "set_name": set_name,
            "collection_name": collection_name
        }, status_code=200)

    except PuppyException as e:
        log_error(f"Embedding Error: {str(e)}")
        return JSONResponse(
            content={"error": str(e)}, 
            status_code=500
        )

@vector_router.delete("/delete")
async def delete_vdb_collection(request: Request):
    try:
        data = await request.json()
        user_id = data.get("user_id")
        model = data.get("model")
        set_name = data.get("set_name")
        vdb_type = data.get("vdb_type", "pgvector")

        collection_name = _generate_collection_name(user_id, model, set_name)

        vdb = VectorDatabaseFactory.get_database(db_type=vdb_type)
        vdb.delete_collection(collection_name)
        
        return JSONResponse(content={
            "message": "Collection Deleted Successfully",
            "user_id": user_id,
            "model": model,
            "set_name": set_name
        }, status_code=200)
    except PuppyException as e:
        log_error(f"Vector Collection Deletion error: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)


@vector_router.get("/search")
async def search_vdb_collection(request: Request):
    try:
        data = await request.json()
        user_id = data.get("user_id", "default_user")
        model = data.get("model", "text-embedding-ada-002")
        set_name = data.get("set_name", "default_set")
        vdb_type = data.get("vdb_type", "pgvector")
        query = data.get("query", "")
        top_k = data.get("top_k", 5)
        threshold = data.get("threshold", None)
        filters = data.get("filters", {})
        metric = data.get("metric", "cosine")

        # Log the parameters for debugging
        log_info(f"Search parameters: user_id={user_id}, model={model}, set_name={set_name}")
        
        collection_name = _generate_collection_name(user_id, model, set_name)

        # 嵌入处理
        with TextEmbedder(model_name=model) as embedder:
            query_vector = embedder.embed([query])[0]

        # 数据库查询
        vdb = VectorDatabaseFactory.get_database(db_type=vdb_type)
        results = vdb.search_vectors(
            collection_name=collection_name,
            query_vector=query_vector,
            top_k=top_k,
            threshold=threshold,
            filters=filters,
            metric=metric
        )

        return JSONResponse(content=results, status_code=200)
    except PuppyException as e:
        log_error(f"Unexpected Error in Vector Search: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

if __name__ == "__main__":
    import asyncio
    import json
    from typing import Dict, Any, Optional
    
    # Create a mock Request class
    query = "What does the fox say?"
    documents = [
        "🎵 Ring-ding-ding-ding-dingeringeding! 🎵",
        "🎵 Wa-pa-pa-pa-pa-pa-pow! 🎵",
        "🎵 Hatee-hatee-hatee-ho! 🎵"
    ]

    class MockRequest:
        def __init__(self, json_data: Dict[str, Any]):
            self._json_data = json_data
            
        async def json(self) -> Dict[str, Any]:
            return self._json_data
    
    # Test embedding API
    async def test_embed():
        print("===== Testing Embedding API =====")
        
        # Prepare test data
        chunks = [{"content": doc, "metadata": {"index": i}} for i, doc in enumerate(documents)]
        data = {
            "chunks": chunks,
            "model": "text-embedding-ada-002",
            "set_name": "fox_song",
            "user_id": "test_user",
            "vdb_type": "pgvector"
        }
        
        # Call API
        mock_request = MockRequest(data)
        response = await embed(request=mock_request)
        print(f"Embedding Response: {response.body.decode()}")
        return json.loads(response.body)["collection_name"]
    
    # Test search API
    async def test_search(collection_name: str):
        print("\n===== Testing Search API =====")
        # Prepare test data
        data = {
            "query": "What does the fox say?",
            "top_k": 3,
            "vdb_type": "pgvector",
            "user_id": "test_user",
            "model": "text-embedding-ada-002",
            "set_name": "fox_song"
        }
        
        # Call API
        mock_request = MockRequest(data)
        response = await search_vdb_collection(request=mock_request)
        print(f"Search Response: {response.body.decode()}")
        return response
    
    # Test delete API
    async def test_delete():
        print("\n===== Testing Delete API =====")
        # Prepare test data
        data = {
            "vdb_type": "pgvector",
            "user_id": "test_user",
            "model": "text-embedding-ada-002",
            "set_name": "fox_song"
        }
        
        # Call API
        mock_request = MockRequest(data)
        response = await delete_vdb_collection(request=mock_request)
        print(f"Delete Response: {response.body.decode()}")
        return response
    
    # Run all tests
    async def run_tests():
        try:
            # Test embedding
            collection_name = await test_embed()
            
            # Test search
            await test_search(collection_name)
            
            # Test delete
            await test_delete()
            
            print("\n===== All Tests Completed =====")
        except Exception as e:
            print(f"Error occurred during tests: {str(e)}")
    
    # Execute tests
    asyncio.run(run_tests())