import os
import sys
import hashlib
# Modify path to ensure correct module imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, conlist
from typing import List, Optional, Dict, Any

# TODO: Maybe only need to use multi-modal embedding in the future?
from objs.vector.embedder import TextEmbedder 
from objs.vector.vector_db_factory import VectorDatabaseFactory

from utils.puppy_exception import PuppyException, global_exception_handler
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

class ChunkModel(BaseModel):
    content: str
    metadata: Dict[str, Any] = Field(default_factory=dict)

class EmbedRequest(BaseModel):
    chunks: conlist(ChunkModel, min_length=1)  # 确保至少有一个chunk
    set_name: str
    model: str = "text-embedding-ada-002"
    user_id: str = "public"
    vdb_type: str = "pgvector"

class DeleteRequest(BaseModel):
    vdb_type: str
    user_id: str
    model: str
    set_name: str

class SearchRequest(BaseModel):
    query: str  # 必需的搜索查询字符串
    set_name: str  # 必需的集合名称
    user_id: str = Field(default="public")  # 使用 Field 确保默认值为字符串
    model: str = Field(default="text-embedding-ada-002")
    vdb_type: str = Field(default="pgvector")
    top_k: int = Field(default=5, ge=1)  # 确保 top_k 至少为 1
    threshold: Optional[float] = Field(default=None)
    filters: Optional[Dict[str, Any]] = Field(default_factory=dict)
    metric: str = Field(default="cosine")

    class Config:
        json_schema_extra = {
            "example": {
                "query": "What does the fox say?",
                "set_name": "songs",
                "user_id": "rose123",
                "model": "text-embedding-ada-002",
                "vdb_type": "pgvector",
                "top_k": 5,
                "threshold": 0.8,
                "filters": {},
                "metric": "cosine"
            }
        }

@global_exception_handler(error_code=3001, error_message="Failed to embed")
@vector_router.post("/embed/{user_id}")
@vector_router.post("/embed")
async def embed(embed_request: EmbedRequest, user_id: str = None):
    try:
        collection_name = _generate_collection_name(
            user_id if user_id is not None else embed_request.user_id, 
            embed_request.model, 
            embed_request.set_name
        )
        
        # 1. Embedding process
        chunks_content = [chunk.content for chunk in embed_request.chunks]
        with TextEmbedder(model_name=embed_request.model) as embedder:
            vectors = embedder.embed(chunks_content)
            
        # 2. Storage processing - handed to database layer
        vdb = VectorDatabaseFactory.get_database(db_type=embed_request.vdb_type)
        
        # Pass vector data to database after preparation
        # 传递collection_name参数
        vdb.store_vectors(
            vectors=vectors,
            contents=chunks_content,
            metadata=[c.metadata for c in embed_request.chunks],
            collection_name=collection_name
        )
        
        return JSONResponse(content={
            "user_id": embed_request.user_id,
            "model": embed_request.model,
            "set_name": embed_request.set_name,
            "collection_name": collection_name
        }, status_code=200)

    except PuppyException as e:
        log_error(f"Embedding Error: {str(e)}")
        return JSONResponse(
            content={"error": str(e)}, 
            status_code=500
        )

@global_exception_handler(error_code=3002, error_message="Failed to delete vector collection")
@vector_router.delete("/delete/{collection_name}")
@vector_router.delete("/delete")
async def delete_vdb_collection(
    delete_request: DeleteRequest,
    collection_name: str = None
):
    try:
        if not collection_name:
            collection_name = _generate_collection_name(
                delete_request.user_id,
                delete_request.model,
                delete_request.set_name
            )
        vdb_type = delete_request.vdb_type
        
        vdb = VectorDatabaseFactory.get_database(db_type=vdb_type)
        vdb.delete_collection(collection_name)
        
        return JSONResponse(content={
            "message": "Collection Deleted Successfully",
            "collection_name": collection_name
        }, status_code=200)
    except PuppyException as e:
        log_error(f"Vector Collection Deletion error: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)


@global_exception_handler(error_code=3003, error_message="Failed to search vector collection")
@vector_router.post("/search/{collection_name}")
@vector_router.post("/search")
async def search_vdb_collection(
    search_request: SearchRequest,
    collection_name: str = None
):
    try:
        if not collection_name:
            collection_name = _generate_collection_name(
                search_request.user_id,
                search_request.model,
                search_request.set_name
            )

        model = search_request.model
        query = search_request.query
        
        # 嵌入处理
        with TextEmbedder(model_name=model) as embedder:
            query_vector = embedder.embed([query])[0]

        # 数据库查询
        vdb = VectorDatabaseFactory.get_database(db_type=search_request.vdb_type)
        results = vdb.search_vectors(
            collection_name=collection_name,
            query_vector=query_vector,
            top_k=search_request.top_k,
            threshold=search_request.threshold,
            filters=search_request.filters,
            metric=search_request.metric
        )
        log_info(f"Search results: {results}")
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
            "user_id": "rose123",
            "vdb_type": "pgvector"
        }
        
        # Call API
        mock_request = MockRequest(data)
        response = await embed(embed_request=mock_request)
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
            "user_id": "rose123",
            "model": "text-embedding-ada-002",
            "set_name": "fox_song"
        }
        
        # Call API
        mock_request = MockRequest(data)
        response = await search_vdb_collection(search_request=mock_request)
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
        response = await delete_vdb_collection(delete_request=mock_request)
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