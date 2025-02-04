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
from Edges.edgesNew import EdgeNew
from Server.JsonParser import JsonParser
from Server.JsonConverter import JsonConverter
from Utils.PuppyEngineExceptions import global_exception_handler


class WorkFlow:
    """
    WorkFlow is responsible for executing the entire flow
    """

    def __init__(
        self,
        latest_version: str = "0.1",
    ):
        """
        Initialize the states for the WorkFlow object.
        """

        self.latest_version = latest_version
        self.processed_block_ids = set()
        self.current_block_ids = set()
        self.all_block_dict = {}
        self.all_edge_dict = {}
        self.current_batch_for_edges = {}

    @global_exception_handler(5200, "Error Configuring Workflow JSON")
    def config_workflow_json(
        self,
        json_data: Dict[str, Dict[str, str]]
    ):
        """
        Reconfigure the WorkFlow object with block and edge data from JSON.

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

        After processing:
        - self.block_dict will contain the blocks dictionary above
        - self.edge_dict will contain the edges dictionary above
        """

        # Convert the JSON data to the latest version
        self.version_id = json_data.get("version", "0.2")
        if self.version_id != self.latest_version:
            converter = JsonConverter(self.latest_version)
            json_data = converter.convert(json_data)

        self.all_block_dict = json_data.get("blocks", [])
        self.all_edge_dict = json_data.get("edges", [])


    @global_exception_handler(5201, "Error Clearing Workflow")
    def clear_workflow(
        self
    ):
        """
        Clear the current workflow data.
        """

        self.all_block_dict = {}
        self.all_edge_dict = {}
        self.processed_block_ids = set()
        self.current_block_ids = set()

        self.current_blocks_dict = {}
        self.current_batch_for_edges = {}

    # process the workflow
    @global_exception_handler(5202, "Error Processing All Blocks", True)
    def process_all(
        self
    ):
        """
        Begins processing with the first batch of blocks and continues until all blocks are processed.

        Yields:
            dict: The data of each processed block.
        """

        # Initialize block statuses
        self._find_and_initialize_block_status()

        # find the first batch of edges
        self.current_batch_for_edges = self._find_current_batch_for_edges()
        
        
        logger.info("Initial batch of edges to process: %s", self.current_batch_for_edges)
        
        while self.current_batch_for_edges != {}:

            # find the current batch of edges
            self.current_batch_for_edges = self._find_current_batch_for_edges()

            for edge_id, edge_dict in self.current_batch_for_edges.items():

                edge_element = {edge_id: edge_dict}

                input_blocks_ids = edge_dict.get("data", {}).get("inputs", {})
                # Get the actual block data for each input block ID
                input_blocks = {}
                for block_id in input_blocks_ids.keys():
                    if block_id in self.all_block_dict:
                        input_blocks[block_id] = self.all_block_dict[block_id]
                
                # Process the edge with {edge_id: edge_dict} structure
                required_update_blocks_dict = EdgeNew(self, edge_element, input_blocks).process()

                print(required_update_blocks_dict)

                # Update blocks in all_block_dict with the processed results
                for block_id, block_dict in required_update_blocks_dict.items():
                    if block_id in self.all_block_dict:
                        for key, value in block_dict.items():
                            self.all_block_dict[block_id][key] = value

                        self.all_block_dict[block_id]["status"] = "ready"

                    
                # update the current batch of blocks status
                for input_block_id in edge_dict.get("data", {}).get("inputs", {}).keys():
                    self.all_block_dict[input_block_id]["status"] = "done"
                    

                logger.info("Updated block statuses: %s", 
                    {block_id: block["status"] for block_id, block in self.all_block_dict.items()})


        print("all edges processed")


    @global_exception_handler(5203, "Error Finding the First Batch")
    def _find_and_initialize_block_status(
        self
    ) -> None:
        """
        Initialize the status of each block.
        Sets blocks that are not inputs to any edge as 'ready'.
        All other blocks are set to 'pending'.
        """
        # Get all block IDs
        all_block_ids = set(self.all_block_dict.keys())
        
        # Get blocks that are outputs of edges
        with_output_block_ids = set()
        for edge_id, edge_dict in self.all_edge_dict.items():
            with_output_block_ids.update(edge_dict.get("data", {}).get("outputs", {}).keys())
            
        # Find blocks that are not outputs (using set difference)
        start_block_ids = all_block_ids - with_output_block_ids

        # iterate over all blocks, set their status
        for block_id, block_data in self.all_block_dict.items():
            if block_id in start_block_ids:
                # if this block is not an input to any edge, set it to ready
                block_data["status"] = "ready"
            else:
                # if this block is an input to any edge, set it to pending
                block_data["status"] = "pending"
                
        logger.info("Initialized block statuses: %s", 
                    {block_id: block["status"] for block_id, block in self.all_block_dict.items()})


    @global_exception_handler(5204, "Error Finding the Current Batch")
    def _find_current_batch_for_edges(
        self
    ) -> Dict[str, Dict]:
        """
        Finds edges where all input blocks have 'ready' status and returns their complete data.
        
        Returns:
            Dict[str, Dict]: Dictionary of edge IDs and their complete data where all input blocks are ready.
        """
        current_edges_batch = {}
        
        # 遍历所有边
        for edge_id, edge_data in self.all_edge_dict.items():
            # 获取这条边的所有输入块ID
            input_block_ids = edge_data.get("data", {}).get("inputs", {}).keys()
            
            # 检查是否所有输入块都是ready状态
            all_inputs_ready = True
            for block_id in input_block_ids:
                block = self.all_block_dict.get(block_id, {})
                if block.get("status") != "ready":
                    all_inputs_ready = False
                    break
            
            # 如果所有输入块都ready，将这条边添加到返回字典中
            if all_inputs_ready == True:
                current_edges_batch[edge_id] = edge_data
                
        logger.info("Found current batch of edges: %s", list(current_edges_batch.keys()))
        return current_edges_batch


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

        block_type = self.block_data[target_block_id].get("type", "text")
        if isinstance(output, (list, dict)) and block_type == "text":
            self.block_data[target_block_id]["type"] = "structured"

        if isinstance(output, str) and block_type == "structured":
            self.block_data[target_block_id]["type"] = "text"


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
                "status": "pending"
            },
            # 中间节点2: 接收来自节点1的数据，结构化数据
            "2": {
                "label":"b",
                "type": "structured",
                "data": {
                    "content": "",
                    "embedding_view": []
                },
                "status": "pending"
            },
            # 起始节点3: 文本数据，初始内容为"puppy"
            "3": {
                "label": "c",
                "type": "text",
                "data": {
                    "content": "puppy"
                },
                "status": "pending"
            },
            # 终点节点4: 接收来自节点2和3的组合处理结果
            "4": {
                "label": "d",
                "type": "text",
                "data": {
                    "content": ""
                },
                "status": "pending"
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
    
    workflow = WorkFlow()
    workflow.config_workflow_json(test_data)
    workflow.process_all()
    print(workflow.all_block_dict)
    workflow.clear_workflow()
        
