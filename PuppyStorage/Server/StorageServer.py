import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid
from axiom_py import Client
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from botocore.config import Config
from botocore.exceptions import NoCredentialsError
from boto3 import client
from dotenv import load_dotenv
from Scripts.actions import embedding, delete_index
from Utils.PuppyEngineExceptions import PuppyEngineException

import logging
logging.basicConfig(level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.ERROR)
logger = logging.getLogger(__name__)

# Initialize Axiom client for logging
axiom_client = Client(
    os.getenv("AXIOM_TOKEN"),
    os.getenv("AXIOM_ORG_ID")
)

# Initialize the S3 client for Cloudflare R2
s3_client = client(
    's3',
    endpoint_url=os.getenv("CLOUDFLARE_R2_ENDPOINT"),
    aws_access_key_id=os.getenv("CLOUDFLARE_R2_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
    config=Config(signature_version='s3v4')
)

def log_info(
    message: any
):
    try:
        axiom_client.ingest_events(os.getenv("AXIOM_DATASET"), [{"level": "INFO", "message": message}])
        logger.info(message)
    except Exception as e:
        logger.error(f"Failed to log to Axiom: {e}")

def log_error(
    message: any
):
    try:
        axiom_client.ingest_events(os.getenv("AXIOM_DATASET"), [{"level": "ERROR", "message": message}])
        logger.error(message)
    except Exception as e:
        logger.error(f"Failed to log to Axiom: {e}")

try:
    app = FastAPI()

    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

except PuppyEngineException as e:
    raise
except Exception as e:
    logging.error(f"Server Initialization Error: {str(e)}")
    raise PuppyEngineException(7301, "Server Initialization Error", str(e))

@app.get("/health")
async def health_check():
    try:
        log_info("Health check endpoint accessed!")
        return JSONResponse(content={"status": "healthy"}, status_code=200)
    except Exception as e:
        log_error(f"Health check error: {str(e)}!")
        return JSONResponse(content={"status": "unhealthy", "error": str(e)}, status_code=500)
    
@app.get("/generate_presigned_url/{user_id}")
async def generate_presigned_url(user_id: str):
    try:
        task_id = str(uuid.uuid4())
        key = f"{user_id}_{task_id}"  # Concatenate user_id and task_id
        # Generate a presigned URL using SigV4
        presigned_url = s3_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': os.getenv("CLOUDFLARE_R2_BUCKET"),
                'Key': key
            },
            ExpiresIn=300
        )
        return JSONResponse(content={"presigned_url": presigned_url, "task_id": task_id}, status_code=200)
    except NoCredentialsError:
        log_error("Credentials not available for Cloudflare R2.")
        return JSONResponse(content={"error": "Credentials not available."}, status_code=403)
    except Exception as e:
        log_error(f"Error generating presigned URL: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.post("/index/embed/{user_id}")
async def embed_chunks(request: Request, user_id: str):
    try:
        data = await request.json()
        chunks = data.get("chunks", [])
        model_name = data.get("model_name", "text-embedding-ada-002")
        vdb_configs = data.get("vdb_configs", {})

        collection_name = embedding(
            chunks=chunks,
            model_name=model_name,
            vdb_configs=vdb_configs,
            user_id=user_id
        )
        return JSONResponse(content=collection_name, status_code=200)
    except PuppyEngineException as e:
        log_error(f"Embedding error: {str(e)}")
        return JSONResponse(
            content={"error": str(e)}, 
            status_code=500
        )
    
@app.delete("/index/{index_name}/{vdb_type}")
async def delete_index_endpoint(index_name: str, vdb_type: str):
    try:
        delete_index(vdb_type=vdb_type, index_name=index_name)

        log_info(f"Successfully deleted index: {index_name}")
        return JSONResponse(content= {"message": "Index deleted successfully"}, status_code=200)
    except PuppyEngineException as e:
        log_error(f"Index deletion error: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)
    except Exception as e:
        log_error(f"Unexpected error in delete index endpoint: {str(e)}")
        return JSONResponse(content={"error": "Internal server error"}, status_code=500)


if __name__ == "__main__":
    dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    load_dotenv(dotenv_path, override=True)

    try:
        import asyncio
        from hypercorn.config import Config
        from hypercorn.asyncio import serve

        config = Config()
        config.bind = ["127.0.0.1:8002"]

        asyncio.run(serve(app, config))
    except PuppyEngineException as e:
        raise
    except Exception as e:
        log_error(f"Unexpected Error in Launching Server: {str(e)}")
        raise PuppyEngineException(7000, "Unexpected Error in Launching Server", str(e))
