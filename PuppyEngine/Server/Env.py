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
            task = asyncio.create_task(self._execute_single_edge(edge_id, executor))
            edge_tasks.append((edge_id, task))
        
        # Execute all edges concurrently
        results = {}
        for edge_id, task in edge_tasks:
            try:
                edge_results = await task
                results.update(edge_results)
                
                # 🚀 优化：在EDGE_COMPLETED事件中直接包含结果内容
                # 让前端立即显示结果，后续持久化异步进行
                block_results = {}
                for block_id, content in edge_results.items():
                    block_results[block_id] = {
                        "content": content,
                        "storage_class": "internal"  # 临时标记为internal，实际存储类型在persist后确定
                    }
                
                # Yield EDGE_COMPLETED event with immediate results
                yield {
                    "event_type": "EDGE_COMPLETED",
                    "edge_id": edge_id,
                    "output_blocks": list(edge_results.keys()),
                    "timestamp": datetime.utcnow().isoformat(),
                    # ✨ 新增：直接包含结果内容，让前端立即显示
                    "block_results": block_results
                }
                
                # Track edge usage if callback provided
                if self.edge_usage_callback:
                    await self._track_edge_usage(edge_id)
                    
            except Exception as e:
                log_error(f"Edge {edge_id} execution failed: {str(e)}")
                yield {
                    "event_type": "EDGE_ERROR",
                    "edge_id": edge_id,
                    "error_message": str(e),
                    "error_type": type(e).__name__,
                    "timestamp": datetime.utcnow().isoformat()
                }
                raise
        
        # Update blocks with results and persist before emitting BLOCK_UPDATED
        v1_results = {}
        for block_id, content in results.items():
            block = self.blocks[block_id]
            # Set content so persistence can read from it
            block.set_content(content)

            # Persist block first (may yield STREAM_* events)
            async for event in block.persist(self.storage_client, self.user_info['user_id']):
                yield event

            # Decide payload based on storage class after persist
            storage_class = getattr(block, 'storage_class', 'internal')
            has_external = False
            try:
                has_external = bool(block.has_external_data())
            except Exception:
                has_external = False

            block_event = {
                "event_type": "BLOCK_UPDATED",
                "block_id": block_id,
                "storage_class": storage_class,
                "timestamp": datetime.utcnow().isoformat()
            }

            if storage_class == 'external' or has_external:
                # External storage: do not include raw content
                block_event["external_metadata"] = block.data.get("external_metadata")
                v1_results[block_id] = {
                    "storage_class": storage_class,
                    "external_metadata": block.data.get("external_metadata")
                }
            else:
                # Internal storage: safe to include content
                block_event["content"] = content
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
    
    async def _track_edge_usage(self, edge_id: str):
        """Track edge usage through callback"""
        if self.edge_usage_callback:
            try:
                edge_info = self.edges[edge_id]
                await self.edge_usage_callback(
                    user_id=self.user_info['user_id'],
                    edge_type=edge_info.get('type'),
                    edge_id=edge_id
                )
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