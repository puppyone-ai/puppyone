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
from Server.JsonParser import JsonParser
from Server.JsonConverter import JsonConverter
from ModularEdges.EdgeExecutor import EdgeExecutor
from Utils.PuppyEngineExceptions import global_exception_handler, PuppyEngineException


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
        latest_version: str = "0.1"
    ):
        """
        Initialize the processor for the WorkFlow object.

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

        # Convert the JSON data to the latest version
        self.version = json_data.get("version", self.__class__.version)

        # Convert the JSON data to the latest version
        if self.version != latest_version:
            converter = JsonConverter(latest_version)
            json_data = converter.convert(json_data)

        self.blocks = json_data.get("blocks", {})
        self.edges = json_data.get("edges", {})
        self.edge_to_inputs_mapping, self.edge_to_outputs_mapping = self._parse_edge_connections()

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

    def clear_workflow(
        self
    ) -> None:
        """Clear the workflow"""

        self.blocks = {}
        self.edges = {}
        self.block_states = {}
        self.edge_states = {}
        self.edge_to_inputs_mapping = {}
        self.edge_to_outputs_mapping = {}

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

    def _prepare_block_configs(self, edge_id: str) -> Dict[str, Any]:
        """Prepare block configs for edge execution"""
        input_block_ids = self.edge_to_inputs_mapping.get(edge_id, [])
        block_configs = {}
        
        for block_id in input_block_ids:
            block = self.blocks.get(block_id)
            if block:
                block_configs[block_id] = {
                    "label": block.get("label"),
                    "content": block.get("data", {}).get("content"),
                    "looped": block.get("looped", False)
                }

        return block_configs

    def _execute_edge_batch(self, edge_batch: Set[str]) -> Dict[str, Any]:
        """Execute a batch of edges concurrently"""
        futures = {}
        results = {}

        try:
            # Submit all edges in batch for concurrent execution
            for edge_id in edge_batch:
                edge_info = self.edges.get(edge_id)
                if not edge_info:
                    continue

                # Prepare block configs for this edge
                block_configs = self._prepare_block_configs(edge_id)

                # Submit edge execution
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
                    edge_result = future.result()
                    if edge_result.status == "completed":
                        results[edge_id] = edge_result.result
                    else:
                        logger.error(f"Edge {edge_id} failed: {edge_result.error}")
                        raise edge_result.error
                except Exception as e:
                    logger.error(f"Edge {edge_id} execution failed: {str(e)}")
                    raise

            return results

        except Exception as e:
            # Revert states on failure
            with self.state_lock:
                for edge_id in edge_batch:
                    self.edge_states[edge_id] = "pending"
            raise PuppyEngineException(5203, "Edge Batch Execution Failed", str(e))

    def _find_parallel_batches(
        self
    ) -> List[Set[str]]:
        """Find sets of edges that can be executed in parallel"""
        batches = []
        remaining = set(self.edges.keys())
        processed_blocks = set(bid for bid, state in self.block_states.items() 
                             if state == "processed")

        while remaining:
            # Find all edges whose input blocks are all processed
            ready_edges = {
                eid for eid in remaining
                if self.edge_states[eid] == "pending"
                and all(bid in processed_blocks 
                       for bid in self.edge_to_inputs_mapping[eid])
            }

            if not ready_edges:
                break

            batches.append(ready_edges)
            remaining -= ready_edges
            
            # Add output blocks to processed set for next batch
            for edge_id in ready_edges:
                processed_blocks.update(self.edge_to_outputs_mapping[edge_id])

        return batches

    @global_exception_handler(5202, "Error Processing Workflow", True)
    def process(
        self
    ) -> Generator[Dict[str, Any], None, None]:
        """Process the workflow with concurrent edge execution"""
        try:
            logger.info("Starting workflow processing")

            while True:
                # Find all edge batches that can run in parallel
                parallel_batches = self._find_parallel_batches()
                if not parallel_batches:
                    break

                logger.info("Found parallel batches: %s", parallel_batches)

                for batch in parallel_batches:
                    yield self._process_batch_results(batch)

            return self.blocks

        finally:
            self.thread_executor.shutdown(wait=True)
            logger.info("Workflow processing completed")

    def _process_batch_results(
        self,
        batch: Set[str]
    ) -> Generator[Dict[str, Any], None, None]:
        # Stage 1: Mark processing states
        with self.state_lock:
            for edge_id in batch:
                self.edge_states[edge_id] = "processing"
        
        try:
            # Stage 2: Process batch concurrently
            output_blocks = self._execute_edge_batch(batch)
            logger.info("Batch processing output: %s", output_blocks)

            # Stage 3: Update states atomically
            with self.state_lock:
                # Update block states
                for bid in output_blocks:
                    self.block_states[bid] = "processed"
                # Complete processed edges
                for eid in batch:
                    self.edge_states[eid] = "completed"
                # Update blocks registry
                self.blocks.update(output_blocks)

            yield output_blocks
        except Exception as e:
            logger.error(f"Batch processing failed: {str(e)}")
            raise

    def get_processed_blocks(
        self
    ) -> List[str]:
        return [bid for bid, state in self.block_states.items() if state == "processed"]

    def _log_final_states(
        self
    ):
        logger.debug("Final Block States: %s", self.block_states)
        logger.debug("Final Edge States: %s", self.edge_states)

    def _unicode_formatting(
        self,
        content: str,
        block_type: str
    ) -> str:
        """
        Format the content to handle escaped unicode characters.

        Args:
            content (str): The content to format.
            block_type (str): The type of block.

        Returns:
            str: The formatted content.
        """

        if isinstance(content, str):
            if "\\u" in content or "\\x" in content:
                content = content.encode("utf-8", "ignore").decode("unicode_escape")

            if block_type == "structured" and (content.startswith("[") or content.startswith("{")):
                content = content.replace("\n", "\\n").replace("\r", "\\r")
                try:
                    json_content = content
                    if json_content.startswith("["):
                        json_content = f"{{'content': {json.dumps(json_content)}}}"
                    json.loads(json_content)
                except json.JSONDecodeError:
                    logger.error("Invalid Result Structured Content: %s", content)
                    raise ValueError("Invalid Result Structured Content")
                    
        return content

    def _valid_output_block_type(
        self,
        target_block_id: str,
        output: Any
    ) -> None:
        """
        Check and classify the output to determine the type of the target block.

        Args:
            edge_dict (dict): Dictionary containing edge data.
            target_block_id (str): ID of the target block to update.
            output (Any): The output to check and classify.
        """

        block_type = self.blocks[target_block_id].get("type", "text")
        if isinstance(output, (list, dict)) and block_type == "text":
            self.blocks[target_block_id]["type"] = "structured"

        if isinstance(output, str) and block_type == "structured":
            self.blocks[target_block_id]["type"] = "text"

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    test_kit = "TestKit/"
    for file_name in os.listdir(test_kit):
        if file_name != "chunking.json":
            continue
        # if file_name in {"embedding_search.json", "concurrency.json", "loop_modify_get.json", "loop_modify_structured.json", "modify_get.json", "modify_structured.json", "multiple_output_edge.json"}:
        #     continue
        # if file_name.startswith("modify") or file_name.startswith("loop_modify"):
        #     continue
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
        workflow.clear_workflow()
