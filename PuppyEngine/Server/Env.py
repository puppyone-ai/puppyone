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
from Blocks.BlockNormalization import normalize_block_content
from Server.ExecutionPlanner import ExecutionPlanner
from ModularEdges.EdgeExecutor import EdgeExecutor
from Server.HybridStoragePolicy import HybridStoragePolicy
from Server.BlockUpdateService import BlockUpdateService
from Server.EdgeResultMapper import EdgeResultMapper
from Server.EventFactory import EventFactory
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

    def __init__(
        self,
        env_id: str,
        workflow_json: Dict[str, Any],
        user_info: Dict[str, Any],
        storage_client: Any,
    ):
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
        self.edges = workflow_json.get("edges", {})

        # Create execution planner
        self.planner = ExecutionPlanner(self.blocks, self.edges)

        # Initialize service components
        self.storage_policy = HybridStoragePolicy()
        self.block_update_service = BlockUpdateService(self.storage_policy)
        self.edge_result_mapper = EdgeResultMapper(
            self.edges, self.planner.edge_to_outputs_mapping
        )

        # Prefetch task tracking
        self.prefetch_tasks = {}

        # Edge usage callback (optional)
        self.edge_usage_callback = None

        log_info(
            f"Env {env_id} initialized with {len(self.blocks)} blocks and {len(self.edges)} edges"
        )

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
            yield EventFactory.create_task_started_event(
                self.id, self.start_time, len(self.blocks), len(self.edges)
            )

            # Start concurrent prefetching for all external blocks
            await self._start_prefetching()

            # Main execution loop
            while not self.planner.is_complete():
                # Get next batch of executable edges
                batch_edges = self.planner.get_next_executable_batch()

                if not batch_edges:
                    # No edges ready, check if we're stuck
                    if self._is_stuck():
                        # Log detailed debugging information
                        block_states_summary = {
                            bid: {
                                "state": state,
                                "has_content": self.blocks[bid].get_content() is not None,
                                "storage_class": getattr(self.blocks[bid], 'storage_class', 'unknown'),
                                "is_resolved": getattr(self.blocks[bid], 'is_resolved', False)
                            }
                            for bid, state in self.planner.block_states.items()
                        }
                        log_info(f"[DEBUG] Block states: {block_states_summary}")
                        log_info(f"[DEBUG] Edge states: {self.planner.edge_states}")
                        log_info(f"[DEBUG] Edge to inputs mapping: {self.planner.edge_to_inputs_mapping}")
                        
                        raise PuppyException(
                            6100,
                            "Workflow execution stuck",
                            "No executable edges found - workflow may have circular dependencies or missing inputs"
                        )

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
                yield EventFactory.create_progress_update_event(self.id, progress)

            # Yield TASK_COMPLETED event (v2 naming)
            progress = self.planner.get_progress()
            yield EventFactory.create_task_completed_event(
                self.id,
                self.start_time,
                progress["blocks"]["processed"],
                progress["edges"]["completed"],
            )

        except Exception as e:
            log_error(f"Env {self.id} execution failed: {str(e)}")
            # No workflow-level usage event; usage is tracked per edge
            yield EventFactory.create_task_failed_event(self.id, e)
            raise
        finally:
            # Best-effort cleanup of any local temp directories created during prefetch
            try:
                for block in self.blocks.values():
                    external_meta = block.data.get("external_metadata") or {}
                    local_dir = external_meta.get("local_dir")
                    if local_dir and os.path.isdir(local_dir):
                        try:
                            shutil.rmtree(local_dir, ignore_errors=True)
                            log_debug(
                                f"Cleaned up local dir for block {block.id}: {local_dir}"
                            )
                        except Exception as ce:
                            log_warning(
                                f"Failed to cleanup local dir {local_dir}: {ce}"
                            )
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

    async def _execute_edge_batch(
        self, edge_ids: Set[str]
    ) -> AsyncGenerator[Dict, None]:
        """Execute a batch of edges"""
        # Mark edges as processing
        self.planner.mark_edges_processing(edge_ids)

        # Yield EDGE_STARTED events for each edge
        for edge_id in edge_ids:
            edge_type = self.edge_result_mapper.get_edge_type(edge_id)
            yield EventFactory.create_edge_started_event(edge_id, edge_type)

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
                block_configs=block_configs,
            )

            # Create execution task
            # Record start time for execution duration calculation
            try:
                from time import (
                    perf_counter,
                )  # local import to avoid global namespace pollution
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
                yield EventFactory.create_edge_completed_event(
                    edge_id, list(edge_results.keys())
                )

                # Track edge usage if callback provided
                if self.edge_usage_callback:
                    # Compute execution time if possible
                    execution_time = None
                    try:
                        from time import perf_counter

                        if edge_id in edge_start_times:
                            execution_time = max(
                                0.0, perf_counter() - edge_start_times.get(edge_id, 0.0)
                            )
                    except Exception:
                        execution_time = None
                    await self._track_edge_usage(
                        edge_id, execution_success=True, execution_time=execution_time
                    )

            except Exception as e:
                log_error(f"Edge {edge_id} execution failed: {str(e)}")
                yield EventFactory.create_edge_error_event(edge_id, e)
                # Track failed edge usage event (amount=0 on consumer side)
                if self.edge_usage_callback:
                    execution_time = None
                    try:
                        from time import perf_counter

                        if edge_id in edge_start_times:
                            execution_time = max(
                                0.0, perf_counter() - edge_start_times.get(edge_id, 0.0)
                            )
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
                        error_info=error_info,
                    )
                raise

        # Update blocks with results using BlockUpdateService
        v1_results = {}
        async for event in self.block_update_service.update_blocks_with_results(
            self.blocks, results, self.storage_client, self.user_info["user_id"]
        ):
            if "v1_results" in event:
                v1_results = event["v1_results"]
            else:
                yield event

        # Mark edges as completed and blocks as processed
        self.planner.mark_edges_completed(edge_ids)
        self.planner.mark_blocks_processed(set(results.keys()))

        # Yield batch result
        yield EventFactory.create_batch_completed_event(edge_ids, list(results.keys()))

        # Yield block results for backward compatibility
        yield EventFactory.create_v1_compatibility_event(v1_results)

    async def _execute_single_edge(
        self, edge_id: str, executor: EdgeExecutor
    ) -> Dict[str, Any]:
        """Execute a single edge in a thread"""
        log_info(f"Executing edge {edge_id}")

        # EdgeExecutor.execute is synchronous, so run in thread
        loop = asyncio.get_event_loop()
        edge_task = await loop.run_in_executor(None, executor.execute)

        # Extract result from EdgeTask
        if edge_task.error:
            raise edge_task.error

        # Map edge result to output blocks using EdgeResultMapper
        edge_result = edge_task.result
        results = self.edge_result_mapper.map_edge_result_to_blocks(
            edge_id, edge_result
        )

        return results

    def _prepare_block_configs(self, edge_id: str) -> Dict[str, Any]:
        """
        Prepare block configurations for edge execution
        
        Phase 3.9: Runtime Resolution Support
        - Extracts input blocks (query blocks)
        - Extracts data_source blocks (vector collection blocks) for search edges
        - Includes indexingList for runtime resolution of collection_configs
        """
        # Get input blocks for this edge
        input_block_ids = self.planner.edge_to_inputs_mapping.get(edge_id, set())
        block_configs = {}

        # Extract input blocks
        for block_id in input_block_ids:
            block = self.blocks.get(block_id)
            if block:
                # Preserve the loop control signal from the block metadata (SSOT)
                try:
                    loop_flag = bool(block.data.get("looped", False))
                except Exception:
                    loop_flag = False
                normalized_content = normalize_block_content(block, is_looped=loop_flag)
                block_configs[block_id] = {
                    "label": block.label,
                    "content": normalized_content,
                    "embedding_view": [],  # Not used in new architecture
                    "looped": loop_flag,  # control-flow flag consumed by parsers
                    "collection_configs": {},  # Not used in new architecture
                }

        # Phase 3.9: Extract data_source blocks for vector search edges
        edge_config = self.edges.get(edge_id, {}).get("data", {})
        if edge_config.get("search_type") == "vector":
            data_sources = edge_config.get("data_source", []) or edge_config.get("dataSource", [])
            
            for ds in data_sources:
                ds_block_id = ds.get("id")
                if ds_block_id:
                    block = self.blocks.get(ds_block_id)
                    if block:
                        # Extract indexingList for runtime resolution
                        indexing_list = block.data.get("indexingList", [])
                        
                        # If block already exists (as input block), update it with indexingList
                        # Otherwise, create new entry
                        if ds_block_id in block_configs:
                            block_configs[ds_block_id]["indexingList"] = indexing_list
                        else:
                            block_configs[ds_block_id] = {
                                "label": block.label,
                                "indexingList": indexing_list,  # For runtime resolution
                            }
                        
                        log_debug(
                            f"Extracted indexingList for data_source block {ds_block_id}: "
                            f"{len(indexing_list)} indexed sets"
                        )

        return block_configs

    async def _track_edge_usage(
        self,
        edge_id: str,
        execution_success: bool,
        execution_time: Optional[float] = None,
        error_info: Optional[Dict[str, Any]] = None,
    ):
        """Track edge usage through callback"""
        if self.edge_usage_callback:
            try:
                edge_info = self.edges[edge_id]
                edge_metadata = {
                    "task_id": self.id,
                    "edge_id": edge_id,
                    "edge_type": edge_info.get("type"),
                    "execution_time": (
                        execution_time if execution_time is not None else 0.0
                    ),
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
        return (
            progress["edges"]["pending"] > 0
            and progress["edges"]["processing"] == 0
            and len(self.prefetch_tasks) == 0
        )

    def get_status(self) -> Dict[str, Any]:
        """Get current environment status"""
        progress = self.planner.get_progress()
        return {
            "env_id": self.id,
            "status": "running" if not self.planner.is_complete() else "completed",
            "start_time": self.start_time.isoformat(),
            "duration": (datetime.utcnow() - self.start_time).total_seconds(),
            "progress": progress,
            "active_prefetch_tasks": len(self.prefetch_tasks),
        }
