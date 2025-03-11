import os
import sys
import uuid
import time
import logging
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter,Request
from fastapi.responses import JSONResponse
from botocore.exceptions import NoCredentialsError
from botocore.config import Config
from boto3 import client
from Utils.PuppyException import PuppyException
from Utils.logger import log_info, log_error
from Utils.config import config

# 仅配置 boto3 日志，不修改全局设置
boto3_logger = logging.getLogger('boto3')
boto3_logger.setLevel(logging.WARNING)  # 只记录警告和错误
botocore_logger = logging.getLogger('botocore')
botocore_logger.setLevel(logging.WARNING)  # 只记录警告和错误

# Create router
file_router = APIRouter(prefix="/file", tags=["file"])

# Initialize the S3 client for Cloudflare R2
s3_client = client(
    's3',
    endpoint_url=config.get("CLOUDFLARE_R2_ENDPOINT"),
    aws_access_key_id=config.get("CLOUDFLARE_R2_ACCESS_KEY_ID"),
    aws_secret_access_key=config.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
    region_name="auto",
    config=Config(
        signature_version='s3v4',
        retries={'max_attempts': 3},
        connect_timeout=5,
        read_timeout=60
    )
)

# 使用您的自定义日志函数
try:
    # 不使用list_buckets，而是检查特定存储桶
    response = s3_client.head_bucket(Bucket=config.get("CLOUDFLARE_R2_BUCKET"))
    log_info(f"Successfully connected to R2 bucket: {config.get('CLOUDFLARE_R2_BUCKET')}")
except PuppyException as e:
    log_error(f"Error connecting to R2: {e}")
    # 连接错误不会中断服务，API仍将尝试处理请求
    # 但在生产环境中可能需要更严格的错误处理

type_header_mapping = {
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

@file_router.post("/generate_urls/{content_type}")
async def generate_file_urls(request: Request, content_type: str = "text"):
    try:
        data = await request.json()
        user_id = data.get("user_id", "Rose123")
        content_name = data.get("content_name", "new_content")
        content_type_header = type_header_mapping.get(content_type, "application/octet-stream")
        
        # Generate unique identifier for file
        content_id = str(uuid.uuid4())
        
        # Build file storage path
        key = f"{user_id}/{content_id}/{content_name}"
        
        # Generate presigned upload URL
        upload_url = s3_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': config.get("CLOUDFLARE_R2_BUCKET"),
                'Key': key,
                'ContentType': content_type_header 
            },
            ExpiresIn=300  # Upload URL valid for 5 minutes
        )
        
        # Generate presigned download URL
        download_url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': config.get("CLOUDFLARE_R2_BUCKET"),
                'Key': key
            },
            ExpiresIn=86400  # Download URL valid for 24 hours
        )
        
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
    except NoCredentialsError:
        log_error("Failed to get Cloudflare R2 credentials")
        return JSONResponse(content={"error": "Credentials not available"}, status_code=403)
    except PuppyException as e:
        log_error(f"Error generating file URLs: {str(e)}")
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
        
        # Create mock request
        request = MockRequest({"content_name": case["content_name"]})
        
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

        except PuppyException as e:
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
        except PuppyException as e:
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