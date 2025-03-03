import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from Objs.Vector.actions import embedding, delete_collection, embedding_search
from Utils.PuppyEngineExceptions import PuppyEngineException
from Utils.logger import log_info, log_error

# 创建路由器
vector_router = APIRouter(prefix="/vector", tags=["vector"])

@vector_router.post("/embed/{user_id}")
async def embed_chunks(
    request: Request,
    user_id: str
):
    try:
        data = await request.json()
        chunks = data.get("chunks", [])
        chunk_content = [chunk.get("content", "") for chunk in chunks]
        chunk_metadatas = [chunk.get("metadata", {}) for chunk in chunks]
        model = data.get("model", "text-embedding-ada-002")
        vdb_type = data.get("vdb_type", "pgvector")
        create_new = data.get("create_new", True)

        collection_name = embedding(
            chunks=chunk_content,
            model=model,
            vdb_type=vdb_type,
            create_new=create_new,
            metadatas=chunk_metadatas,
        )
        return JSONResponse(content=collection_name, status_code=200)
    except PuppyEngineException as e:
        log_error(f"Embedding Error: {str(e)}")
        return JSONResponse(
            content={"error": str(e)}, 
            status_code=500
        )

@vector_router.delete("/delete/{collection_name}")
async def delete_vdb_collection(
    request: Request,
    collection_name: str
):
    try:
        data = await request.json()
        vdb_type = data.get("vdb_type", "pgvector")
        delete_collection(
            vdb_type=vdb_type,
            collection_name=collection_name
        )
        log_info(f"Successfully Deleted Collection: {collection_name}")
        return JSONResponse(content={"message": "Collection Deleted Successfully"}, status_code=200)
    except PuppyEngineException as e:
        log_error(f"Vector Collection Deletion error: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)
    except Exception as e:
        log_error(f"Unexpected Error in Deleting Vector Collection: {str(e)}")
        return JSONResponse(content={"error": "Internal Server Error"}, status_code=500)

@vector_router.get("/search/{collection_name}")
async def search_vdb_collection(
    request: Request,
    collection_name: str,
):
    try:
        data = await request.json()
        vdb_type = data.get("vdb_type", "pgvector")
        query = data.get("query", "")
        top_k = data.get("top_k", 5)
        threshold = data.get("threshold", None)
        model = data.get("model", "text-embedding-ada-002")
        results = embedding_search(
            query=query,
            collection_name=collection_name,
            vdb_type=vdb_type,
            top_k=top_k,
            threshold=threshold,
            model=model
        )
        return JSONResponse(content=results, status_code=200)
    except PuppyEngineException as e:
        log_error(f"Search Error: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)
    except Exception as e:
        log_error(f"Unexpected Error in Vector Search: {str(e)}")
        return JSONResponse(content={"error": "Internal Server Error"}, status_code=500) 