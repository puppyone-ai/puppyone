"""
Execution Environment (Env)

This module defines the Env class, which represents a single workflow execution context.
It manages blocks, edges, and orchestrates the execution with concurrent prefetching.
"""

import asyncio
import os
import shutil
import uuid
from typing import Dict, Set, List, Any, AsyncGenerator, Optional, Tuple
from datetime import datetime
import traceback

from Blocks.BlockFactory import BlockFactory
from Blocks.BaseBlock import BaseBlock
from Server.ExecutionPlanner import ExecutionPlanner
from ModularEdges.EdgeExecutor import EdgeExecutor
from Utils.logger import log_info, log_error, log_warning, log_debug
from Utils.puppy_exception import PuppyException


class Env:
    """
    Execution Environment for a single workflow run
    
    This class represents an isolated execution context that:
    - Manages its own blocks and edges
    - Handles concurrent prefetching
    - Executes edges with just-in-time input resolution
    - Yields events during execution
    """
    
    def __init__(self, env_id: str, workflow_json: Dict[str, Any], user_info: Dict[str, Any], storage_client: Any):
        """
        Initialize an execution environment
        
        Args:
            env_id: Unique identifier for this environment
            workflow_json: The workflow definition
            user_info: User information for this execution
            storage_client: Client for external storage operations
        """
        self.id = env_id
        self.user_info = user_info
        self.storage_client = storage_client
        self.start_time = datetime.utcnow()
        
        # Create blocks using BlockFactory
        self.blocks = BlockFactory.create_blocks_from_workflow(workflow_json)
        
        # Extract edges
        self.edges = workflow_json.get('edges', {})
        
        # Create execution planner
        self.planner = ExecutionPlanner(self.blocks, self.edges)
        
        # Prefetch task tracking
        self.prefetch_tasks = {}
        
        # Edge usage callback (optional)
        self.edge_usage_callback = None
        
        log_info(f"Env {env_id} initialized with {len(self.blocks)} blocks and {len(self.edges)} edges")
    
    def set_edge_usage_callback(self, callback):
        """Set callback for edge usage tracking"""
        self.edge_usage_callback = callback
    
    async def run(self) -> AsyncGenerator[Dict, None]:
        """
        Execute the workflow with concurrent prefetching
        
        Yields:
            Dict: Events during execution (block results, stream events, etc.)
        """
        try:
            # Yield TASK_STARTED event (v2 naming)
            yield {
                "event_type": "TASK_STARTED",
                "env_id": self.id,
                "timestamp": self.start_time.isoformat(),
                "total_blocks": len(self.blocks),
                "total_edges": len(self.edges)
            }
            
            # Start concurrent prefetching for all external blocks
            await self._start_prefetching()
            
            # Main execution loop
            while not self.planner.is_complete():
                # Get next batch of executable edges
                batch_edges = self.planner.get_next_executable_batch()
                
                if not batch_edges:
                    # No edges ready, check if we're stuck
                    if self._is_stuck():
                        raise PuppyException("Workflow execution stuck - no executable edges found")
                    
                    # Wait a bit before checking again
                    await asyncio.sleep(0.1)
                    continue
                
                # Get required input blocks for this batch
                input_blocks = self.planner.get_inputs_for_batch(batch_edges)
                
                # Await necessary prefetch tasks
                await self._await_prefetch_tasks(input_blocks)
                
                # Execute the batch
                async for event in self._execute_edge_batch(batch_edges):
                    yield event
                
                # Yield progress update
                progress = self.planner.get_progress()
                yield {
                    "event_type": "PROGRESS_UPDATE",
                    "env_id": self.id,
                    "progress": progress,
                    "timestamp": datetime.utcnow().isoformat()
                }
            
            # Yield TASK_COMPLETED event (v2 naming)
            progress = self.planner.get_progress()
            yield {
                "event_type": "TASK_COMPLETED",
                "env_id": self.id,
                "timestamp": datetime.utcnow().isoformat(),
                "duration": (datetime.utcnow() - self.start_time).total_seconds(),
                "total_blocks_processed": progress["blocks"]["processed"],
                "total_edges_completed": progress["edges"]["completed"]
            }
            
        except Exception as e:
            log_error(f"Env {self.id} execution failed: {str(e)}")
            # No workflow-level usage event; usage is tracked per edge
            yield {
                "event_type": "TASK_FAILED",
                "env_id": self.id,
                "error_message": str(e),
                "error_type": type(e).__name__,
                "traceback": traceback.format_exc(),
                "timestamp": datetime.utcnow().isoformat()
            }
            raise
        finally:
            # Best-effort cleanup of any local temp directories created during prefetch
            try:
                for block in self.blocks.values():
                    external_meta = block.data.get('external_metadata') or {}
                    local_dir = external_meta.get('local_dir')
                    if local_dir and os.path.isdir(local_dir):
                        try:
                            shutil.rmtree(local_dir, ignore_errors=True)
                            log_debug(f"Cleaned up local dir for block {block.id}: {local_dir}")
                        except Exception as ce:
                            log_warning(f"Failed to cleanup local dir {local_dir}: {ce}")
            except Exception as ce:
                log_warning(f"Env {self.id} cleanup encountered an error: {ce}")
    
    async def _start_prefetching(self):
        """Start concurrent prefetching for all external blocks"""
        prefetch_candidates = self.planner.get_all_prefetch_candidates()
        
        for block_id in prefetch_candidates:
            block = self.blocks[block_id]
            # Create prefetch task
            task = asyncio.create_task(self._prefetch_block(block))
            self.prefetch_tasks[block_id] = task
            
        if prefetch_candidates:
            log_info(f"Started {len(prefetch_candidates)} prefetch tasks")
    
    async def _prefetch_block(self, block: BaseBlock):
        """Prefetch a single block"""
        try:
            log_debug(f"Prefetching block {block.id}")
            await block.resolve(self.storage_client)
            # After resolving, the block might now be considered processed
            # if it has content. Let's update the planner.
            if block.get_content() is not None and block.is_resolved:
                self.planner.mark_blocks_processed({block.id})
                log_debug(f"Block {block.id} marked as processed after prefetching.")
            log_debug(f"Successfully prefetched block {block.id}")
        except Exception as e:
            log_error(f"Failed to prefetch block {block.id}: {str(e)}")
            raise
    
    async def _await_prefetch_tasks(self, block_ids: Set[str]):
        """Await specific prefetch tasks that are needed"""
        tasks_to_await = []
        
        for block_id in block_ids:
            if block_id in self.prefetch_tasks:
                task = self.prefetch_tasks.pop(block_id)
                if not task.done():
                    tasks_to_await.append(task)
        
        if tasks_to_await:
            log_debug(f"Awaiting {len(tasks_to_await)} prefetch tasks")
            await asyncio.gather(*tasks_to_await)
    
    async def _execute_edge_batch(self, edge_ids: Set[str]) -> AsyncGenerator[Dict, None]:
        """Execute a batch of edges"""
        # Mark edges as processing
        self.planner.mark_edges_processing(edge_ids)
        
        # Yield EDGE_STARTED events for each edge
        for edge_id in edge_ids:
            yield {
                "event_type": "EDGE_STARTED",
                "edge_id": edge_id,
                "edge_type": self.edges[edge_id].get("type"),
                "timestamp": datetime.utcnow().isoformat()
            }
        
        # Prepare edge execution tasks
        edge_tasks = []
        edge_start_times: Dict[str, float] = {}
        for edge_id in edge_ids:
            edge_info = self.edges[edge_id]
            block_configs = self._prepare_block_configs(edge_id)
            
            # Create edge executor
            executor = EdgeExecutor(
                edge_type=edge_info.get("type"),
                edge_configs=edge_info.get("data", {}),
                block_configs=block_configs
            )
            
            # Create execution task
            # Record start time for execution duration calculation
            try:
                from time import perf_counter  # local import to avoid global namespace pollution
            except Exception:
                perf_counter = None  # type: ignore
            if perf_counter:
                edge_start_times[edge_id] = perf_counter()
            task = asyncio.create_task(self._execute_single_edge(edge_id, executor))
            edge_tasks.append((edge_id, task))
        
        # Execute all edges concurrently
        results = {}
        for edge_id, task in edge_tasks:
            try:
                edge_results = await task
                results.update(edge_results)
                
                # Yield EDGE_COMPLETED event
                yield {
                    "event_type": "EDGE_COMPLETED",
                    "edge_id": edge_id,
                    "output_blocks": list(edge_results.keys()),
                    "timestamp": datetime.utcnow().isoformat()
                }
                
                # Track edge usage if callback provided
                if self.edge_usage_callback:
                    # Compute execution time if possible
                    execution_time = None
                    try:
                        from time import perf_counter
                        if edge_id in edge_start_times:
                            execution_time = max(0.0, perf_counter() - edge_start_times.get(edge_id, 0.0))
                    except Exception:
                        execution_time = None
                    await self._track_edge_usage(edge_id, execution_success=True, execution_time=execution_time)
                    
            except Exception as e:
                log_error(f"Edge {edge_id} execution failed: {str(e)}")
                yield {
                    "event_type": "EDGE_ERROR",
                    "edge_id": edge_id,
                    "error_message": str(e),
                    "error_type": type(e).__name__,
                    "timestamp": datetime.utcnow().isoformat()
                }
                # Track failed edge usage event (amount=0 on consumer side)
                if self.edge_usage_callback:
                    execution_time = None
                    try:
                        from time import perf_counter
                        if edge_id in edge_start_times:
                            execution_time = max(0.0, perf_counter() - edge_start_times.get(edge_id, 0.0))
                    except Exception:
                        execution_time = None
                    # Build structured error info for downstream debug collection (will be filtered by policy)
                    error_text = str(e) if e else ""
                    # Attempt to extract error category like [PUPPYENGINE_ERROR_XXXX]
                    error_category = None
                    try:
                        import re
                        m = re.search(r"\[(?P<code>[A-Z_0-9]+)\]", error_text)
                        if m:
                            error_category = m.group("code")
                    except Exception:
                        error_category = None
                    # Truncate message to a safe length for debug mode; policy will filter as needed
                    MAX_MSG = 256
                    truncated_msg = error_text[:MAX_MSG]
                    error_info = {
                        "has_error": True,
                        "error_type": type(e).__name__,
                        "error_category": error_category or "engine_execution",
                        "error_message": truncated_msg,
                    }
                    await self._track_edge_usage(
                        edge_id,
                        execution_success=False,
                        execution_time=execution_time,
                        error_info=error_info
                    )
                raise
        
        # Update blocks with results and persist before emitting BLOCK_UPDATED
        v1_results = {}
        for block_id, content in results.items():
            block = self.blocks[block_id]
            # Set content so persistence can read from it
            block.set_content(content)

            # Determine storage strategy based on content length (1024 characters threshold)
            content_length = 0
            if content is not None:
                if isinstance(content, str):
                    content_length = len(content)
                elif isinstance(content, (list, dict)):
                    # For structured data, convert to JSON string to measure length
                    import json
                    try:
                        content_length = len(json.dumps(content, ensure_ascii=False))
                    except:
                        content_length = 0
                elif isinstance(content, bytes):
                    content_length = len(content)
                else:
                    # For other types, try to convert to string
                    try:
                        content_length = len(str(content))
                    except:
                        content_length = 0

            # Dynamic storage strategy decision
            storage_threshold = int(os.getenv("STORAGE_CHUNK_SIZE", "1024"))
            use_external_storage = content_length >= storage_threshold
            
            if use_external_storage:
                # Force external storage for long content
                block.storage_class = 'external'
                # Persist block first (may yield STREAM_* events)
                async for event in block.persist(self.storage_client, self.user_info['user_id']):
                    yield event
                
                # External storage: do not include raw content
                block_event = {
                    "event_type": "BLOCK_UPDATED",
                    "block_id": block_id,
                    "storage_class": "external",
                    "external_metadata": block.data.get("external_metadata"),
                    "timestamp": datetime.utcnow().isoformat()
                }
                v1_results[block_id] = {
                    "storage_class": "external",
                    "external_metadata": block.data.get("external_metadata")
                }
            else:
                # Force internal storage for short content
                block.storage_class = 'internal'
                # For internal storage, we don't need to persist to external storage
                block.is_persisted = True
                
                # Internal storage: include complete content in event
                block_event = {
                    "event_type": "BLOCK_UPDATED",
                    "block_id": block_id,
                    "storage_class": "internal",
                    "content": content,
                    "timestamp": datetime.utcnow().isoformat()
                }
                v1_results[block_id] = content

            # Emit BLOCK_UPDATED after persist completes
            yield block_event
        
        # Mark edges as completed and blocks as processed
        self.planner.mark_edges_completed(edge_ids)
        self.planner.mark_blocks_processed(set(results.keys()))
        
        # Yield batch result
        yield {
            "event_type": "BATCH_COMPLETED",
            "edge_ids": list(edge_ids),
            "output_blocks": list(results.keys()),
            "timestamp": datetime.utcnow().isoformat()
        }
        
        # Yield block results for backward compatibility
        yield {
            "data": v1_results,
            "is_complete": False,
            "yield_count": len(results)
        }
    
    async def _execute_single_edge(self, edge_id: str, executor: EdgeExecutor) -> Dict[str, Any]:
        """Execute a single edge in a thread"""
        log_info(f"Executing edge {edge_id}")
        
        # EdgeExecutor.execute is synchronous, so run in thread
        loop = asyncio.get_event_loop()
        edge_task = await loop.run_in_executor(None, executor.execute)
        
        # Extract result from EdgeTask
        if edge_task.error:
            raise edge_task.error
        
        # Map edge result to output blocks
        edge_result = edge_task.result
        results = {}
        
        # Get output block IDs for this edge
        output_block_ids = self.planner.edge_to_outputs_mapping.get(edge_id, set())
        
        # Handle different edge types
        edge_type = self.edges.get(edge_id, {}).get("type")
        
        if edge_type == "ifelse" and isinstance(edge_result, dict):
            # For ifelse edges, result is already a dict of block_id -> content
            for block_id, content in edge_result.items():
                if block_id in output_block_ids:
                    results[block_id] = content
        else:
            # For other edges, assign result to all output blocks
            for block_id in output_block_ids:
                results[block_id] = edge_result
                log_info(f"Block {block_id} updated with result type: {type(edge_result)}")
        
        return results
    
    def _prepare_block_configs(self, edge_id: str) -> Dict[str, Any]:
        """Prepare block configurations for edge execution"""
        # Get input blocks for this edge
        input_block_ids = self.planner.edge_to_inputs_mapping.get(edge_id, set())
        block_configs = {}
        
        # Despite the type annotation, EdgeConfigParser actually expects a dict
        for block_id in input_block_ids:
            block = self.blocks.get(block_id)
            if block:
                block_configs[block_id] = {
                    "label": block.label,
                    "content": block.get_content(),
                    "embedding_view": [],  # Not used in new architecture
                    "looped": False,  # Not used in new architecture
                    "collection_configs": {}  # Not used in new architecture
                }
        
        return block_configs
    
    async def _track_edge_usage(self, edge_id: str, execution_success: bool, execution_time: Optional[float] = None, error_info: Optional[Dict[str, Any]] = None):
        """Track edge usage through callback"""
        if self.edge_usage_callback:
            try:
                edge_info = self.edges[edge_id]
                edge_metadata = {
                    "task_id": self.id,
                    "edge_id": edge_id,
                    "edge_type": edge_info.get('type'),
                    "execution_time": execution_time if execution_time is not None else 0.0,
                    "execution_success": execution_success,
                }
                if error_info:
                    edge_metadata["error_info"] = error_info
                await self.edge_usage_callback(edge_metadata)
            except Exception as e:
                log_warning(f"Failed to track edge usage: {str(e)}")
    
    def _is_stuck(self) -> bool:
        """Check if execution is stuck (no progress possible)"""
        # If there are still pending edges and no processing edges, we might be stuck
        progress = self.planner.get_progress()
        return (progress['edges']['pending'] > 0 and 
                progress['edges']['processing'] == 0 and
                len(self.prefetch_tasks) == 0)
    
    def get_status(self) -> Dict[str, Any]:
        """Get current environment status"""
        progress = self.planner.get_progress()
        return {
            "env_id": self.id,
            "status": "running" if not self.planner.is_complete() else "completed",
            "start_time": self.start_time.isoformat(),
            "duration": (datetime.utcnow() - self.start_time).total_seconds(),
            "progress": progress,
            "active_prefetch_tasks": len(self.prefetch_tasks)
        }