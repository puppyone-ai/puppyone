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
import concurrent.futures
from typing import List, Dict, Set, Any, Tuple
from EdgesNew.EdgesNew import EdgeDistributor
from Server.JsonParser import JsonParser
from Server.JsonConverter import JsonConverter
from Utils.PuppyEngineExceptions import global_exception_handler

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
    - All input blocks must be 'processed'
    - Edge must be in 'pending' state
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
• Edge failure triggers rollback to 'pending' state
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
        json_data: Dict[str, Dict[str, str]]
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

        # TODO: Add the converter
        # if self.version != self.latest_version:
        #     converter = JsonConverter(self.latest_version)
        #     json_data = converter.convert(json_data)

        # TODO: Add the validater

        # TODO: Add the id
        # self.id: UUID = None

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


    @global_exception_handler(5201, "Error Parsing Edge Connections")
    def _parse_edge_connections(self) -> Tuple[Dict[str, Set[str]], Dict[str, Set[str]]]:
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
            # 提取输入块ID（字典的键）
            input_blocks = set(edge_data.get("data", {}).get("inputs", {}).keys())
            # 提取输出块ID（字典的键）
            output_blocks = set(edge_data.get("data", {}).get("outputs", {}).keys())

            edge_to_inputs[edge_id] = input_blocks
            edge_to_outputs[edge_id] = output_blocks

        return edge_to_inputs, edge_to_outputs


    # process the workflow
    @global_exception_handler(5202, "Error Processing All Blocks", True)
    def process(self):
        """Orchestrate workflow execution with dynamic edge activation"""
        try:
            logger.info("Initial blocks state: %s", self.blocks)
            
            while active_edge_ids := self._find_active_edges(
                bids=self.get_processed_blocks()
            ):
                logger.info("Found active edges: %s", active_edge_ids)
                logger.info("Current block states: %s", self.block_states)
                
                # Stage 1: Mark processing states
                self._mark_processing_states(active_edge_ids)
                
                # Stage 2: Prepare processing context
                active_edges, input_blocks = self._prepare_processing_batch(active_edge_ids)
                logger.info("Processing batch - edges: %s, inputs: %s", 
                           active_edges.keys(), input_blocks.keys())
                
                # Stage 3: Execute edge processing
                output_blocks = EdgeDistributor(active_edges, input_blocks).process()
                logger.info("Edge processing output: %s", output_blocks)
                
                # Stage 4: Update states before yielding
                self._update_post_processing_states(active_edge_ids, output_blocks)
                
                # Stage 5: Update blocks registry
                self.blocks.update(output_blocks)
                logger.info("Updated blocks: %s", self.blocks)
                
                yield output_blocks
                
        finally:
            self._log_final_states()

    def _mark_processing_states(self, edge_ids: Set[str]):
        """仅更新边状态，不再修改块状态"""
        for eid in edge_ids:
            self.edge_states[eid] = "processing"

    def _update_post_processing_states(self, edge_ids: Set[str], output_blocks: Dict):
        """Atomic state updates after processing"""
        # Update block states
        for bid in output_blocks:
            self.block_states[bid] = "processed"
        
        # Complete processed edges
        for eid in edge_ids:
            self.edge_states[eid] = "completed"

    def _find_active_edges(self, bids: List[str]) -> Set[str]:
        """Dynamic edge activation without active state tracking:
        1. All input blocks must be processed
        2. At least one input block in current trigger batch
        3. Edge is in pending state
        """
        return {
            eid for eid in self.edges
            if self.edge_states[eid] == "pending"
            and all(self.block_states[bid] == "processed" for bid in self.edge_to_inputs_mapping[eid])
            # 移除了触发块检查，因为每个块只能被一个边消费
        }

    def _prepare_processing_batch(self, edge_ids: Set[str]) -> Tuple[Dict, Dict]:
        """Build processing context for active edges"""
        active_edges = {eid: self.edges[eid] for eid in edge_ids}
        
        # 获取所有输入块ID
        input_blocks = {}
        for eid in edge_ids:
            edge_inputs = self.edge_to_inputs_mapping[eid]
            for bid in edge_inputs:
                if self.block_states[bid] == "processed":
                    input_blocks[bid] = self.blocks[bid]
        
        logger.debug("Prepared input blocks: %s", input_blocks)
        return active_edges, input_blocks

    # State query interfaces
    def get_processed_blocks(self) -> List[str]:
        return [bid for bid, state in self.block_states.items() if state == "processed"]

    def _log_final_states(self):
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
                        json_content = f'{{"content": {json.dumps(json_content)}}}'
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
    
    # workflow graph:
    # [1] ----{llm-2850284766678}----> [2] ---\
    #                                          ---{llm-1727235281399}----> [4]
    # [3] -----------------------------------/
    test_data = {
        "blocks": {
            # 起始节点1: 结构化数据，初始内容为空
            "1": {
                "label":"a",
                "type": "structured",
                "data": {
                    "content": "3",
                    "embedding_view": []
                },
            },
            # 中间节点2: 接收来自节点1的数据，结构化数据
            "2": {
                "label":"b",
                "type": "structured",
                "data": {
                    "content": "",
                    "embedding_view": []
                },
            },
            # 起始节点3: 文本数据，初始内容为"puppy"
            "3": {
                "label": "c",
                "type": "text",
                "data": {
                    "content": "puppy"
                },
            },
            # 终点节点4: 接收来自节点2和3的组合处理结果
            "4": {
                "label": "d",
                "type": "text",
                "data": {
                    "content": ""
                },
            }
        },
        "edges": {
            # 第二条边: 将节点2和节点3的数据组合处理后发送到节点4
            "llm-1727235281399": {
                "type": "llm",
                "data": {
                    "messages": [
                        {"role": "system", "content": "You are a helpful AI assistant"},
                        {"role": "user", "content": "change the name in {{b}} into {{c}}"}
                    ],
                    "sys_prompt": "",
                    "model": "gpt-4o",
                    "base_url": "",
                    "max_tokens": 2048,
                    "temperature": 0.7,
                    "inputs": {"2": "b",
                               "3": "c"},
                    "outputs": {"4": "b"},
                    "structured_output":False
                    }
                },
            # 第一条边: 处理节点1的数据并发送到节点2
            "llm-2850284766678": {
            "type": "llm",
            "data": {
                "messages": [
                    {"role": "system", "content": "You are a helpful AI assistant that called {{1}}"},
                    {"role": "user", "content": "return {{a}} apples"}
                ],
                "sys_prompt": "",
                "model": "gpt-4o",
                "base_url": "",
                "max_tokens": 2048,
                "temperature": 0.7,
                "inputs": {"1": "a"},
                "outputs": {"2": "b"},
                "structured_output":True
                }
            }
        },
        "version": "0.1"
    }
    
    workflow = WorkFlow(test_data)
    
    # 使用 list() 收集所有输出，确保流程完整执行
    outputs = []
    for output_blocks in workflow.process():
        logger.info("Received output blocks: %s", output_blocks)
        outputs.append(output_blocks)
    
    logger.info("Final blocks state: %s", workflow.blocks)
    logger.info("All outputs: %s", outputs)
