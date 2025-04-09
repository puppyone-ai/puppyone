import os
import sys
import uuid
import time
import logging
import random
import string
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, Request, Response, UploadFile, File, Form, Query
from fastapi.responses import JSONResponse, StreamingResponse
from utils.puppy_exception import PuppyException, global_exception_handler
from utils.logger import log_info, log_error
from utils.config import config
from storage import S3StorageAdapter, LocalStorageAdapter
from pydantic import BaseModel, Field, validator
from typing import Optional, Dict, Any, Literal

# Create router
file_router = APIRouter(prefix="/file", tags=["file"])
storage_router = APIRouter(prefix="/storage", tags=["storage"])

# 获取存储适配器
storage_adapter = LocalStorageAdapter() if config.get("STORAGE_TYPE") == "local" else S3StorageAdapter()

type_header_mapping = {
    "md": "text/markdown", 
    "markdown": "text/markdown", 
    "text": "text/plain",
    "html": "text/html",
    "css": "text/css",
    "js": "text/javascript",
    "json": "application/json",
    "png": "image/png",
    "jpg": "image/jpeg",
    "gif": "image/gif",
    "svg": "image/svg+xml",
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "mp4": "video/mp4",
    "webm": "video/webm",
    "pdf": "application/pdf",
    "zip": "application/zip",
    "application": "application/octet-stream"
}

def generate_short_id(length: int = 8) -> str:
    """生成指定长度的随机字符串作为短ID"""
    characters = string.ascii_lowercase + string.digits
    return ''.join(random.choice(characters) for _ in range(length))

class FileUrlRequest(BaseModel):
    user_id: str = Field(default="public")
    content_name: str
    content_type: Optional[str] = Field(default=None)

    @validator('content_type')
    def validate_content_type(cls, v, values, **kwargs):
        # 检查是否缺少content_type
        if not v and 'content_type' not in kwargs.get('path_params', {}):
            raise ValueError("缺少必要参数: content_type")
        
        # 检查content_type是否有效
        if v and v not in type_header_mapping:
            raise ValueError(f"不支持的内容类型: {v}")
            
        return v

class FileUrlResponse(BaseModel):
    upload_url: str
    download_url: str
    content_id: str
    content_type_header: str
    expires_at: Dict[str, int]

class FileDeleteRequest(BaseModel):
    user_id: str
    content_id: str
    content_name: str

class FileDeleteResponse(BaseModel):
    message: str
    user_id: str
    content_id: str
    deleted_at: int

class FileUploadResponse(BaseModel):
    message: str
    key: str

@global_exception_handler(error_code=4001, error_message="Failed to generate file URLs")
@file_router.post("/generate_urls/{content_type}")
@file_router.get("/generate_urls")
async def generate_file_urls(request: Request, content_type: str = None):
    try:
        data = await request.json()
        file_request = FileUrlRequest(**data, path_params={'content_type': content_type})
        
        content_type_header = type_header_mapping.get(content_type, "application/octet-stream") if content_type else file_request.content_type or "application/octet-stream"
        
        content_id = generate_short_id()
        key = f"{file_request.user_id}/{content_id}/{file_request.content_name}"
        
        upload_url = storage_adapter.generate_upload_url(key, content_type_header)
        download_url = storage_adapter.generate_download_url(key)
        
        log_info(f"Generated file URLs for user {file_request.user_id}: {key}")
        return FileUrlResponse(
            upload_url=upload_url,
            download_url=download_url,
            content_id=content_id,
            content_type_header=content_type_header,
            expires_at={
                "upload": int(time.time()) + 300,
                "download": int(time.time()) + 86400
            }
        )
    except Exception as e:
        log_error(f"Error generating file URLs: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

@global_exception_handler(error_code=4002, error_message="Failed to delete file")
@storage_router.delete("/delete")
async def delete_file(request: Request):
    try:
        data = await request.json()
        delete_request = FileDeleteRequest(**data)
        
        key = f"{delete_request.user_id}/{delete_request.content_id}/{delete_request.content_name}"
        
        if not storage_adapter.check_file_exists(key):
            log_error(f"文件不存在: {key}")
            return JSONResponse(
                content={"error": f"文件 {delete_request.content_name} 不存在"},
                status_code=404
            )
        
        if storage_adapter.delete_file(key):
            log_info(f"已删除用户 {delete_request.user_id} 的文件: {key}")
            return FileDeleteResponse(
                message=f"已成功删除文件: {delete_request.content_name}",
                user_id=delete_request.user_id,
                content_id=delete_request.content_id,
                deleted_at=int(time.time())
            )
        else:
            return JSONResponse(
                content={"error": "删除文件失败"},
                status_code=500
            )
    except Exception as e:
        log_error(f"删除文件时发生错误: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

@global_exception_handler(error_code=4003, error_message="Failed to upload file")
@storage_router.post("/upload/{temp_id}")
async def upload_file(
    temp_id: str,
    key: str = Query(...),
    content_type: str = Query(...),
    file: UploadFile = File(...)
):
    try:
        file_data = await file.read()
        if storage_adapter.save_file(key, file_data, content_type):
            return FileUploadResponse(
                message="文件上传成功",
                key=key
            )
        else:
            return JSONResponse(
                content={"error": "文件上传失败"},
                status_code=500
            )
    except Exception as e:
        log_error(f"上传文件时发生错误: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

@global_exception_handler(error_code=4004, error_message="Failed to download file")
@storage_router.get("/download/{key:path}")
async def download_file(key: str):
    try:
        file_data, content_type = storage_adapter.get_file(key)
        if file_data is None:
            return JSONResponse(
                content={"error": "文件不存在"},
                status_code=404
            )
        
        return StreamingResponse(
            iter([file_data]),
            media_type=content_type,
            headers={
                "Content-Disposition": f"attachment; filename={os.path.basename(key)}"
            }
        )
    except Exception as e:
        log_error(f"下载文件时发生错误: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

if __name__ == "__main__":
    import asyncio
    import requests
    import json
    import logging
    from datetime import datetime

    # 配置日志
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    logger = logging.getLogger("file_routes_test")

    logger.info("开始测试文件URL生成和上传/下载功能...")
    
    # 测试用例
    test_cases = [
        {"content_type": "text", "content_name": "test_document.txt", "test_content": "这是一个纯文本文档"},
        {"content_type": "json", "content_name": "test_data.json", "test_content": '{"name": "测试", "value": 123}'},
        {"content_type": "html", "content_name": "test_page.html", "test_content": "<html><body><h1>测试页面</h1></body></html>"},
        {"content_type": "md", "content_name": "test_markdown.md", "test_content": "# 测试Markdown\n\n这是一个测试文档。"}
    ]
    
    # 创建模拟请求类
    class MockRequest:
        def __init__(self, data):
            self.data = data
            
        async def json(self):
            return self.data
    
    async def test_file_type(case):
        logger.info(f"\n测试文件类型: {case['content_type']}, 文件名: {case['content_name']}")
        
        try:
            # 创建模拟请求，包含所有必要参数
            request = MockRequest({
                "user_id": f"test_user_{datetime.now().strftime('%Y%m%d%H%M%S')}",
                "content_name": case["content_name"]
            })
            
            # 调用函数并传入路径参数
            result = await generate_file_urls(request=request, content_type=case["content_type"])
            
            # 直接使用 Pydantic 模型的属性
            logger.info(f"成功获取URL! 文件ID: {result.content_id}")
            
            upload_url = result.upload_url
            download_url = result.download_url
            content_type_header = result.content_type_header
            
            # 使用预签名URL上传测试文件
            logger.info(f"上传测试 {case['content_type']} 文件...")
            
            try:
                # 上传时指定正确的编码
                upload_response = requests.put(
                    upload_url,
                    data=case["test_content"].encode('utf-8'),
                    headers={
                        "Content-Type": content_type_header,
                        "Content-Encoding": "utf-8"
                    }
                )
                
                if upload_response.status_code >= 200 and upload_response.status_code < 300:
                    logger.info("文件上传成功!")
                else:
                    logger.error(f"文件上传失败! 状态码: {upload_response.status_code}")
                    logger.error(f"错误信息: {upload_response.text}")
                    return False

            except Exception as e:
                logger.error(f"文件上传失败: {str(e)}")
                return False
            
            # 等待确保上传完成
            logger.info("等待上传完成...")
            await asyncio.sleep(2)
            
            # 下载并验证文件
            logger.info("下载并验证文件...")
            try:
                download_response = requests.get(download_url)
                
                if download_response.status_code != 200:
                    logger.error(f"文件下载失败! 状态码: {download_response.status_code}")
                    logger.error(f"错误信息: {download_response.text}")
                    return False
                    
                # 使用正确的编码解码下载的内容
                downloaded_content = download_response.content.decode('utf-8')
                logger.info("文件下载成功!")
                
                if downloaded_content == case["test_content"]:
                    logger.info("✅ 文件内容验证成功!")
                    return True
                else:
                    logger.error("❌ 文件内容不匹配!")
                    logger.error(f"预期内容: {case['test_content'][:50]}...")
                    logger.error(f"实际内容: {downloaded_content[:50]}...")
                    return False
            except Exception as e:
                logger.error(f"文件下载失败: {str(e)}")
                return False
        except Exception as e:
            logger.error(f"测试过程中发生错误: {str(e)}")
            return False
    
    # 运行所有测试用例
    async def run_tests():
        results = []
        for case in test_cases:
            result = await test_file_type(case)
            results.append((case["content_type"], result))
        
        # 打印摘要
        logger.info("\n====== 测试摘要 ======")
        success_count = 0
        for file_type, result in results:
            status = "✅ 通过" if result else "❌ 失败"
            logger.info(f"{file_type}: {status}")
            if result:
                success_count += 1
        
        logger.info(f"总计: {len(results)} 个测试, {success_count} 个通过, {len(results) - success_count} 个失败")
        
        # 测试文件删除功能
        if success_count > 0:
            logger.info("\n测试文件删除功能...")
            try:
                # 获取第一个成功的测试用例
                successful_case = next((case for case, (_, result) in zip(test_cases, results) if result), None)
                if successful_case:
                    # 创建删除请求
                    delete_request = MockRequest({
                        "user_id": "test_user",
                        "content_id": "test_id",  # 这里需要替换为实际的content_id
                        "content_name": successful_case["content_name"]
                    })
                    
                    # 调用删除函数
                    delete_result = await delete_file(request=delete_request)
                    logger.info(f"删除结果: {delete_result}")
            except Exception as e:
                logger.error(f"测试删除功能时发生错误: {str(e)}")
    
    # 执行测试
    asyncio.run(run_tests())