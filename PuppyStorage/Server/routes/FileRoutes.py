import os
import sys
import uuid
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from botocore.exceptions import NoCredentialsError
from botocore.config import Config
from botocore import client
from Utils.PuppyEngineExceptions import PuppyEngineException
from Utils.logger import log_info, log_error
from Utils.config import config

# 创建路由器
file_router = APIRouter(prefix="/file", tags=["file"])

# Initialize the S3 client for Cloudflare R2
s3_client = client(
    's3',
    endpoint_url=config.get("CLOUDFLARE_R2_ENDPOINT"),
    aws_access_key_id=config.get("CLOUDFLARE_R2_ACCESS_KEY_ID"),
    aws_secret_access_key=config.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
    config=Config(signature_version='s3v4')
)

@file_router.get("/generate_presigned_url/{user_id}")
async def generate_presigned_url(
    user_id: str
):
    try:
        URI = str(uuid.uuid4())
        key = f"{user_id}_{URI}"  # Concatenate user_id and task_id
        # Generate a presigned URL using SigV4
        presigned_url = s3_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': os.getenv("CLOUDFLARE_R2_BUCKET"),
                'Key': key
            },
            ExpiresIn=300
        )
        return JSONResponse(content={"presigned_url": presigned_url, "task_id": URI}, status_code=200)
    except NoCredentialsError:
        log_error("Credentials Not Available for Cloudflare R2.")
        return JSONResponse(content={"error": "Credentials Not Available."}, status_code=403)
    except Exception as e:
        log_error(f"Error Generating Presigned URL: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500) 