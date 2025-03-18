import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
import uuid
from threading import Lock
from collections import defaultdict

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse

from Server.WorkFlow import WorkFlow
from Utils.puppy_exception import PuppyException
from Utils.logger import log_info, log_error

class DataStore:
    def __init__(
        self
    ):
        self.data_store = defaultdict(lambda: {
            "blocks": {}, 
            "edges": {},
            "workflow": None  # Add workflow storage
        })
        self.lock = Lock()

    def get_data(
        self,
        task_id: str
    ) -> dict:
        with self.lock:
            return {
                "blocks": self.data_store[task_id]["blocks"],
                "edges": self.data_store[task_id]["edges"]
            }

    def get_workflow(
        self,
        task_id: str
    ) -> WorkFlow:
        """Get workflow object for task"""
        with self.lock:
            return self.data_store.get(task_id, {}).get("workflow")

    def set_workflow(
        self,
        task_id: str,
        workflow: WorkFlow
    ) -> None:
        """Set workflow object for task"""
        with self.lock:
            self.data_store[task_id]["workflow"] = workflow

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
            stored_blocks = self.data_store.get(task_id, {}).get("blocks", {})
            # Get existing input blocks
            input_blocks = {
                block_id: block
                for block_id, block in stored_blocks.items()
                if block.get("isInput")
            }
            input_block_ids = set(input_blocks.keys())

            # Verify incoming blocks match input blocks
            incoming_block_ids = set(blocks.keys())
            if incoming_block_ids != input_block_ids:
                raise PuppyException(
                    7302,
                    "Input Block Mismatch",
                    f"Incoming blocks {incoming_block_ids} do not match expected input blocks {input_block_ids}",
                )

            # Update only the input blocks while preserving other blocks
            for block_id, block in stored_blocks.items():
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
            block_map = self.data_store.get(task_id, {}).get("blocks", {})
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
except PuppyException as e:
    raise
except Exception as e:
    log_error(f"Server Initialization Error: {str(e)}")
    raise PuppyException(6301, "Server Initialization Error", str(e))


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
                workflow = data_store.get_workflow(task_id)
                if not workflow:
                    raise PuppyException(
                        7303,
                        "Workflow Not Found",
                        f"Workflow with task_id {task_id} not found"
                    )

                for yielded_blocks in workflow.process():
                    yield f"data: {json.dumps({'data': yielded_blocks, 'is_complete': False})}\n\n"

                log_info("Execution complete")
                yield f"data: {json.dumps({'is_complete': True})}\n\n"

                # Ensure the thread executor is shutdown before deleting the data store
                if hasattr(workflow, 'thread_executor'):
                    workflow.thread_executor.shutdown(wait=True)

                # Delete the data store resource
                with data_store.lock:
                    if task_id in data_store.data_store:
                        del data_store.data_store[task_id]
            except Exception as e:
                log_error(f"Error during streaming: {str(e)}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return StreamingResponse(stream_data(), media_type="text/event-stream")
    except PuppyException as e:
        log_error(f"Error Getting Data from Server: {str(e)}")
        raise PuppyException(6100, "Error Getting Data from Server", str(e))
    except Exception as e:
        log_error(f"Server Internal Error: {str(e)}")
        raise PuppyException(6300, "Server Internal Error", str(e))

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
            data_store.set_workflow(task_id, WorkFlow(data))  # Store workflow in DataStore
            return JSONResponse(content={"data": data, "task_id": task_id}, status_code=200)

        return JSONResponse(content={"error": "Exceptionally got invalid data"}, status_code=400)
    except PuppyException as e:
        log_error(f"Error Sending Data to Server: {str(e)}")
        raise PuppyException(6200, "Error Sending Data to Server", str(e))
    except Exception as e:
        log_error(f"Server Internal Error: {str(e)}")
        raise PuppyException(6300, "Server Internal Error", str(e))


if __name__ == "__main__":
    try:
        # Use Hypercorn for ASGI server
        import asyncio
        import hypercorn.asyncio
        config = hypercorn.Config()
        config.bind = ["127.0.0.1:8001"]
        asyncio.run(hypercorn.asyncio.serve(app, config))
    except PuppyException as e:
        raise
    except Exception as e:
        log_error(f"Unexpected Error in Launching Server: {str(e)}")
        raise PuppyException(6000, "Unexpected Error in Launching Server", str(e))
