import os
import sys
import uuid
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

# TODO: Maybe only need to use multi-modal embedding in the future?
from Objs.Vector.embedder import TextEmbedder 
from Objs.Vector.vector_db_factory import VectorDatabaseFactory

from Utils.PuppyEngineExceptions import PuppyEngineException
from Utils.logger import log_info, log_error

# 创建路由器
vector_router = APIRouter(prefix="/vector", tags=["vector"])

@vector_router.post("/embed")
async def embed(request: Request):
    try:
        data = await request.json()
        chunks = data.get("chunks", [])
        model = data.get("model", "text-embedding-ada-002")
        set_name = data.get("set_name", "default")
        user_id = data.get("user_id", "rose123")  # 从JSON获取
        
        # 获取客户端提供的collection_id（如果存在）
        collection_name = f"{set_name}__{model}__{user_id}" # ToDo: Add a mechanism to prevent the case that the seperator is already in the args
        
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
        vdb = VectorDatabaseFactory.get_database(db_type=vdb_type)
        vdb.delete_collection(collection_name)
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
        model = data.get("model", collection_name.split("__")[1]) # This ensure the query vector dimension is consistent with the collection
        filters = data.get("filters", {})
        metric = data.get("metric", "cosine")

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
    except PuppyEngineException as e:
        log_error(f"Search Error: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)
    except Exception as e:
        log_error(f"Unexpected Error in Vector Search: {str(e)}")
        return JSONResponse(content={"error": "Internal Server Error"}, status_code=500) 

if __name__ == "__main__":
    import asyncio
    import json
    from typing import Dict, Any, Optional
    
    # 创建一个模拟Request类
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
    
    # 测试嵌入API
    async def test_embed():
        print("===== 测试嵌入API =====")
        
        # 构建测试数据
        chunks = [{"content": doc, "metadata": {"index": i}} for i, doc in enumerate(documents)]
        data = {
            "chunks": chunks,
            "model": "text-embedding-ada-002",
            "set_name": "fox_song"
        }
        
        # 调用API
        mock_request = MockRequest(data)
        response = await embed(request=mock_request)
        print(f"嵌入响应: {response.body.decode()}")
        collection_name = json.loads(response.body)
        return collection_name
    
    # 测试搜索API
    async def test_search(collection_name: str):
        print("\n===== 测试搜索API =====")
        # 构建测试数据
        data = {
            "query": "What does the fox say?",
            "top_k": 3,
            "vdb_type": "pgvector"
        }
        
        # 调用API
        mock_request = MockRequest(data)
        response = await search_vdb_collection(request=mock_request, collection_name=collection_name)
        print(f"搜索响应: {response.body.decode()}")
        return response
    
    # 测试删除API
    async def test_delete(collection_name: str):
        print("\n===== 测试删除API =====")
        # 构建测试数据
        data = {
            "vdb_type": "pgvector"
        }
        
        # 调用API
        mock_request = MockRequest(data)
        response = await delete_vdb_collection(request=mock_request, collection_name=collection_name)
        print(f"删除响应: {response.body.decode()}")
        return response
    
    # 运行所有测试
    async def run_tests():
        try:
            # 测试嵌入
            collection_name = await test_embed()
            
            # 测试搜索
            await test_search(collection_name)
            
            # 测试删除
            await test_delete(collection_name)
            
            print("\n===== 所有测试完成 =====")
        except Exception as e:
            print(f"测试过程中发生错误: {str(e)}")
    
    # 执行测试
    asyncio.run(run_tests())