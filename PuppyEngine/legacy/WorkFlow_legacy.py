# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import warnings
warnings.simplefilter("ignore", DeprecationWarning)
warnings.simplefilter("ignore", UserWarning)
warnings.simplefilter("ignore", FutureWarning)

# 移除标准logging配置，使用自定义日志函数
from Utils.logger import log_info, log_warning, log_error, log_debug

import json
import threading
import concurrent.futures
import asyncio
import anyio
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict, Set, Any, Tuple, Generator, Callable, Optional, AsyncGenerator
from Server.JsonConverter import JsonConverter
from ModularEdges.EdgeExecutor import EdgeExecutor
from Utils.puppy_exception import global_exception_handler, PuppyException
import traceback
from datetime import datetime
from clients.streaming_json_handler import StreamingJSONHandler, StreamingJSONAggregator


"""
Workflow Engine Core Processor

Implements a directed acyclic graph (DAG) based workflow with:
- Blocks as data containers (nodes)
- Edges as processing units (edges)

Key Consumption Logic:
=====================
1. Data Flow Rules:
------------------
• Each block can be consumed by ONLY ONE edge (single consumer guarantee)
• Edges define data transformation pipelines
• Output blocks are immutable once processed

2. State Lifecycle:
------------------
Blocks:
    pending → processed (terminal)
Edges:
    pending → processing → completed (terminal)

3. Execution Constraints:
-------------------------
a) Edge Activation:
    - All input blocks must be "processed"
    - Edge must be in "pending" state
b) Atomic Operations:
    - Edge processing locks its inputs
    - Output generation and state update are atomic

4. Design Guarantees:
---------------------
• No data races: Single consumer per block
• No circular dependencies: DAG enforcement
• At-least-once processing: Edge retries handled at distributor level

Example Execution Flow:
→ Edge1 (inputs: A, B) → Outputs: C
→ Edge2 (input: C)     → Outputs: D
→ Edge3 (input: D)     → Terminal

Edge Processing Contract:
• Input blocks are read-only snapshots
• Output blocks must be new/versioned
• Edge failure triggers rollback to "pending" state
"""

class WorkFlow():
    """
    Workflow Engine Core Processor
    
    Maintains its own data copy and processes workflows independently,
    while being associated with a task_id for tracking purposes.
    
    Class Attributes:
    -----------------
    version : str
        Workflow schema version (default: "0.1")
    type : str
        Processor type identifier (fixed: "workflow")
    
    Instance Attributes:
    --------------------
    blocks : Dict[str, Dict]
        Block registry with structure:
        {
            "<block_id>": {
                "label": str,           # Human-readable identifier
                "type": str,            # Data type (text/structured)
                "data": Dict            # Content storage
            },
            ...
        }
    
    edges : Dict[str, Dict]
        Edge registry with structure:
        {
            "<edge_id>": {
                "type": str,            # Processor type (llm/transform/etc)
                "data": {
                    "messages": List[Dict],  # Instruction templates
                    "inputs": Dict[str, str], # {block_id: template_var_name}
                    "outputs": Dict[str, str] # {block_id: template_var_name}
                    # ... other edge-specific parameters ...
                }
            },
            ...
        }
    
    edge_to_inputs_mapping : Dict[str, Set[str]]
        Edge input mapping: {edge_id: set(input_block_ids)}
    
    edge_to_outputs_mapping : Dict[str, Set[str]]
        Edge output mapping: {edge_id: set(output_block_ids)}
    
    block_states : Dict[str, str]
        Block lifecycle states, possible values:
        - "pending":  Block awaiting processing
        - "processed": Finalized block (immutable)
    
    edge_states : Dict[str, str]
        Edge lifecycle states, possible values:
        - "pending":    Ready for activation
        - "processing": Currently executing
        - "completed":  Successfully finished
    
    Example Input JSON:
    ------------------
    {
        "blocks": {
            "2": {
                "label": "b",
                "type": "structured",
                "data": {
                    "content": "",
                    "embedding_view": []
                }
            },
            "3": {
                "label": "c",
                "type": "text",
                "data": {
                    "content": "puppy"
                }
            }
        },
        "edges": {
            "llm-1727235281399": {
                "type": "llm",
                "data": {
                    "messages": [
                        {"role": "system", "content": "You are a helpful AI assistant that called {{c}}"},
                        {"role": "user", "content": "introduce your self"}
                    ],
                    "inputs": {"3": "c"},
                    "outputs": {"2": "b"}
                }
            }
        },
        "version": "0.1"
    }
    
    Design Invariants:
    ------------------
    1. block_states keys ≡ blocks keys
    2. edge_states keys ≡ edges keys
    3. ∀ edge_id ∈ edges:
       edge_to_inputs_mapping[edge_id] ⊆ blocks
       edge_to_outputs_mapping[edge_id] ⊆ blocks
    """
    
    version: str = "0.1"
    type: str = "workflow"

    @global_exception_handler(5200, "Error Initializing Workflow")
    def __init__(
        self,
        json_data: Dict[str, Dict[str, str]],
        latest_version: str = "0.1",
        step_mode: bool = False,
        task_id: str = None,
        storage_client: Optional[Any] = None
    ):
        """
        Initialize the workflow with its own data copy.
        
        Args:
            json_data: The complete workflow data including blocks and edges
            latest_version: The latest version of the schema 
            step_mode: If True, enable step-by-step execution mode
            task_id: The task ID to associate this workflow with (optional)
            storage_client: Optional storage client for external data operations
        """
        self.step_mode = step_mode
        self.task_id = task_id
        self.storage_client = storage_client
        
        if task_id:
            log_info(f"Creating workflow for task {task_id}")
        
        # Store version information
        self.version = json_data.get("version", self.__class__.version)
        
        # Handle version conversion if needed
        if self.version != latest_version:
            converter = JsonConverter(latest_version)
            json_data = converter.convert(json_data)
        
        # Store workflow data (maintains own copy)
        self.blocks = json_data.get("blocks", {})
        self.edges = json_data.get("edges", {})
        
        # Parse edge connections and validate flow
        self.edge_to_inputs_mapping, self.edge_to_outputs_mapping = self._parse_edge_connections()
        self._validate_single_flow()
        
        # Initialize state tracking
        self.block_states = {bid: "pending" for bid in self.blocks}
        self.edge_states = {eid: "pending" for eid in self.edges}
        
        # Mark source blocks as processed
        initial_processed = set(self.blocks.keys()) - set().union(*self.edge_to_outputs_mapping.values()) if self.edge_to_outputs_mapping else set(self.blocks.keys())
        for bid in initial_processed:
            self.block_states[bid] = "processed"
            log_info(f"Auto-marked source block {bid} as processed")
        
        # Initialize thread resources
        self.max_workers = min(32, (os.cpu_count() or 1) * 4)
        self.thread_executor = ThreadPoolExecutor(max_workers=self.max_workers)
        self.state_lock = threading.Lock()
        
        # 移除异步队列和相关状态
        
        log_info(f"Workflow initialized with {len(self.blocks)} blocks and {len(self.edges)} edges")

    def _validate_single_flow(
        self
    ) -> None:
        """
        Validates that there is only one connected flow in the workflow.
        A flow is a sequence of connected edges through their input/output blocks.
 
        Raises:
            PuppyException: If multiple disconnected flows are detected
        """

        if not self.edges:
            return

        # Build a set of all blocks involved in edges
        all_blocks = set()
        for edge_id in self.edges:
            all_blocks.update(self.edge_to_inputs_mapping[edge_id])
            all_blocks.update(self.edge_to_outputs_mapping[edge_id])

        # Start from any block and traverse the flow
        start_block = next(iter(all_blocks))
        visited_blocks = set()

        # Traverse from start block
        self._traverse_flow(start_block, visited_blocks)

        # If not all blocks were visited, there are disconnected flows
        if visited_blocks != all_blocks:
            unvisited = all_blocks - visited_blocks
            raise PuppyException(
                5204,
                "Multiple Flows Detected",
                f"Found disconnected blocks: {unvisited}. Only one connected flow is allowed."
            )

    def _traverse_flow(
        self,
        block_id: str,
        visited_blocks: Set[str]
    ) -> None:
        """
        Recursively traverse connected blocks through edges
        """

        if block_id in visited_blocks:
            return

        visited_blocks.add(block_id)

        # Find all edges that use this block as input
        for edge_id, input_blocks in self.edge_to_inputs_mapping.items():
            if block_id in input_blocks:
                # Visit all output blocks of this edge
                for output_block in self.edge_to_outputs_mapping[edge_id]:
                    self._traverse_flow(output_block, visited_blocks)

        # Find all edges that use this block as output
        for edge_id, output_blocks in self.edge_to_outputs_mapping.items():
            if block_id in output_blocks:
                # Visit all input blocks of this edge
                for input_block in self.edge_to_inputs_mapping[edge_id]:
                    self._traverse_flow(input_block, visited_blocks)

    def get_processed_blocks(
        self
    ) -> List[str]:
        return [bid for bid, state in self.block_states.items() if state == "processed"]
    
    async def _prefetch_inputs(self) -> List[str]:
        """
        Prefetch external input blocks before processing
        
        This method:
        1. Identifies blocks with storage_class="external"
        2. Downloads their content from storage
        3. Updates the block content in memory
        
        Returns:
            List of block IDs that were prefetched
            
        Raises:
            PuppyException: If prefetch fails for any block
        """
        if not self.storage_client:
            log_info("No storage client available, skipping prefetch")
            return []
        
        prefetched_blocks = []
        
        try:
            for block_id, block_data in self.blocks.items():
                # Check if this is an external block that needs prefetching
                storage_class = block_data.get("storage_class", "internal")
                
                if storage_class == "external" and self.block_states[block_id] == "pending":
                    try:
                        # Check for external_metadata first (new format)
                        external_metadata = block_data.get("data", {}).get("external_metadata")
                        
                        if external_metadata:
                            # New format with external metadata
                            resource_key = external_metadata.get("resource_key", "")
                            is_chunked = external_metadata.get("chunked", False)
                            
                            if is_chunked:
                                # Use prefetch and reconstruct for chunked content
                                log_info(f"Prefetching and reconstructing chunked block {block_id} from {resource_key}")
                                content = await self._prefetch_and_reconstruct(resource_key, external_metadata)
                            else:
                                # Simple prefetch for non-chunked content
                                log_info(f"Prefetching external block {block_id} from {resource_key}")
                                content = await self.storage_client.prefetch_resource(resource_key)
                                
                                # Decode based on content type
                                content_type = external_metadata.get("content_type", "text")
                                if content_type == "text" and isinstance(content, bytes):
                                    content = content.decode('utf-8')
                                elif content_type == "structured" and isinstance(content, bytes):
                                    content = json.loads(content.decode('utf-8'))
                        else:
                            # Legacy format: resource key directly in content
                            resource_key = block_data.get("data", {}).get("content", "")
                            
                            # Skip if content is empty or doesn't look like a resource key
                            if not resource_key or "/" not in resource_key:
                                log_warning(f"Block {block_id} marked as external but has invalid resource key: {resource_key}")
                                continue
                            
                            log_info(f"Prefetching external block {block_id} from {resource_key} (legacy format)")
                            
                            # Download the content
                            content = await self.storage_client.prefetch_resource(resource_key)
                            
                            # Update block content based on type
                            if block_data.get("type") == "text" and isinstance(content, bytes):
                                content = content.decode('utf-8')
                        
                        # Update block content
                        block_data["data"]["content"] = content
                        
                        # Mark as successfully prefetched
                        prefetched_blocks.append(block_id)
                        log_info(f"Successfully prefetched block {block_id}")
                        
                    except Exception as e:
                        log_error(f"Failed to prefetch block {block_id}: {str(e)}")
                        raise PuppyException(
                            5205,
                            "External Block Prefetch Failed",
                            f"Failed to load external block {block_id}: {str(e)}"
                        )
            
            if prefetched_blocks:
                log_info(f"Prefetched {len(prefetched_blocks)} external blocks: {prefetched_blocks}")
            
            return prefetched_blocks
            
        except Exception as e:
            log_error(f"Prefetch operation failed: {str(e)}")
            raise

    @global_exception_handler(5202, "Error Processing Workflow", True)
    def process(self, usage_callback = None) -> Generator[Dict[str, Any], None, None]:
        """
        Process the workflow with concurrent edge execution
        
        Args:
            usage_callback: 可选的usage消费回调函数，每个edge执行成功后会调用
                          函数签名: callback(edge_metadata: dict) -> None
        """
        try:
            log_info(f"Starting workflow processing for task {self.task_id}")
            
            # 处理工作流
            parallel_batch = self._find_parallel_batches()
            batch_count = 0

            while parallel_batch:
                batch_count += 1
                log_info(f"Found parallel batch #{batch_count}: {parallel_batch}")

                if self.step_mode:
                    input(f"\nPress Enter to execute batch #{batch_count}... ")

                # Process the batch and yield its results directly
                for processed_blocks in self._process_batch_results(parallel_batch, usage_callback):
                    yield processed_blocks
                
                # Find the next batch of edges to process
                parallel_batch = self._find_parallel_batches()
            
            log_info(f"Workflow processing completed for task {self.task_id}")
            
        finally:
            # 确保在处理完成后自动清理资源
            self.cleanup_resources()
    
    async def process_streaming(self, storage_client=None, usage_callback=None) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Process workflow with streaming support
        
        This method provides real-time signals about workflow execution,
        including prefetch operations and streaming uploads.
        
        Args:
            storage_client: Storage client for external operations
            usage_callback: Callback for usage tracking
            
        Yields:
            Dict containing signal type and data:
            - {"type": "prefetch_started"}
            - {"type": "prefetch_completed", "blocks": [...]}
            - {"type": "batch_processing", "batch": [...]}
            - {"type": "batch_completed", "outputs": {...}}
            - {"type": "upload_started", "block_id": "..."}
            - {"type": "upload_completed", "block_id": "...", "resource_key": "..."}
            - {"type": "workflow_completed"}
        """
        # Override storage client if provided
        if storage_client:
            self.storage_client = storage_client
        
        try:
            # Step 1: Prefetch external inputs
            yield {"type": "prefetch_started"}
            
            prefetched_blocks = await self._prefetch_inputs()
            
            yield {
                "type": "prefetch_completed",
                "blocks": prefetched_blocks,
                "count": len(prefetched_blocks)
            }
            
            # Step 2: Process workflow batches
            log_info(f"Starting streaming workflow processing for task {self.task_id}")
            
            parallel_batch = self._find_parallel_batches()
            batch_count = 0
            
            while parallel_batch:
                batch_count += 1
                
                yield {
                    "type": "batch_processing",
                    "batch": list(parallel_batch),
                    "batch_number": batch_count
                }
                
                if self.step_mode:
                    # In step mode, we can't use input(), so just log
                    log_info(f"Step mode: Would execute batch #{batch_count}")
                
                # Process batch
                processed_block_ids = self._process_batch_results(parallel_batch, usage_callback)
                processed_blocks = {
                    block_id: self.blocks.get(block_id, {})
                    for block_id in processed_block_ids
                }
                
                # Check for external uploads
                for block_id in processed_block_ids:
                    if self.blocks.get(block_id, {}).get("storage_class") == "external":
                        resource_key = self.blocks[block_id]["data"]["content"]
                        if "/" in str(resource_key):  # It's a resource key
                            yield {
                                "type": "upload_completed",
                                "block_id": block_id,
                                "resource_key": resource_key
                            }
                
                yield {
                    "type": "batch_completed",
                    "outputs": processed_blocks,
                    "batch_number": batch_count
                }
                
                # Find next batch
                parallel_batch = self._find_parallel_batches()
            
            log_info(f"Streaming workflow processing completed for task {self.task_id}")
            
            yield {"type": "workflow_completed", "total_batches": batch_count}
            
        finally:
            # Ensure cleanup
            self.cleanup_resources()

    def cleanup_resources(self):
        """
        清理工作流相关资源
        """
        try:
            # 停止异步usage处理
            # self.stop_async_usage_processing()
            
            # 关闭线程池
            if hasattr(self, 'thread_executor') and self.thread_executor:
                self.thread_executor.shutdown(wait=True)
                self.thread_executor = None
            
            # 移除所有异步usage处理相关逻辑
            
            # 清理所有内部数据
            if hasattr(self, 'blocks'):
                self.blocks.clear()
            if hasattr(self, 'edges'):
                self.edges.clear()
            if hasattr(self, 'block_states'):
                self.block_states.clear()
            if hasattr(self, 'edge_states'):
                self.edge_states.clear()
            if hasattr(self, 'edge_to_inputs_mapping'):
                self.edge_to_inputs_mapping.clear()
            if hasattr(self, 'edge_to_outputs_mapping'):
                self.edge_to_outputs_mapping.clear()
            
            # 打破可能的循环引用
            self.state_lock = None
            log_info(f"Workflow resources cleaned up for task {self.task_id}")
        except Exception as e:
            log_error(f"Error during workflow cleanup: {str(e)}")

    # 移除所有异步usage处理相关的方法

    # ❌ _collect_edge_metadata_async 方法已被删除 - 违反数据最小化原则
    # 
    # 此方法收集了完整的用户内容快照，包括：
    # - input_blocks_snapshot: 完整的用户输入内容
    # - output_blocks_snapshot: 完整的AI输出内容  
    # - complete_workflow_payload: 完整的工作流结构
    #
    # 这些数据远超计费需要，违反GDPR数据最小化原则。
    # 请使用 _collect_minimal_metadata_compliant 方法替代。

    def _collect_minimal_metadata_compliant(self, edge_id: str, edge_result, results: Dict[str, Any], execution_success: bool) -> Dict[str, Any]:
        """
        收集符合数据最小化原则的edge元数据
        只收集计费和基本系统维护必要的信息
        
        Args:
            edge_id: edge ID
            edge_result: edge执行结果
            results: 当前结果字典
            execution_success: 执行是否成功
            
        Returns:
            Dict: 最小化的合规元数据
        """
        try:
            # 获取edge基本信息
            edge_info = self.edges.get(edge_id)
            edge_type = edge_info.get("type", "unknown")
            
            # 生成去标识化的ID
            import hashlib
            task_hash = hashlib.sha256(f"{self.task_id}_task_salt".encode()).hexdigest()[:12]
            edge_hash = hashlib.sha256(f"{edge_id}_edge_salt".encode()).hexdigest()[:8]
            
            # 最小化的合规元数据
            minimal_metadata = {
                # 添加原始ID用于追踪
                "task_id": self.task_id,
                "edge_id": edge_id,
                
                # 基本执行信息（计费必需）
                "edge_type": edge_type,
                "execution_success": execution_success,
                "execution_time": (edge_result.end_time - edge_result.start_time).total_seconds(),
                
                # 去标识化的追踪ID
                "task_hash": task_hash,
                "edge_hash": edge_hash,
                
                # 基本错误信息（系统维护必需）
                "error_info": {
                    "has_error": bool(edge_result.error),
                    "error_type": type(edge_result.error).__name__ if edge_result.error else None,
                    "error_category": self._categorize_error(edge_result.error) if edge_result.error else None
                } if edge_result.error else None,
                
                # 最小化统计信息（系统监控必需）
                "basic_stats": {
                    "input_count": len(self.edge_to_inputs_mapping.get(edge_id, [])),
                    "output_count": len(self.edge_to_outputs_mapping.get(edge_id, [])),
                    "workflow_edge_count": len(self.edges)  # 去个人化的工作流复杂度
                },
                
                # 合规标识
                "data_collection_level": "minimal",
                "privacy_compliant": True
            }
            
            # 记录合规收集确认
            log_info(f"[COMPLIANT-COLLECT] Task {task_hash} Edge {edge_hash} ({edge_type}): "
                    f"Collected minimal compliant data, execution_success={execution_success}")
            
            return minimal_metadata
            
        except Exception as e:
            log_error(f"Error collecting minimal metadata for {edge_id}: {str(e)}")
            # 返回最基本的信息
            return {
                "edge_type": "unknown",
                "execution_success": execution_success,
                "execution_time": 0,
                "data_collection_level": "minimal",
                "collection_error": str(e)
            }
    
    def _categorize_error(self, error) -> str:
        """
        将错误分类为基本类型（不暴露具体错误内容）
        """
        if not error:
            return None
            
        error_str = str(error).lower()
        if "timeout" in error_str:
            return "timeout"
        elif "connection" in error_str or "network" in error_str:
            return "connection"
        elif "permission" in error_str or "auth" in error_str:
            return "permission"
        elif "rate limit" in error_str:
            return "rate_limit"
        elif "validation" in error_str or "invalid" in error_str:
            return "validation"
        elif "memory" in error_str or "resource" in error_str:
            return "resource"
        else:
            return "other"

    def _find_parallel_batches(
        self
    ) -> Set[str]:
        """
        Find sets of edges that can be executed in parallel
        """

        processed_blocks = set(bid for bid, state in self.block_states.items() 
                             if state == "processed")

        # Find all edges whose input blocks are all processed
        ready_edges = {
            eid for eid, state in self.edge_states.items()
            if state == "pending"
            and all(bid in processed_blocks 
                    for bid in self.edge_to_inputs_mapping[eid])
        }

        # Add output blocks to processed set for next batch
        for edge_id in ready_edges:
            processed_blocks.update(self.edge_to_outputs_mapping[edge_id])

        return ready_edges

    def _process_batch_results(
        self,
        batch: Set[str],
        usage_callback = None
    ) -> Set[str]:
        # Stage 1: Mark processing states
        with self.state_lock:
            for edge_id in batch:
                self.edge_states[edge_id] = "processing"

        try:
            # Stage 2: Process batch concurrently
            outputs = self._execute_edge_batch(batch, usage_callback)
            log_info(f"Batch processing output: {outputs}")

            # Stage 3: Handle external storage for output blocks if storage client available
            # This will apply smart storage strategy based on size/type
            if self.storage_client:
                try:
                    outputs = anyio.from_thread.run(self._handle_external_outputs, outputs)
                except RuntimeError as e:
                    log_error(f"Failed to run async external storage handler: {e}. Defaulting to internal storage.")
                    # Keep original outputs if async call fails
                    pass
            
            # Yield results before state updates
            if outputs:
                yield outputs

            # Stage 4: Update states atomically
            with self.state_lock:
                # Update block states
                for bid, content in outputs.items():
                    self.block_states[bid] = "processed"
                    block_type = self.blocks.get(bid, {}).get("type", "text")
                    block_type =self._valid_output_block_type(bid, content)
                    content = self._unicode_formatting(content, block_type)
                    self.blocks[bid]["data"]["content"] = content

                # Complete processed edges
                for eid in batch:
                    self.edge_states[eid] = "completed"

            return outputs.keys()
        except Exception as e:
            log_error(f"Batch processing failed: {str(e)}")
            raise

    def _execute_edge_batch(
        self,
        edge_batch: Set[str],
        usage_callback = None
    ) -> Dict[str, Any]:
        """
        Execute a batch of edges concurrently
        """

        futures = {}
        results = {}

        try:
            # Submit all edges in batch for concurrent execution
            for edge_id in edge_batch:
                edge_info = self.edges.get(edge_id)

                # Prepare block configs for this edge
                block_configs = self._prepare_block_configs(edge_id)
                log_info(f"[DEBUG] Edge {edge_id} block configs: {block_configs}")

                # Submit edge execution
                log_info(f"Submitting edge {edge_id} ({edge_info.get('type')}) for execution")
                futures[self.thread_executor.submit(
                    EdgeExecutor(
                        edge_type=edge_info.get("type"),
                        edge_configs=edge_info.get("data", {}),
                        block_configs=block_configs
                    ).execute
                )] = edge_id

            # Wait for all edges in batch to complete
            for future in concurrent.futures.as_completed(futures):
                edge_id = futures[future]
                try:
                    results = self._process_edge_result(edge_id, results, future, usage_callback)
                except Exception as e:
                    # 移除exc_info参数，使用格式化字符串
                    log_error(f"Edge {edge_id} execution failed with error: {str(e)}\n{traceback.format_exc()}")
                    raise

            return results

        except Exception as e:
            # Revert states on failure
            with self.state_lock:
                for edge_id in edge_batch:
                    self.edge_states[edge_id] = "pending"
                    log_info(f"Reverted edge {edge_id} to pending state")

            # 移除exc_info参数，使用格式化字符串
            log_error(f"Batch execution failed: {str(e)}\n{traceback.format_exc()}")
            raise PuppyException(5203, "Edge Batch Execution Failed", str(e))
    
    async def _handle_external_outputs(self, outputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handle external storage for output blocks
        
        This method determines storage strategy based on:
        1. Explicit storage_class="external" marking
        2. Content size exceeding threshold (auto-external)
        3. Binary content types
        
        Args:
            outputs: Dictionary of block_id -> content
            
        Returns:
            Modified outputs dictionary with resource keys for external blocks
        """
        modified_outputs = outputs.copy()
        
        # Get size threshold from environment (default 1MB)
        size_threshold = int(os.getenv("EXTERNAL_STORAGE_THRESHOLD_BYTES", str(1024 * 1024)))
        
        for block_id, content in outputs.items():
            block_data = self.blocks.get(block_id, {})
            storage_class = block_data.get("storage_class", "internal")
            
            # Calculate content size
            content_size = self._calculate_content_size(content)
            
            # Determine if should use external storage
            should_use_external = False
            reason = ""
            
            if storage_class == "external":
                should_use_external = True
                reason = "explicitly marked as external"
            elif content_size > size_threshold:
                should_use_external = True
                reason = f"size ({content_size:,} bytes) exceeds threshold ({size_threshold:,} bytes)"
                # Update storage_class for future reference
                block_data["storage_class"] = "external"
            elif isinstance(content, bytes) and content_size > size_threshold // 4:
                # Binary content with lower threshold
                should_use_external = True
                reason = f"binary content ({content_size:,} bytes) exceeds binary threshold"
                block_data["storage_class"] = "external"
            
            if should_use_external:
                log_info(f"Uploading block {block_id} to external storage: {reason}")
                
                try:
                    # Determine block type
                    block_type = "text"  # default
                    if isinstance(content, bytes):
                        block_type = "binary"
                    elif isinstance(content, (dict, list)):
                        block_type = "structured"
                    elif block_data.get("type") in ["structured", "binary"]:
                        block_type = block_data.get("type")
                    
                    # Directly await the async storage upload
                    resource_key = await self._upload_to_storage(
                        block_id,
                        content,
                        block_type
                    )
                    
                    # Replace content with resource key
                    modified_outputs[block_id] = resource_key
                    log_info(f"Successfully uploaded block {block_id} to {resource_key}")
                    
                except Exception as e:
                    log_error(f"Failed to upload block {block_id} to storage: {str(e)}")
                    # Keep original content on failure
                    log_warning(f"Falling back to internal storage for block {block_id}")
            else:
                log_debug(f"Block {block_id} remains in internal storage (size: {content_size:,} bytes)")
        
        return modified_outputs
    
    def _calculate_content_size(self, content: Any) -> int:
        """
        Calculate the size of content in bytes
        
        Args:
            content: The content to measure
            
        Returns:
            Size in bytes
        """
        if isinstance(content, bytes):
            return len(content)
        elif isinstance(content, str):
            return len(content.encode('utf-8'))
        elif isinstance(content, (dict, list)):
            # For structured data, estimate JSON size
            return len(json.dumps(content).encode('utf-8'))
        else:
            # For other types, convert to string first
            return len(str(content).encode('utf-8'))
    
    async def _upload_to_storage(self, block_id: str, content: Any, block_type: str = "text") -> str:
        """
        Upload content to storage with content-type aware chunking
        
        Args:
            block_id: Block identifier
            content: Content to upload
            block_type: Type of content (text, structured, binary)
            
        Returns:
            Resource key for the uploaded content
        """
        # Extract user_id from task context (simplified for now)
        user_id = "default_user"  # TODO: Get from auth context
        
        # Generate version ID based on timestamp
        version_id = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
        
        # Create content-type aware chunk generator
        async def chunk_generator():
            chunk_size = 1024 * 1024  # 1MB chunks
            
            if block_type == "structured" and isinstance(content, (list, dict)):
                # Use StreamingJSONHandler for structured data
                handler = StreamingJSONHandler(mode="jsonl")
                if isinstance(content, dict):
                    data_items = [content]
                else:
                    data_items = content
                
                chunk_num = 0
                for chunk_bytes in handler.split_to_jsonl(data_items):
                    chunk_num += 1
                    yield (f"data_{chunk_num:04d}.jsonl", chunk_bytes)
                    
            elif block_type == "binary" and isinstance(content, bytes):
                # Split binary content into chunks
                chunk_num = 0
                for i in range(0, len(content), chunk_size):
                    chunk_num += 1
                    chunk_data = content[i:i + chunk_size]
                    yield (f"binary_{chunk_num:04d}.bin", chunk_data)
                    
            else:
                # Text content handling (including single structured objects)
                if isinstance(content, str):
                    data_bytes = content.encode('utf-8')
                elif isinstance(content, bytes):
                    data_bytes = content
                else:
                    # Convert to JSON string for other types
                    data_bytes = json.dumps(content).encode('utf-8')
                
                # Split large text content into chunks
                if len(data_bytes) > chunk_size:
                    chunk_num = 0
                    for i in range(0, len(data_bytes), chunk_size):
                        chunk_num += 1
                        chunk_data = data_bytes[i:i + chunk_size]
                        yield (f"text_{chunk_num:04d}.txt", chunk_data)
                else:
                    # Small content as single chunk
                    extension = ".txt" if block_type == "text" else ".json"
                    yield (f"content{extension}", data_bytes)
        
        # Upload to storage with external metadata
        version_base = await self.storage_client.stream_upload_version(
            user_id=user_id,
            block_id=block_id,
            version_id=version_id,
            chunk_generator=chunk_generator()
        )
        
        # Store external metadata in block data
        external_metadata = {
            "resource_key": version_base,
            "content_type": block_type,
            "chunked": True,  # Always assume chunked for external storage
            "uploaded_at": datetime.utcnow().isoformat()
        }
        
        # Update block with external metadata
        if block_id in self.blocks:
            self.blocks[block_id]["data"]["external_metadata"] = external_metadata
        
        return version_base

    async def _prefetch_and_reconstruct(self, resource_key: str, external_metadata: Dict[str, Any]) -> Any:
        """
        Prefetch and reconstruct chunked content from storage
        
        Args:
            resource_key: Base resource key (manifest location)
            external_metadata: Metadata about the external content
            
        Returns:
            Reconstructed content
        """
        try:
            content_type = external_metadata.get("content_type", "text")
            
            # Download manifest
            manifest_key = f"{resource_key}/manifest.json"
            manifest_data = await self.storage_client.get_manifest(manifest_key)
            
            log_debug(f"Reconstructing {content_type} content from {len(manifest_data.get('chunks', []))} chunks")
            
            if content_type == "structured":
                # Reconstruct structured data using StreamingJSONAggregator
                aggregator = StreamingJSONAggregator()
                all_objects = []
                
                for chunk_info in manifest_data.get('chunks', []):
                    chunk_name = chunk_info.get('name', '')
                    if chunk_name.endswith('.jsonl'):
                        chunk_key = f"{resource_key}/{chunk_name}"
                        chunk_data = await self.storage_client.download_chunk(chunk_key)
                        new_objects = aggregator.add_jsonl_chunk(chunk_data)
                        all_objects.extend(new_objects)
                
                # Return single object or list based on original structure
                if len(all_objects) == 1:
                    return all_objects[0]
                return all_objects
                
            else:
                # Reconstruct text or binary content
                reconstructed_data = b""
                
                for chunk_info in manifest_data.get('chunks', []):
                    chunk_name = chunk_info.get('name', '')
                    chunk_key = f"{resource_key}/{chunk_name}"
                    chunk_data = await self.storage_client.download_chunk(chunk_key)
                    reconstructed_data += chunk_data
                
                # Decode text content
                if content_type == "text":
                    return reconstructed_data.decode('utf-8')
                else:
                    # Return binary data as-is
                    return reconstructed_data
                    
        except Exception as e:
            log_error(f"Failed to reconstruct content from {resource_key}: {str(e)}")
            raise

    def _prepare_block_configs(
        self,
        edge_id: str
    ) -> Dict[str, Any]:
        """
        Prepare block configs for edge execution
        """

        input_block_ids = self.edge_to_inputs_mapping.get(edge_id, [])
        block_configs = {}

        for block_id in input_block_ids:
            block = self.blocks.get(block_id)
            if block:
                block_configs[block_id] = {
                    "label": block.get("label"),
                    "content": block.get("data", {}).get("content"),
                    "embedding_view": block.get("data", {}).get("embedding_view", []),
                    "looped": block.get("looped", False),
                    "collection_configs": block.get("collection_configs", {})
                }

        return block_configs

    def _process_edge_result(
        self,
        edge_id: str,
        results: Dict[str, Any],
        future: concurrent.futures.Future,
        usage_callback = None
    ) -> Dict[str, Any]:
        """
        Process the result of an edge execution
        """

        edge_result = future.result()
        execution_success = edge_result.status == "completed" and not edge_result.error

        # Detailed execution result logging
        log_msg = (
            f"\nEdge Execution Summary:"
            f"\n------------------------"
            f"\nEdge ID: {edge_id}"
            f"\nStatus: {edge_result.status}"
            f"\nSuccess: {execution_success}"
            f"\nExecution Time: {edge_result.end_time - edge_result.start_time}"
        )

        if edge_result.error:
            log_msg += f"\nError: {str(edge_result.error)}"
            log_error(log_msg)

        log_msg += f"\nOutput Blocks: {list(self.edge_to_outputs_mapping.get(edge_id, []))}"
        log_info(log_msg)
        
        # 无论成功还是失败，都记录usage event
        if usage_callback:
            try:
                # 使用合规的最小化数据收集
                edge_metadata = self._collect_minimal_metadata_compliant(edge_id, edge_result, results, execution_success)
                
                # 使用 anyio 从同步线程安全地调用异步回调
                try:
                    anyio.from_thread.run(usage_callback, edge_metadata)
                    log_info(f"Usage processing completed for edge {edge_id}")
                except Exception as callback_error:
                    log_error(f"Error in usage callback: {str(callback_error)}")
                    # Don't fail the edge execution due to usage tracking errors
                    pass

            except Exception as e:
                log_error(f"Usage processing setup failed for edge {edge_id}: {str(e)}")

        if execution_success:
            # 只有成功执行才更新结果
            for block_id in self.edge_to_outputs_mapping.get(edge_id, []):
                # If the edge is type of ifelse, the result is a set of block contents
                if self.edges.get(edge_id, {}).get("type") == "ifelse":
                    for block_id, content in edge_result.result.items():
                        results[block_id] = content
                else:
                    results[block_id] = edge_result.result
                log_info(f"[DEBUG] Block {block_id} updated with result type: {type(edge_result.result)}")
        else:
            log_warning(f"Edge {edge_id} execution failed, results not updated")
            # 失败的情况下，重新抛出错误
            if edge_result.error:
                raise edge_result.error

        return results

    @global_exception_handler(5201, "Error Parsing Edge Connections")
    def _parse_edge_connections(
        self
    ) -> Tuple[Dict[str, Set[str]], Dict[str, Set[str]]]:
        """
        Parse edge connections and build mappings between edges and block IDs

        Returns:
            Tuple containing two mappings:
            - edge_to_inputs: Mapping from edge ID to set of input block IDs
            - edge_to_outputs: Mapping from edge ID to set of output block IDs

        Example:
            Input edge data: {"llm-1": {"data": {"inputs": {"2":"b"}, "outputs": {"4":"d"}}}
            Output mappings:
                edge_to_inputs["llm-1"] = {"2"}
                edge_to_outputs["llm-1"] = {"4"}
        """

        edge_to_inputs = {}
        edge_to_outputs = {}

        for edge_id, edge_data in self.edges.items():
            # Extract input block IDs (dictionary keys)
            input_blocks = set(edge_data.get("data", {}).get("inputs", {}).keys())
            # Extract output block IDs (dictionary keys)
            output_blocks = set(edge_data.get("data", {}).get("outputs", {}).keys())

            edge_to_inputs[edge_id] = input_blocks
            edge_to_outputs[edge_id] = output_blocks

        return edge_to_inputs, edge_to_outputs

    def _log_final_states(
        self
    ):
        log_info(f"Final Block States: {self.block_states}")
        log_info(f"Final Edge States: {self.edge_states}")

    def _unicode_formatting(
        self,
        content: Any,
        block_type: str
    ) -> str:
        """
        Format the content to handle escaped unicode characters and ensure valid JSON formatting.

        Args:
            content (str): The content to format.
            block_type (str): The type of block.

        Returns:
            str: The formatted content.

        Raises:
            ValueError: If the content is not a valid JSON format for structured blocks.
        """

        # 调试日志 - 详细级别
        log_info(f"[DEBUG] Input Content: {content}, Type: {type(content)}")

        if not isinstance(content, str):
            return content

        # Handle unicode escapes
        if "\\u" in content or "\\x" in content:
            content = content.encode("utf-8", "ignore").decode("unicode_escape")

        # For structured blocks, ensure valid JSON formatting
        if block_type == "structured" and (content.startswith("[") or content.startswith("{")):
            try:
                # Normalize newlines and carriage returns
                content = content.replace("\n", "\\n").replace("\r", "\\r")

                # Handle quote escaping
                content = content.replace(r'\"', '"')  # Unescape any already escaped quotes
                content = content.replace('"', r'\"')  # Escape all double quotes
                content = content.replace("'", r"\'")  # Escape all single quotes
                content = content.replace("`", r"\`")  # Escape all backticks

                # Validate JSON structure
                try:
                    json.loads(content)
                except json.JSONDecodeError as e:
                    log_error(f"JSON validation failed: {str(e)}\nContent: {content}")
                    raise ValueError(f"Invalid JSON structure: {str(e)}")

            except Exception as e:
                log_error(f"Structured content formatting failed: {str(e)}\nContent: {content}")
                raise ValueError(f"Invalid structured content format: {str(e)}")

        # 调试日志 - 详细级别
        log_info(f"[DEBUG] Formatted Content: {content}")
        return content

    def _valid_output_block_type(
        self,
        target_block_id: str,
        output: Any
    ) -> str:
        """
        Check and classify the output to determine the type of the target block.

        Args:
            edge_dict (dict): Dictionary containing edge data.
            target_block_id (str): ID of the target block to update.
            output (Any): The output to check and classify.

        Returns:
            str: The type of the target block.
        """

        block_type = self.blocks[target_block_id].get("type", "text")
        if isinstance(output, (list, dict)) and block_type == "text":
            self.blocks[target_block_id]["type"] = "structured"

        if isinstance(output, str) and block_type == "structured":
            self.blocks[target_block_id]["type"] = "text"

        return self.blocks[target_block_id]["type"]

    def __enter__(self):
        """上下文管理器入口"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """上下文管理器退出时自动清理资源"""
        self.cleanup_resources()
        return False  # 让异常继续传播


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    test_kit = "TestKit/"
    for file_name in os.listdir(test_kit):
        if file_name != "test_perp.json":
            continue

        file_path = os.path.join(test_kit, file_name)
        print(f"========================= {file_name} =========================")
        with open(file_path, encoding="utf-8") as f:
            data = json.load(f)

        # Use list() to collect all outputs, ensure the workflow is complete
        outputs = []
        workflow = WorkFlow(data)
        for output_blocks in workflow.process():
            log_info(f"Received output blocks: {output_blocks}")
            outputs.append(output_blocks)

        log_info(f"Final blocks state: {workflow.blocks}")
        log_info(f"All outputs: {outputs}")
        workflow.cleanup_resources()
