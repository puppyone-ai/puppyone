import os
import sys
import hashlib
# Modify path to ensure correct module imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, Request, Query
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, conlist, validator
from typing import List, Optional, Dict, Any

# TODO: Maybe only need to use multi-modal embedding in the future?
from vector.embedder import TextEmbedder, ModelRegistry
from vector.vector_db_factory import VectorDatabaseFactory

from utils.puppy_exception import PuppyException, global_exception_handler
from utils.logger import log_info, log_error
from utils.config import config

# Create router
vector_router = APIRouter(prefix="/vector", tags=["vector"])

# 添加获取可用embedding模型的接口
@global_exception_handler(error_code=3004, error_message="Failed to list embedding models")
@vector_router.get("/models")
async def list_embedding_models(provider: Optional[str] = None):
    """
    获取所有可用的嵌入模型列表
    
    Args:
        provider (str, optional): 按提供商筛选模型，例如 'openai', 'huggingface', 'sentencetransformers', 'ollama'
        
    Returns:
        JSON: 包含可用模型和提供商的列表
    """
    try:
        # 获取可用的提供商列表
        available_providers = ModelRegistry.list_available_providers()
        
        # 如果指定了提供商，验证它是否可用
        if provider and provider not in available_providers:
            return JSONResponse(
                content={"error": f"Provider '{provider}' is not available. Available providers: {available_providers}"},
                status_code=400
            )
            
        # 获取模型列表
        models = ModelRegistry.list_models(provider_name=provider)
        
        # 返回结果
        return JSONResponse(content={
            "available_providers": available_providers,
            "models": models,
            "total": len(models),
            "filtered_by_provider": provider
        }, status_code=200)
    except Exception as e:
        log_error(f"Error listing embedding models: {str(e)}")
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

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
    vdb_type: str = Field(default="pgvector" if config.get("STORAGE_TYPE") == "Remote" else None)
    top_k: int = Field(default=5, ge=1)  # 确保 top_k 至少为 1
    threshold: Optional[float] = Field(default=None)
    filters: Optional[Dict[str, Any]] = Field(default_factory=dict)
    metric: str = Field(default="cosine")

    @validator('vdb_type')
    def validate_vdb_type(cls, v, values):
        if config.get("STORAGE_TYPE") == "Local":
            return "chroma"
        return v

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
            embed_request.user_id, 
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
@vector_router.post("/delete/{collection_name}")
@vector_router.post("/delete")
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
        