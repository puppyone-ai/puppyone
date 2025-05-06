# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import warnings
warnings.simplefilter("ignore", DeprecationWarning)
warnings.simplefilter("ignore", UserWarning)
warnings.simplefilter("ignore", FutureWarning)

import logging
logging.basicConfig(level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.ERROR)
logger = logging.getLogger(__name__)

import json
import threading
import concurrent.futures
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict, Set, Any, Tuple, Generator
from Server.JsonConverter import JsonConverter
from ModularEdges.EdgeExecutor import EdgeExecutor
from Utils.puppy_exception import global_exception_handler, PuppyException


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
        step_mode: bool = False
    ):
        """
        Initialize the processor for the WorkFlow object.

        Args:
            json_data: The workflow definition in JSON format
            latest_version: The latest version of the schema
            step_mode: If True, enable step-by-step execution mode
        
        Example Input JSON:
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
        """

        self.step_mode = step_mode
        # Convert the JSON data to the latest version
        self.version = json_data.get("version", self.__class__.version)

        # Convert the JSON data to the latest version
        if self.version != latest_version:
            converter = JsonConverter(latest_version)
            json_data = converter.convert(json_data)

        self.blocks = json_data.get("blocks", {})
        self.edges = json_data.get("edges", {})
        self.edge_to_inputs_mapping, self.edge_to_outputs_mapping = self._parse_edge_connections()

        # Validate single flow before proceeding
        self._validate_single_flow()

        # Simplified state management
        self.block_states = {bid: "pending" for bid in self.blocks}
        self.edge_states = {eid: "pending" for eid in self.edges}

        # Auto-process source blocks
        initial_processed = set(self.blocks.keys()) - set().union(*self.edge_to_outputs_mapping.values())
        for bid in initial_processed:
            self.block_states[bid] = "processed"

        self.max_workers = min(32, (os.cpu_count() or 1) * 4)
        self.thread_executor = ThreadPoolExecutor(max_workers=self.max_workers)
        self.state_lock = threading.Lock()

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
    def process(self) -> Generator[Dict[str, Any], None, None]:
        """
        Process the workflow with concurrent edge execution
        """
        try:
            logger.info("Starting workflow processing")
            
            # 处理工作流
            parallel_batch = self._find_parallel_batches()
            batch_count = 0

            while parallel_batch:
                batch_count += 1
                logger.info(f"Found parallel batch #{batch_count}: {parallel_batch}")

                if self.step_mode:
                    input(f"\nPress Enter to execute batch #{batch_count}... ")

                processed_block_ids = self._process_batch_results(parallel_batch)
                processed_blocks = {
                    block_id: self.blocks.get(block_id, {}) 
                    for block_id in processed_block_ids
                }

                yield processed_blocks
                parallel_batch = self._find_parallel_batches()
            
        finally:
            # 确保在处理完成后自动清理资源
            self.cleanup_resources()
            logger.info("Workflow processing completed")

    def cleanup_resources(self):
        """
        清理工作流相关资源
        """
        try:
            # 关闭线程池
            if hasattr(self, 'thread_executor') and self.thread_executor:
                self.thread_executor.shutdown(wait=True)
                self.thread_executor = None
            
            # 清理其他资源
            self.blocks.clear()
            self.edges.clear()
            self.block_states.clear()
            self.edge_states.clear()
            self.edge_to_inputs_mapping.clear()
            self.edge_to_outputs_mapping.clear()
            
            # 打破可能的循环引用
            self.state_lock = None
        except Exception as e:
            logger.error(f"Error during workflow cleanup: {str(e)}")

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
        batch: Set[str]
    ) -> Set[str]:
        # Stage 1: Mark processing states
        with self.state_lock:
            for edge_id in batch:
                self.edge_states[edge_id] = "processing"

        try:
            # Stage 2: Process batch concurrently
            outputs = self._execute_edge_batch(batch)
            logger.info("Batch processing output: %s", outputs)

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
            logger.error(f"Batch processing failed: {str(e)}")
            raise

    def _execute_edge_batch(
        self,
        edge_batch: Set[str]
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
                logger.debug(f"Edge {edge_id} block configs: {block_configs}")

                # Submit edge execution
                logger.info(f"Submitting edge {edge_id} ({edge_info.get('type')}) for execution")
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
                    results = self._process_edge_result(edge_id, results, future)
                except Exception as e:
                    logger.error(f"Edge {edge_id} execution failed with error: {str(e)}", exc_info=True)
                    raise

            return results

        except Exception as e:
            # Revert states on failure
            with self.state_lock:
                for edge_id in edge_batch:
                    self.edge_states[edge_id] = "pending"
                    logger.info(f"Reverted edge {edge_id} to pending state")

            logger.error(f"Batch execution failed: {str(e)}", exc_info=True)
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
        future: concurrent.futures.Future
    ) -> None:
        """
        Process the result of an edge execution
        """

        edge_result = future.result()

        # Detailed execution result logging
        log_msg = (
            f"\nEdge Execution Summary:"
            f"\n------------------------"
            f"\nEdge ID: {edge_id}"
            f"\nStatus: {edge_result.status}"
            f"\nExecution Time: {edge_result.end_time - edge_result.start_time}"
        )

        if edge_result.error:
            log_msg += f"\nError: {str(edge_result.error)}"
            logger.error(log_msg)
            raise edge_result.error

        log_msg += f"\nOutput Blocks: {list(self.edge_to_outputs_mapping.get(edge_id, []))}"
        logger.info(log_msg)
        if edge_result.status == "completed":
            # Map results to output blocks
            for block_id in self.edge_to_outputs_mapping.get(edge_id, []):
                # If the edge is type of ifelse, the result is a set of block contents
                if self.edges.get(edge_id, {}).get("type") == "ifelse":
                    for block_id, content in edge_result.result.items():
                        results[block_id] = content
                else:
                    results[block_id] = edge_result.result
                logger.debug(f"Block {block_id} updated with result type: {type(edge_result.result)}")
        else:
            logger.warning(f"Edge {edge_id} completed but status is {edge_result.status}")

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
        logger.debug("Final Block States: %s", self.block_states)
        logger.debug("Final Edge States: %s", self.edge_states)

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

        logger.debug("Input Content: %s, Type: %s", content, type(content))

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
                    logger.error("JSON validation failed: %s\nContent: %s", str(e), content)
                    raise ValueError(f"Invalid JSON structure: {str(e)}")

            except Exception as e:
                logger.error("Structured content formatting failed: %s\nContent: %s", str(e), content)
                raise ValueError(f"Invalid structured content format: {str(e)}")

        logger.debug("Formatted Content: %s", content)
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
        if file_name != "new_llm_bug.json":
            continue

        file_path = os.path.join(test_kit, file_name)
        print(f"========================= {file_name} =========================")
        with open(file_path, encoding="utf-8") as f:
            data = json.load(f)

        # Use list() to collect all outputs, ensure the workflow is complete
        outputs = []
        workflow = WorkFlow(data)
        for output_blocks in workflow.process():
            logger.info("Received output blocks: %s", output_blocks)
            outputs.append(output_blocks)

        logger.info("Final blocks state: %s", workflow.blocks)
        logger.info("All outputs: %s", outputs)
        workflow.cleanup_resources()
