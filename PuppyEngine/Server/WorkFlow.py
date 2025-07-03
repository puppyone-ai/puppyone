# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import warnings
warnings.simplefilter("ignore", DeprecationWarning)
warnings.simplefilter("ignore", UserWarning)
warnings.simplefilter("ignore", FutureWarning)

# 移除标准logging配置，使用自定义日志函数
from Utils.logger import log_info, log_warning, log_error

import json
import threading
import concurrent.futures
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict, Set, Any, Tuple, Generator, Callable, Optional
from Server.JsonConverter import JsonConverter
from ModularEdges.EdgeExecutor import EdgeExecutor
from Utils.puppy_exception import global_exception_handler, PuppyException
import traceback


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
        task_id: str = None
    ):
        """
        Initialize the workflow with its own data copy.
        
        Args:
            json_data: The complete workflow data including blocks and edges
            latest_version: The latest version of the schema 
            step_mode: If True, enable step-by-step execution mode
            task_id: The task ID to associate this workflow with (optional)
        """
        self.step_mode = step_mode
        self.task_id = task_id
        
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
        
        # Initialize async usage task queue for non-blocking usage processing
        self.usage_task_queue = None
        self.usage_processing_active = False
        self.pending_usage_tasks = []  # 临时存储待处理的usage任务
        
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

                processed_block_ids = self._process_batch_results(parallel_batch, usage_callback)
                processed_blocks = {
                    block_id: self.blocks.get(block_id, {}) 
                    for block_id in processed_block_ids
                }

                yield processed_blocks
                parallel_batch = self._find_parallel_batches()
            
            log_info(f"Workflow processing completed for task {self.task_id}")
            
        finally:
            # 确保在处理完成后自动清理资源
            self.cleanup_resources()

    def cleanup_resources(self):
        """
        清理工作流相关资源
        """
        try:
            # 停止异步usage处理
            self.stop_async_usage_processing()
            
            # 关闭线程池
            if hasattr(self, 'thread_executor') and self.thread_executor:
                self.thread_executor.shutdown(wait=True)
                self.thread_executor = None
            
            # 清理异步队列和待处理任务
            if hasattr(self, 'usage_task_queue') and self.usage_task_queue:
                # 不需要显式清理Queue，让它被垃圾回收
                self.usage_task_queue = None
            
            if hasattr(self, 'pending_usage_tasks'):
                self.pending_usage_tasks.clear()
            
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

    def initialize_async_usage_processing(self, usage_callback: Optional[Callable] = None):
        """
        初始化异步usage处理队列和后台任务
        
        Args:
            usage_callback: 异步usage处理回调函数
        """
        if not usage_callback:
            return
            
        try:
            # 尝试获取当前事件循环，如果不存在则创建一个
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                # 如果没有运行中的事件循环，记录信息但不创建
                log_info(f"No async event loop available for task {self.task_id}, usage will be processed synchronously")
                return
            
            # 创建异步队列
            self.usage_task_queue = asyncio.Queue()
            self.usage_processing_active = True
            
            # 启动后台usage处理任务
            asyncio.create_task(self._process_usage_tasks_async(usage_callback))
            log_info(f"Async usage processing initialized for task {self.task_id}")
            
        except Exception as e:
            log_warning(f"Failed to initialize async usage processing for task {self.task_id}: {str(e)}")

    async def _process_usage_tasks_async(self, usage_callback: Callable):
        """
        后台异步处理usage任务队列
        
        Args:
            usage_callback: 异步usage处理回调函数
        """
        log_info(f"Starting async usage task processor for task {self.task_id}")
        
        try:
            while self.usage_processing_active:
                try:
                    # 等待队列中的任务，设置合理的超时
                    task_data = await asyncio.wait_for(
                        self.usage_task_queue.get(),
                        timeout=0.5  # 500ms超时，允许定期检查active状态
                    )
                    
                    # 处理usage任务
                    await self._handle_single_usage_task_async(task_data, usage_callback)
                    
                    # 标记任务完成
                    self.usage_task_queue.task_done()
                    
                except asyncio.TimeoutError:
                    # 超时是正常的，继续循环检查active状态
                    continue
                except Exception as e:
                    log_error(f"Error processing usage task for task {self.task_id}: {str(e)}")
                    
        except Exception as e:
            log_error(f"Usage task processor error for task {self.task_id}: {str(e)}")
        finally:
            log_info(f"Async usage task processor stopped for task {self.task_id}")

    async def _handle_single_usage_task_async(self, task_data: Dict[str, Any], usage_callback: Callable):
        """
        处理单个usage任务
        
        Args:
            task_data: 包含edge_metadata的任务数据
            usage_callback: 异步usage处理回调函数
        """
        try:
            edge_metadata = task_data.get("edge_metadata")
            if edge_metadata:
                await usage_callback(edge_metadata)
                log_info(f"Async usage task completed for edge {edge_metadata.get('edge_id', 'unknown')}")
        except Exception as e:
            log_error(f"Failed to process usage task: {str(e)}")

    def submit_usage_task_async(self, edge_metadata: Dict[str, Any]) -> bool:
        """
        提交usage任务到异步队列（非阻塞）
        
        Args:
            edge_metadata: edge执行的元数据
            
        Returns:
            bool: 是否成功提交到队列
        """
        if not self.usage_task_queue or not self.usage_processing_active:
            # 如果队列未初始化，添加到待处理列表
            self.pending_usage_tasks.append({"edge_metadata": edge_metadata})
            log_info(f"Usage task queued for later processing (edge: {edge_metadata.get('edge_id', 'unknown')})")
            return False
        
        try:
            # 非阻塞方式放入队列
            self.usage_task_queue.put_nowait({"edge_metadata": edge_metadata})
            log_info(f"Usage task submitted to async queue for edge {edge_metadata.get('edge_id', 'unknown')}")
            return True
        except asyncio.QueueFull:
            log_warning(f"Usage task queue full, processing synchronously for edge {edge_metadata.get('edge_id', 'unknown')}")
            return False
        except Exception as e:
            log_error(f"Failed to submit usage task: {str(e)}")
            return False

    def stop_async_usage_processing(self):
        """
        停止异步usage处理
        """
        if self.usage_processing_active:
            self.usage_processing_active = False
            log_info(f"Async usage processing stopped for task {self.task_id}")

    def process_pending_usage_tasks_sync(self, usage_callback: Optional[Callable] = None):
        """
        同步处理待处理的usage任务（用于没有异步环境的情况）
        
        Args:
            usage_callback: 同步usage处理回调函数
        """
        if not self.pending_usage_tasks or not usage_callback:
            return
            
        log_info(f"Processing {len(self.pending_usage_tasks)} pending usage tasks synchronously")
        
        for task_data in self.pending_usage_tasks:
            try:
                edge_metadata = task_data.get("edge_metadata")
                if edge_metadata:
                    # 如果callback是异步的，需要在新的事件循环中运行
                    if asyncio.iscoroutinefunction(usage_callback):
                        try:
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                            loop.run_until_complete(usage_callback(edge_metadata))
                            loop.close()
                        except Exception as e:
                            log_error(f"Error in async callback execution: {str(e)}")
                    else:
                        usage_callback(edge_metadata)
                        
            except Exception as e:
                log_error(f"Error processing pending usage task: {str(e)}")
        
        self.pending_usage_tasks.clear()
        log_info(f"Completed processing pending usage tasks for task {self.task_id}")

    def _collect_edge_metadata_async(self, edge_id: str, edge_result, results: Dict[str, Any], execution_success: bool) -> Dict[str, Any]:
        """
        异步收集edge元数据（优化性能，减少主线程阻塞）
        
        Args:
            edge_id: edge ID
            edge_result: edge执行结果
            results: 当前结果字典
            execution_success: 执行是否成功
            
        Returns:
            Dict: 收集的元数据
        """
        try:
            # 收集edge的输入block状态（执行前）
            input_block_ids = list(self.edge_to_inputs_mapping.get(edge_id, []))
            input_blocks_snapshot = {}
            for block_id in input_block_ids:
                block_info = self.blocks.get(block_id, {})
                input_blocks_snapshot[block_id] = {
                    "label": block_info.get("label"),
                    "type": block_info.get("type"),
                    "data": {
                        "content": block_info.get("data", {}).get("content"),
                        "embedding_view": block_info.get("data", {}).get("embedding_view", [])
                    },
                    "looped": block_info.get("looped", False),
                    "collection_configs": block_info.get("collection_configs", {})
                }
            
            # 收集edge的输出block状态（执行后）
            output_block_ids = list(self.edge_to_outputs_mapping.get(edge_id, []))
            output_blocks_snapshot = {}
            
            if execution_success:
                # 成功执行：记录实际的输出结果
                for block_id in output_block_ids:
                    if block_id in results:
                        block_info = self.blocks.get(block_id, {})
                        output_blocks_snapshot[block_id] = {
                            "label": block_info.get("label"),
                            "type": block_info.get("type"),
                            "data": {
                                "content": results[block_id],  # 使用执行结果
                                "embedding_view": block_info.get("data", {}).get("embedding_view", [])
                            },
                            "looped": block_info.get("looped", False),
                            "collection_configs": block_info.get("collection_configs", {})
                        }
            else:
                # 失败执行：记录原始的输出block状态（未被修改）
                for block_id in output_block_ids:
                    block_info = self.blocks.get(block_id, {})
                    output_blocks_snapshot[block_id] = {
                        "label": block_info.get("label"),
                        "type": block_info.get("type"),
                        "data": {
                            "content": block_info.get("data", {}).get("content"),  # 保持原状
                            "embedding_view": block_info.get("data", {}).get("embedding_view", [])
                        },
                        "looped": block_info.get("looped", False),
                        "collection_configs": block_info.get("collection_configs", {}),
                        "execution_failed": True  # 标记这个block由于执行失败未被更新
                    }
            
            # 构造edge的简化payload（用于这次执行的配置）
            edge_info = self.edges.get(edge_id, {})
            edge_simple_payload = {
                "edge_id": edge_id,
                "type": edge_info.get("type"),
                "data": {
                    **edge_info.get("data", {}),
                    # 包含实际使用的输入输出映射
                    "actual_inputs": {bid: input_blocks_snapshot.get(bid, {}).get("label", bid) for bid in input_block_ids},
                    "actual_outputs": {bid: output_blocks_snapshot.get(bid, {}).get("label", bid) for bid in output_block_ids}
                }
            }
            
            # 构造当前workflow的完整payload快照
            complete_workflow_payload = {
                "version": getattr(self, "version", "0.1"),
                "blocks": dict(self.blocks),  # 当前所有blocks的状态
                "edges": dict(self.edges),    # 当前所有edges的配置
                "task_id": self.task_id,
                "execution_context": {
                    "current_edge": edge_id,
                    "block_states": dict(self.block_states),
                    "edge_states": dict(self.edge_states),
                    "execution_timestamp": edge_result.end_time,
                    "execution_success": execution_success
                }
            }

            edge_type = edge_info.get("type", "unknown")
            edge_metadata = {
                "edge_id": edge_id,
                "edge_type": edge_type,
                "execution_time": edge_result.end_time - edge_result.start_time,
                "task_id": self.task_id,
                "execution_success": execution_success,  # 关键字段：记录执行是否成功
                
                # 错误信息（如果有）
                "error_info": {
                    "has_error": bool(edge_result.error),
                    "error_message": str(edge_result.error) if edge_result.error else None,
                    "error_type": type(edge_result.error).__name__ if edge_result.error else None,
                    "edge_status": edge_result.status
                } if edge_result.error else None,
                
                # 输入输出block快照
                "input_blocks_snapshot": input_blocks_snapshot,
                "output_blocks_snapshot": output_blocks_snapshot,
                
                # edge配置和执行payload
                "edge_simple_payload": edge_simple_payload,
                
                # 完整workflow状态快照
                "complete_workflow_payload": complete_workflow_payload,
                
                # 统计信息
                "stats": {
                    "input_block_count": len(input_block_ids),
                    "output_block_count": len(output_block_ids),
                    "total_blocks_in_workflow": len(self.blocks),
                    "total_edges_in_workflow": len(self.edges),
                    "completed_edges_count": sum(1 for state in self.edge_states.values() if state == "completed"),
                    "failed_edges_count": sum(1 for state in self.edge_states.values() if state == "failed")
                }
            }
            
            return edge_metadata
            
        except Exception as e:
            log_error(f"Error collecting edge metadata for {edge_id}: {str(e)}")
            # 返回最小化的元数据
            return {
                "edge_id": edge_id,
                "edge_type": self.edges.get(edge_id, {}).get("type", "unknown"),
                "execution_time": edge_result.end_time - edge_result.start_time,
                "task_id": self.task_id,
                "execution_success": execution_success,
                "error_info": {"collection_error": str(e)}
            }

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

            # Stage 3: Update states atomically
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
        
        # 无论成功还是失败，都记录usage event（异步处理，不阻塞主流程）
        if usage_callback:
            try:
                # 快速收集edge元数据（已优化性能）
                edge_metadata = self._collect_edge_metadata_async(edge_id, edge_result, results, execution_success)
                
                # 尝试异步提交任务，如果失败则同步处理
                submitted = self.submit_usage_task_async(edge_metadata)
                
                if not submitted:
                    # 如果异步提交失败，记录但不阻塞（待后续处理或直接丢弃）
                    log_info(f"Edge {edge_id} usage task will be processed later or synchronously")
                    
            except Exception as e:
                log_error(f"Usage processing setup failed for edge {edge_id}: {str(e)}")
                # 不抛出异常，避免影响workflow执行

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
