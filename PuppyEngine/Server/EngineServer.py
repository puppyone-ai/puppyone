import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
import uuid
from threading import Lock
from axiom_py import Client
from collections import defaultdict
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from botocore.config import Config
from botocore.exceptions import NoCredentialsError
from boto3 import client
from Server.WorkFlow import WorkFlow
from Utils.PuppyEngineExceptions import PuppyEngineException

from dotenv import load_dotenv
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path, override=True)

import warnings
warnings.simplefilter("ignore", DeprecationWarning)
warnings.simplefilter("ignore", UserWarning)
warnings.simplefilter("ignore", FutureWarning)

import logging
logging.basicConfig(level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.ERROR)
logger = logging.getLogger(__name__)

# Initialize Axiom client for logging
axiom_client = Client(
    os.getenv("AXIOM_TOKEN"),
    os.getenv("AXIOM_ORG_ID")
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

# Initialize the S3 client for Cloudflare R2
s3_client = client(
    's3',
    endpoint_url=os.getenv("CLOUDFLARE_R2_ENDPOINT"),
    aws_access_key_id=os.getenv("CLOUDFLARE_R2_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
    config=Config(signature_version='s3v4')
)


class DataStore:
    def __init__(
        self
    ):
        self.data_store = defaultdict(lambda: {"blocks": {}, "edges": {}})
        self.lock = Lock()

    def get_data(
        self,
        task_id: str
    ) -> dict:
        with self.lock:
            return self.data_store[task_id]

    def set_data(
        self,
        task_id: str,
        blocks: dict = None,
        edges: dict = None
    ) -> None:
        with self.lock:
            if blocks:
                if isinstance(blocks, str):
                    blocks = json.loads(blocks)
                self.data_store[task_id]["blocks"] = blocks

            if edges:
                if isinstance(edges, str):
                    edges = json.loads(edges)
                self.data_store[task_id]["edges"] = edges

    def set_input(
        self,
        task_id: str,
        blocks: dict
    ) -> None:
        with self.lock:
            # Get existing input blocks
            input_blocks = {
                block_id: block
                for block_id, block in self.data_store[task_id]["blocks"].items()
                if block.get("isInput")
            }
            input_block_ids = set(input_blocks.keys())

            # Verify incoming blocks match input blocks
            incoming_block_ids = set(blocks.keys())
            if incoming_block_ids != input_block_ids:
                raise PuppyEngineException(
                    7302,
                    "Input Block Mismatch",
                    f"Incoming blocks {incoming_block_ids} do not match expected input blocks {input_block_ids}",
                )

            # Update only the input blocks while preserving other blocks
            for block_id, block in self.data_store[task_id]["blocks"].items():
                if block_id in input_block_ids:
                    # Find and replace with the matching incoming block
                    new_block = blocks.get(block_id)
                    block.update(new_block)

    def update_data(
        self,
        task_id: str,
        blocks: dict
    ) -> None:
        with self.lock:
            block_map = self.data_store[task_id]["blocks"]
            for new_block_id, new_block in blocks.items():
                if new_block_id in block_map:
                    block_map[new_block_id] = new_block

            # Update the blocks list
            self.data_store[task_id]["blocks"] = block_map


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

    data_store = DataStore()
    
    # Initialize the workflow
    workflow = WorkFlow()
except PuppyEngineException as e:
    raise
except Exception as e:
    log_error(f"Server Initialization Error: {str(e)}")
    raise PuppyEngineException(6301, "Server Initialization Error", str(e))


@app.get("/health")
async def health_check():
    try:
        log_info("Health check endpoint accessed!")
        return JSONResponse(content={"status": "healthy"}, status_code=200)
    except Exception as e:
        log_error(f"Health check error: {str(e)}!")
        return JSONResponse(content={"status": "unhealthy", "error": str(e)}, status_code=500)

@app.get("/get_data/{task_id}")
async def get_data(
    task_id: str
):
    try:
        def stream_data():
            try:
                workflow.clear_workflow()
                json_data = data_store.get_data(task_id)
                with open("./json_received.json", "w") as file:
                    json.dump(json_data, file, indent=4)
                workflow.config_workflow_json(json_data)

                for intermediate_data in workflow.process_all():
                    intermediate_data = [intermediate_data]
                    yield f"data: {json.dumps({'data': intermediate_data, 'is_complete': False})}\n\n"

                log_info("data: Execution complete")
                yield f"data: {json.dumps({'is_complete': True})}\n\n"
            except Exception as e:
                log_error(f"Error during streaming: {str(e)}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return StreamingResponse(stream_data(), media_type="text/event-stream")
    except PuppyEngineException as e:
        log_error(f"Error Getting Data from Server: {str(e)}")
        raise PuppyEngineException(6100, "Error Getting Data from Server", str(e))
    except Exception as e:
        log_error(f"Server Internal Error: {str(e)}")
        raise PuppyEngineException(6300, "Server Internal Error", str(e))

@app.post("/send_data")
async def send_data(
    request: Request
):
    try:
        data = await request.json()
        task_id = str(uuid.uuid4())
        if data and "blocks" in data and "edges" in data:
            blocks = data.get("blocks", {})
            edges = data.get("edges", {})
            data_store.set_data(task_id, blocks, edges)
            return JSONResponse(content={"data": data, "task_id": task_id}, status_code=200)

        return JSONResponse(content={"error": "Exceptionally got invalid data"}, status_code=400)
    except PuppyEngineException as e:
        log_error(f"Error Sending Data to Server: {str(e)}")
        raise PuppyEngineException(6200, "Error Sending Data to Server", str(e))
    except Exception as e:
        log_error(f"Server Internal Error: {str(e)}")
        raise PuppyEngineException(6300, "Server Internal Error", str(e))
    
@app.get("/generate_presigned_url")
async def generate_presigned_url():
    try:
        task_id = str(uuid.uuid4())
        # Generate a presigned URL using SigV4
        presigned_url = s3_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': os.getenv("CLOUDFLARE_R2_BUCKET"),
                'Key': task_id
            },
            ExpiresIn=300  # URL valid for 5 minutes
        )
        return JSONResponse(content={"presigned_url": presigned_url, "task_id": task_id}, status_code=200)
    except NoCredentialsError:
        log_error("Credentials not available for Cloudflare R2.")
        return JSONResponse(content={"error": "Credentials not available."}, status_code=403)
    except Exception as e:
        log_error(f"Error generating presigned URL: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)


if __name__ == "__main__":
    try:
        # Use Uvicorn for ASGI server
        # import uvicorn
        # uvicorn.run(app, host="127.0.0.1", port=8000)

        # Use Hypercorn for ASGI server
        import hypercorn.asyncio
        import asyncio
        config = hypercorn.Config()
        config.bind = ["127.0.0.1:8001"]
        asyncio.run(hypercorn.asyncio.serve(app, config))
    except PuppyEngineException as e:
        raise
    except Exception as e:
        log_error(f"Unexpected Error in Launching Server: {str(e)}")
        raise PuppyEngineException(6000, "Unexpected Error in Launching Server", str(e))
