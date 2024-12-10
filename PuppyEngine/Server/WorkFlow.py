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
from Edges.edges import Edge
from Server.JsonParser import JsonParser
from Utils.PuppyEngineExceptions import PuppyEngineException, global_exception_handler


class WorkFlow:
    """
    WorkFlow is responsible for executing the entire flow
    """

    def __init__(
        self,
    ):
        """
        Initialize the states for the WorkFlow object.
        """

        self.processed_block_ids = set()
        self.current_block_ids = set()
    
    def config_workflow_json(
        self,
        json_data: Dict[str, Dict[str, str]]
    ):
        """
        Reconfigure the WorkFlow object with block and edge data from JSON.

        Args:
            json_data (dict): Dictionary containing block and edge data.
        """

        self.block_data = json_data.get("blocks", [])
        self.edge_data = json_data.get("edges", [])
        self.parser = JsonParser(self.block_data, self.edge_data)
        self.edge_inputs = self.parser.parse_inputs()
        self.edge_outputs = self.parser.parse_outputs()
    
    def clear_workflow(
        self
    ):
        """
        Clear the current workflow data.
        """

        self.block_data = {}
        self.edge_data = {}
        self.parser = None
        self.edge_inputs = {}
        self.edge_outputs = {}
        self.processed_block_ids = set()
        self.current_block_ids = set()

    def process_all(
        self
    ):
        """
        Begins processing with the first batch of blocks and continues until all blocks are processed.

        Yields:
            dict: The data of each processed block.
        """

        # Start processing with the first batch of blocks
        self.current_block_ids = self._find_first_batch()
        while self.current_block_ids:
            next_block_ids = set()
            # _execute_batch returns the ids of the blocks that have been updated
            finished_ids = self._execute_batch(self.current_block_ids)

            for finished_id in finished_ids:
                next_block_ids.add(finished_id)
                self.processed_block_ids.add(finished_id)

                block = self.block_data[finished_id]
                if block["type"] == "text":
                    dumped_block = block
                else:
                    dumped_block = {
                        **block,
                        "data": {
                            **block["data"],
                            "content": json.dumps(block["data"]["content"])
                        }
                    }
                logging.info("Yielded Data: %s", dumped_block)
                yield dumped_block
            self.current_block_ids = next_block_ids
            logging.info("Next batch: %s", next_block_ids)

    @global_exception_handler(6200, "Error finding first batch")
    def _find_first_batch(
        self
    ) -> Set[str]:
        """
        Finds blocks that are not targets of any edges, marking them as the starting point for processing.

        Returns:
            Set[str]: A set of block IDs that are the starting points.
        """

        outputs = {value for values in self.edge_outputs.values() for value in values}
        self.processed_block_ids = {
            block_id
            for block_id in self.block_data.keys()
            if block_id not in outputs
        }
        logger.info("Beginning Blocks: %s", self.processed_block_ids)

        return self.processed_block_ids

    @global_exception_handler(6303, "Error finding valid edges")
    def _find_valid_edges(
        self,
        block_ids: List[str]
    ) -> List[Tuple[str, Dict[str, str]]]:
        """
        Find valid edges connected to the given blocks. Identifies edges where all input IDs are already processed, making them valid for processing.

        Args:
            block_ids (list): The ID of the block to find edges for.

        Returns:
            List[dict]: A list of valid edge dictionaries.
        """
        
        # Collect all connected edges for the given block IDs
        connected_edge_dicts = [
            (edge_id, edge_dict)
            for edge_id, edge_dict in self.edge_data.items()
            if any(
                block_id in self.edge_inputs[edge_id]
                for block_id in block_ids
            )
        ]

        # Filter for valid edges and remove duplicates efficiently
        valid_edge_dicts = []
        for edge_id, edge_dict in connected_edge_dicts:
            if all(
                input_id in self.processed_block_ids
                for input_id in self.edge_inputs[edge_id]
            ) and edge_dict not in valid_edge_dicts:
                    valid_edge_dicts.append((edge_id, edge_dict))

        return valid_edge_dicts

    @global_exception_handler(6400, "Error executing batch")
    def _execute_batch(
        self,
        block_ids: Set[str]
    ):
        """
        Uses a thread pool to execute a batch of blocks concurrently., yielding results as they complete.

        Args:
            block_ids (Set[str]): A set of block IDs to be processed.

        Yields:
            Any: The result of processing each block.
        """

        # Find all the connected edges and parse them
        valid_edges = self._find_valid_edges(block_ids)
        parsed_edges = [
            (edge[0], parsed_edge)
            for edge, parsed_edge in zip(valid_edges, self.parser.parse([edge[1] for edge in valid_edges]))
        ]
        logger.info("Parsed Edges: %s", parsed_edges)

        # Process each valid edge concurrently
        with concurrent.futures.ThreadPoolExecutor() as executor:
            futures = [executor.submit(self._process_edge, parsed_edge) for parsed_edge in parsed_edges]
            for future in concurrent.futures.as_completed(futures):
                results = future.result()
                for result in results:
                    yield result

    @global_exception_handler(6300, "Error processing edge")
    def _process_edge(
        self,
        edge_info: Tuple[str, Dict[str, str]]
    ) -> Tuple[Any, str]:
        """
        Process the edge, processes it, updates the target block with the result, and handles specific configurations for embedding edges.

        Args:
            edge_info (tuple): Edge id and the dictionary containing edge data.

        Returns:
            Tuple[Any, str]: The ID of the target block.
        """

        edge_id, edge_dict = edge_info
        target_block_ids = self.edge_outputs[edge_id]
        if not target_block_ids:
            raise PuppyEngineException(6301, "Invalid edge: Output block IDs are missing")

        edge_type = edge_dict.get("type")
        edge_data = edge_dict.get("data")
        if not edge_type:
            raise PuppyEngineException(6302, "Invalid edge: Edge type is missing")

        output = Edge(edge_type, edge_data).process()
        logger.info("Output: %s", output)

        # Handling the choose edge
        if edge_type == "choose":
            target_block_ids = output
            output = edge_dict["data"]["content"]

        for target_block_id in target_block_ids:
            # Handle looped edges
            self._handle_loop_edge(edge_dict["data"], target_block_id)
            # Handle switch edges
            output = self._code_output_types_switch(edge_dict, target_block_id, output)
            # Update the block 
            self.block_data[target_block_id]["data"]["content"] = output
        return target_block_ids

    def _handle_loop_edge(
        self,
        edge_data: Dict[str, str],
        target_block_id: str
    ):
        if edge_data.get("looped", False):
            self.block_data[target_block_id]["type"] = "structured"

    def _code_output_types_switch(
        self,
        edge_dict: dict,
        target_block_id: str,
        output: Any
    ) -> Any:
        """
        Determines and updates the output type (text or structured) based on the edge type and output content.

        Args:
            edge_dict (dict): Dictionary containing edge data.
            target_block_id (str): ID of the target block to update.
            output (Any): The output to check and classify.

        Returns:
            Any: The unchanged output.
        """
        edge_type = edge_dict.get("type")
        modify_type = edge_dict.get("data", {}).get("modify_type")

        if edge_type == "code" or (edge_type == "modify" and modify_type == "modify_get"):
            self.block_data[target_block_id]["type"] = "structured" if isinstance(output, (list, dict)) else "text"

        return output


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    test_kit = 'PuppyEngine/TestKit'
    workflow = WorkFlow()
    for file_name in os.listdir(test_kit):
        file_path = os.path.join(test_kit, file_name)
        print(f"========================= {file_name} =========================")
        with open(file_path, encoding="utf-8") as f:
            data = json.load(f)

        workflow.config_workflow_json(data)
        for block in workflow.process_all():
            print(block)
        workflow.clear_workflow()
