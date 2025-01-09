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
from Scripts.actions import embedding, delete_collection, embedding_search
from Utils.PuppyEngineExceptions import PuppyEngineException

from dotenv import load_dotenv
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path, override=True)

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
        log_info("Health Check Accessed!")
        return JSONResponse(content={"status": "healthy"}, status_code=200)
    except Exception as e:
        log_error(f"Health Check Error: {str(e)}!")
        return JSONResponse(content={"status": "unhealthy", "error": str(e)}, status_code=500)

@app.get("/generate_presigned_url/{user_id}")
async def generate_presigned_url(
    user_id: str
):
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
        log_error("Credentials Not Available for Cloudflare R2.")
        return JSONResponse(content={"error": "Credentials Not Available."}, status_code=403)
    except Exception as e:
        log_error(f"Error Generating Presigned URL: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.post("/vector/embed/{user_id}")
async def embed_chunks(
    request: Request,
    user_id: str
):
    try:
        json_data = await request.json()
        data = json_data.get("data", {})
        chunks = data.get("chunks", [])
        chunk_documents = [chunk.get("content", "") for chunk in chunks]
        metadatas = [chunk.get("metadata", {}) for chunk in chunks]
        model = data.get("model", "text-embedding-ada-002")
        vdb_type = data.get("vdb_type", "pgvector")
        create_new = data.get("create_new", True)

        log_info(f"Embedding request data - user_id: {user_id}, chunks: {chunks}, model: {model}, vdb_type: {vdb_type}, create_new: {create_new}")

        collection_name = embedding(
            chunks=chunk_documents,
            model=model,
            vdb_type=vdb_type,
            create_new=create_new,
            metadatas=metadatas,
            user_id=user_id
        )
        return JSONResponse(content=collection_name, status_code=200)
    except PuppyEngineException as e:
        log_error(f"Embedding Error: {str(e)}")
        return JSONResponse(
            content={"error": str(e)}, 
            status_code=500
        )

@app.delete("/vector/delete/{collection_name}")
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

@app.get("/vector/search/{collection_name}")
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


if __name__ == "__main__":
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
