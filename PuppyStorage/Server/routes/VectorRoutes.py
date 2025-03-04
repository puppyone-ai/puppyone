import os
import sys
import uuid
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

# TODO: Only need to use multi-modal embedding in the future
from Objs.Vector.Embedder import TextEmbedder 
from Objs.Vector.Vdb.vector_db_factory import VectorDatabaseFactory

from Utils.PuppyEngineExceptions import PuppyEngineException
from Utils.logger import log_info, log_error

# 创建路由器
vector_router = APIRouter(prefix="/vector", tags=["vector"])

@vector_router.post("/embed/{user_id}")
async def embed(
    request: Request,
    user_id: str
    # src_type: str = "text"
):
    try:
        data = await request.json()
        chunks = data.get("chunks", [])
        model = data.get("model", "text-embedding-ada-002")
        
        # 获取客户端提供的collection_id（如果存在）
        collection_id = data.get("collection_id", None)
        
        # 1. Embedding process - completed at the routing layer
        chunks_content = [chunk.get("content", "") for chunk in chunks]
        with TextEmbedder(model_name=model) as embedder:
            vectors = embedder.embed(chunks_content)
            
        # 2. Storage processing - handed to database layer
        vdb_type = data.get("vdb_type", "pgvector")
        vdb = VectorDatabaseFactory.get_database(db_type=vdb_type)
        
        # Pass vector data to database after preparation
        # 传递collection_id参数
        collection_id = vdb.store_vectors(
            vectors=vectors,
            contents=chunks_content,
            metadata=[c.get("metadata", {}) for c in chunks],
            collection_id=collection_id
        )
        
        return JSONResponse(content=collection_id, status_code=200)

    except PuppyEngineException as e:
        log_error(f"Embedding Error: {str(e)}")
        return JSONResponse(
            content={"error": str(e)}, 
            status_code=500
        )

@vector_router.delete("/delete/{collection_id}")
async def delete_vdb_collection(
    request: Request,
    collection_id: str
):
    try:
        data = await request.json()
        vdb_type = data.get("vdb_type", "pgvector")
        vdb = VectorDatabaseFactory.get_database(db_type=vdb_type)
        vdb.clean_vectors(collection_id)
        log_info(f"Successfully Deleted Collection: {collection_id}")

        return JSONResponse(content={"message": "Collection Deleted Successfully"}, status_code=200)
    except PuppyEngineException as e:
        log_error(f"Vector Collection Deletion error: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)
    except Exception as e:
        log_error(f"Unexpected Error in Deleting Vector Collection: {str(e)}")
        return JSONResponse(content={"error": "Internal Server Error"}, status_code=500)

@vector_router.get("/retrieve/{collection_id}")
async def retrieve_vdb_collection(
    request: Request,
    collection_id: str,
):
    try:
        vdb_type = data.get("vdb_type", "pgvector")
        
        


@vector_router.get("/search/{collection_id}")
async def search_vdb_collection(
    request: Request,
    collection_id: str,
):
    try:
        data = await request.json()
        vdb_type = data.get("vdb_type", "pgvector")
        query = data.get("query", "")
        top_k = data.get("top_k", 5)
        threshold = data.get("threshold", None)
        model = data.get("model", "text-embedding-ada-002")
        filters = data.get("filters", {})
        metric = data.get("metric", "cosine")

        # 嵌入处理
        with TextEmbedder(model_name=model) as embedder:
            query_vector = embedder.embed([query])[0]

        # 数据库查询
        vdb = VectorDatabaseFactory.get_database(db_type=vdb_type)
        records = vdb.search_vectors(
            collection_id=collection_id,
            query_vector=query_vector,
            top_k=top_k,
            threshold=threshold,
            filters=filters,
            metric=metric
        )

        return JSONResponse(content=records, status_code=200)
    except PuppyEngineException as e:
        log_error(f"Search Error: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)
    except Exception as e:
        log_error(f"Unexpected Error in Vector Search: {str(e)}")
        return JSONResponse(content={"error": "Internal Server Error"}, status_code=500) 