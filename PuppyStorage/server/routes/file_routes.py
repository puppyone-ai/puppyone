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

# 仅配置 boto3 日志，不修改全局设置
boto3_logger = logging.getLogger('boto3')
boto3_logger.setLevel(logging.WARNING)  # 只记录警告和错误
botocore_logger = logging.getLogger('botocore')
botocore_logger.setLevel(logging.WARNING)  # 只记录警告和错误

# Create router
file_router = APIRouter(prefix="/file", tags=["file"])
storage_router = APIRouter(prefix="/storage", tags=["storage"])

# 获取存储适配器
storage_adapter = S3StorageAdapter() if config.get("STORAGE_TYPE", "S3") == "S3" else LocalStorageAdapter()

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

@global_exception_handler(error_code=4001, error_message="Failed to generate file URLs")
@file_router.post("/generate_urls/{content_type}")
@file_router.get("/generate_urls")
async def generate_file_urls(request: Request, content_type: str = None):
    try:
        data = await request.json()
        user_id = data.get("user_id", "Rose123")
        content_name = data.get("content_name", "new_content")
        
        # 修改为在获取不到值时抛出 ValueError
        if content_type and content_type not in type_header_mapping:
            raise ValueError(f"不支持的内容类型: {content_type}")
        
        content_type_header = type_header_mapping.get(content_type, "application/octet-stream") if content_type else data.get("content_type", "application/octet-stream")
        
        # 如果从 data 中获取 content_type 也不存在，抛出异常
        if not content_type and "content_type" not in data:
            raise ValueError("缺少必要参数: content_type")
        
        content_id = generate_short_id()  # 使用短ID替代UUID
        key = f"{user_id}/{content_id}/{content_name}"
        
        upload_url = storage_adapter.generate_upload_url(key, content_type_header)
        download_url = storage_adapter.generate_download_url(key)
        
        log_info(f"Generated file URLs for user {user_id}: {key}")
        return JSONResponse(
            content={
                "upload_url": upload_url,
                "download_url": download_url,
                "content_id": content_id,
                "content_type_header": content_type_header,
                "expires_at": {
                    "upload": int(time.time()) + 300,
                    "download": int(time.time()) + 86400
                }
            }, 
            status_code=200
        )
    except Exception as e:
        log_error(f"Error generating file URLs: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

@global_exception_handler(error_code=4002, error_message="Failed to delete file")
@storage_router.delete("/delete")
async def delete_file(request: Request):
    try:
        data = await request.json()
        user_id = data.get("user_id")
        content_id = data.get("content_id")
        content_name = data.get("content_name")
        
        if not all([user_id, content_id, content_name]):
            missing_params = [param for param, value in 
                            {"user_id": user_id, "content_id": content_id, "content_name": content_name}.items() 
                            if not value]
            log_error(f"删除文件时缺少必要参数: {', '.join(missing_params)}")
            return JSONResponse(
                content={"error": f"缺少必要参数: {', '.join(missing_params)}"},
                status_code=400
            )
        
        key = f"{user_id}/{content_id}/{content_name}"
        
        if not storage_adapter.check_file_exists(key):
            log_error(f"文件不存在: {key}")
            return JSONResponse(
                content={"error": f"文件 {content_name} 不存在"},
                status_code=404
            )
        
        if storage_adapter.delete_file(key):
            log_info(f"已删除用户 {user_id} 的文件: {key}")
            return JSONResponse(
                content={
                    "message": f"已成功删除文件: {content_name}",
                    "user_id": user_id,
                    "content_id": content_id,
                    "deleted_at": int(time.time())
                },
                status_code=200
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
            return JSONResponse(
                content={"message": "文件上传成功", "key": key},
                status_code=200
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

    print("Starting direct test of file URL generation function...")
    
    # Test multiple file types
    test_cases = [
        {"content_type": "text", "content_name": "test_document.txt", "test_content": "This is a plain text document"},
        {"content_type": "json", "content_name": "test_data.json", "test_content": '{"name": "Test", "value": 123}'},
        {"content_type": "html", "content_name": "test_page.html", "test_content": "<html><body><h1>Test Page</h1></body></html>"}
    ]
    
    # Create a mock request class
    class MockRequest:
        def __init__(self, data):
            self.data = data
            
        async def json(self):
            return self.data
    
    async def test_file_type(case):
        print(f"\nTesting file type: {case['content_type']}, filename: {case['content_name']}")
        
        # Create mock request with all required parameters
        request = MockRequest({
            "user_id": "test_user",
            "content_name": case["content_name"]
        })
        
        # Call the function with path parameter
        result = await generate_file_urls(request=request, content_type=case["content_type"])
        
        # Extract content from JSONResponse
        content = result.body.decode()
        data = json.loads(content)
        
        print(f"Successfully obtained URLs! File ID: {data['content_id']}")
        
        upload_url = data["upload_url"]
        download_url = data["download_url"]
        content_type_header = data["content_type_header"]
        
        # Upload test file using the presigned URL
        print(f"Uploading test {case['content_type']} file...")
        
        try:
            upload_response = requests.put(
                upload_url,
                data=case["test_content"].encode('utf-8'),
                headers={"Content-Type": content_type_header}
            )
            
            if upload_response.status_code >= 200 and upload_response.status_code < 300:
                print("File uploaded successfully!")
            else:
                print(f"File upload failed! Status code: {upload_response.status_code}")
                print(f"Error message: {upload_response.text}")

        except Exception as e:
            print(f"File upload failed: {str(e)}")
        
        # Wait to ensure upload completes
        time.sleep(1)
        
        # Download and verify file
        print("Downloading and verifying file...")
        try:
            download_response = requests.get(download_url)
            
            if download_response.status_code != 200:
                print(f"File download failed! Status code: {download_response.status_code}")
                return False
                
            downloaded_content = download_response.text
            print(f"File downloaded successfully!")
            
            if downloaded_content == case["test_content"]:
                print("✅ File content verification successful!")
                return True
            else:
                print("❌ File content mismatch!")
                return False
        except Exception as e:
            print(f"File download failed: {str(e)}")
            return False
    
    # Run all test cases
    async def run_tests():
        results = []
        for case in test_cases:
            result = await test_file_type(case)
            results.append((case["content_type"], result))
        
        # Print summary
        print("\n====== Test Summary ======")
        for file_type, result in results:
            status = "✅ PASSED" if result else "❌ FAILED"
            print(f"{file_type}: {status}")
    
    # Execute tests
    asyncio.run(run_tests())