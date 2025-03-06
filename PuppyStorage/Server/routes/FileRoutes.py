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
from Utils.PuppyEngineExceptions import PuppyEngineException
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
    response = s3_client.list_buckets()
    log_info(f"Successfully connected to R2, available buckets: {[b['Name'] for b in response.get('Buckets', [])]}")
except Exception as e:
    log_error(f"Error connecting to R2: {e}")

@file_router.post("/generate_urls")
async def generate_file_urls(request: Request):
    try:
        data = await request.json()
        user_id = data.get("user_id", "Rose123")
        content_name = data.get("content_name")
        content_type = data.get("content_type", "application/octet-stream")
        
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
                'ContentType': content_type 
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
                "content_type": content_type,
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
    except Exception as e:
        log_error(f"Error generating file URLs: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)
    

if __name__ == "__main__":

    import asyncio
    import requests

    print("Starting direct test of file URL generation function...")
    
    content_name = "test_file.txt"
    content_type = "text/plain"
    
    # 创建一个模拟的请求对象
    class MockRequest:
        async def json(self):
            return {
                "content_name": content_name,
                "content_type": content_type
            }
    
    # Call the async function directly
    print(f"Calling generate_file_urls function, filename: {content_name}")
    request = MockRequest()
    result = asyncio.run(generate_file_urls(request=request))
    
    # Extract content from JSONRespons
    content = result.body.decode()
    import json
    data = json.loads(content)
    
    print(f"Successfully obtained URLs! File ID: {data['content_id']}")
    
    upload_url = data["upload_url"]
    download_url = data["download_url"]
    content_type = data["content_type"]
    
    # Upload test file using the presigned URL
    print("Uploading test file...")
    test_content = f"This is a file uploaded through direct testing, created at {time.strftime('%Y-%m-%d %H:%M:%S')}"
    
    try:
        upload_response = requests.put(
            upload_url,
            data=test_content.encode('utf-8'),
            headers={"Content-Type": content_type}
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
    
    # Download and verify file using the presigned URL
    print("Downloading and verifying file...")
    try:
        download_response = requests.get(download_url)
        
        if download_response.status_code != 200:
            print(f"File download failed! Status code: {download_response.status_code}")
            
        downloaded_content = download_response.text
        print(f"File downloaded successfully! Content: {downloaded_content}")
        
        if downloaded_content == test_content:
            print("File content verification successful! Test completed ✅")
        else:
            print("File content mismatch! Test failed ❌")
    except Exception as e:
        print(f"File download failed: {str(e)}")