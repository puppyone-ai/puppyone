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
from Server.JsonConverter import JsonConverter
from Utils.PuppyEngineExceptions import global_exception_handler


class WorkFlow:
    """
    WorkFlow is responsible for executing the entire flow
    """

    def __init__(
        self,
        latest_version: str = "0.1"
    ):
        """
        Initialize the states for the WorkFlow object.
        """

        self.latest_version = latest_version
        self.processed_block_ids = set()
        self.current_block_ids = set()

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
        - self.block_data will contain the blocks dictionary above
        - self.edge_data will contain the edges dictionary above
        - self.edge_inputs will be: {"llm-1727235281399": ["3"]}
        - self.edge_outputs will be: {"llm-1727235281399": ["2"]}
        """

        # Convert the JSON data to the latest version
        self.version_id = json_data.get("version", "0.1")
        if self.version_id != self.latest_version:
            converter = JsonConverter(self.latest_version)
            json_data = converter.convert(json_data)

        self.block_data = json_data.get("blocks", [])
        self.edge_data = json_data.get("edges", [])
        self.parser = JsonParser(self.block_data, self.edge_data)
        self.edge_inputs = self.parser.parse_inputs()
        self.edge_outputs = self.parser.parse_outputs()

    @global_exception_handler(5201, "Error Clearing Workflow")
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

    # process the workflow
    # TODO： this part requires changing the logic
    @global_exception_handler(5202, "Error Processing All Blocks", True)
    def process_all(
        self
    ):
        """
        Begins processing with the first batch of blocks and continues until all blocks are processed.

        Yields:
            dict: The data of each processed block.
        """

        # Initialize the workflow by finding blocks that have no incoming edges
        # These blocks will be our starting points for processing
        self.current_block_ids = self._find_first_batch()

        # Continue processing as long as there are blocks in the current batch
        while self.current_block_ids:
            # Initialize set to store the next batch of block IDs to process
            next_block_ids = set()
            
            # Process thecurrent batch of blocks and get IDs of completed blocks
            # finished_ids contains block IDs that were output targets of processed edges
            finished_ids = self._execute_batch(self.current_block_ids)

            # Temporary dictionary to collect processed blocks before yielding
            yield_dict = {}

            # Process each completed block
            for finished_id in finished_ids:
                # Add this block to the next batch for further processing
                next_block_ids.add(finished_id)
                # Mark this block as processed to avoid reprocessing
                self.processed_block_ids.add(finished_id)

                # Retrieve the block data and determine its type
                block = self.block_data.get(finished_id, {})
                block_type = block.get("type", "text")
                
                # Handle different block types:
                # - For text blocks: use as is
                # - For structured blocks: JSON stringify the content
                if block_type == "text":
                    dumped_block = block
                else:
                    dumped_block = {
                        **block,
                        "data": {
                            **block["data"],
                            "content": json.dumps(block["data"]["content"])
                        }
                    }
                
                # Process any unicode characters in the content
                # This ensures proper encoding of special characters
                content = dumped_block.get("data", {}).get("content", "")
                dumped_block["data"]["content"] = self._unicode_formatting(content, block_type)

                # Store the processed block in the yield dictionary
                yield_dict[finished_id] = dumped_block
                logger.info("Yielded Data for ID - %s:\n%s", finished_id, dumped_block)

            # Yield the batch of processed blocks
            yield yield_dict
            # Clear the dictionary for the next iteration
            yield_dict.clear()

            # Update current_block_ids for the next iteration
            # This will contain blocks that were output targets in this iteration
            self.current_block_ids = next_block_ids
            logger.info("Next batch: %s", next_block_ids)

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

    @global_exception_handler(5203, "Error Finding the First Batch")
    def _find_first_batch(
        self
    ) -> Set[str]:
        """
        Finds blocks that are not targets of any edges, marking them as the starting point for processing.

        Example:
        Given this configuration:
        {
            "blocks": {
                "2": {
                    "type": "structured",
                    "data": {"content": ""}
                },
                "3": {
                    "type": "text",
                    "data": {"content": "puppy"}
                }
            },
            "edges": {
                "llm-1727235281399": {
                    "type": "llm",
                    "data": {
                        "inputs": {"3": "c"},
                        "outputs": {"2": "b"}
                    }
                }
            }
        }

        This method will return:
        {"3"}
        
        Because:
        1. Block "3" is only used as input (in edge_inputs) but never as output
        2. Block "2" is a target (appears in edge_outputs) so it's not included
        3. Therefore, block "3" is our starting point
        """

        outputs = {value for values in self.edge_outputs.values() for value in values}
        self.processed_block_ids = {
            block_id
            for block_id in self.block_data.keys()
            if block_id not in outputs
        }
        logger.info("Beginning Blocks: %s", self.processed_block_ids)

        return self.processed_block_ids

    @global_exception_handler(5204, "Error Finding Valid Edges")
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

    # execute for each batch step
    @global_exception_handler(5205, "Error Executing Batch")
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
        
        # Extract edge data for parsing
        edge_data_list = [edge[1] for edge in valid_edges]
        
        # Parse the edge data
        parsed_edge_results = self.parser.parse(edge_data_list)
        
        # Combine original edge IDs with parsed results
        parsed_edges = []
        for edge, parsed_edge in zip(valid_edges, parsed_edge_results):
            edge_id = edge[0]
            parsed_edges.append((edge_id, parsed_edge))
            
        logger.info("Parsed Edges: %s", parsed_edges)

        # Process each valid edge concurrently
        with concurrent.futures.ThreadPoolExecutor() as executor:
            # Create futures list
            futures = []
            for parsed_edge in parsed_edges:
                future = executor.submit(self._process_edge, parsed_edge)
                futures.append(future)
            
            # Process completed futures
            for future in concurrent.futures.as_completed(futures):
                results = future.result()
                for result in results:
                    yield result


    # process each edge logic
    @global_exception_handler(5206, "Error Processing Edge")
    def _process_edge(
        self,
        edge_info: Tuple[str, Dict[str, str]]
    ) -> Tuple[Any, str]:
        """
        Process the edge, processes it, updates the target block with the result.

        Args:
            edge_info (tuple): Edge id and the dictionary containing edge data.

        Returns:
            Tuple[Any, str]: The ID of the target block.
        """
        
        # Unpack the edge_info tuple into edge_id and edge_dict
        edge_id, edge_dict = edge_info
        
        # Get the target block IDs that this edge should output to
        target_block_ids = self.edge_outputs[edge_id]
        if not target_block_ids:
            raise ValueError("Invalid edge: Output block IDs are missing")

        # Extract edge type and data from the edge dictionary
        # edge_type could be: 'llm', 'ifelse', 'modify', etc.
        edge_type = edge_dict.get("type", {})
        # edge_data contains the specific configuration for this edge
        edge_data = edge_dict.get("data", {})
        if not edge_type:
            raise ValueError("Invalid edge: Edge type is missing")

        # Process the edge using the Edge class and get the output
        # The output format depends on the edge type:
        # - 'llm' edge: returns a string (the LLM response)
        # - 'ifelse' edge: returns a dict mapping {source_block_id: target_block_id}
        # - 'modify' edge: returns either string or structured data (list/dict)
        # - ...
        # IMPORTANT: Different edge types produce different output formats
        output = Edge(edge_type, edge_data).process()
        logger.info("Output: %s", output)

        # Special handling for 'ifelse' edge type
        if edge_type == "ifelse":
            # Reset target_block_ids as it will be populated based on conditions
            target_block_ids = []
            # output here is a dictionary mapping source blocks to target blocks
            for from_block, to_block in output.items():
                # Add the selected target block to the list
                target_block_ids.append(to_block)
                # Copy the content from source block to target block
                self.block_data[to_block]["data"]["content"] = self.block_data.get(from_block, {}).get("data", {}).get("content", "")
        else:
            # For all other edge types (llm, modify, etc.)
            for target_block_id in target_block_ids:
                # Validate and potentially update the block type based on output
                self._valid_output_block_type(target_block_id, output)
                # Update the target block's content with the processed output
                self.block_data[target_block_id]["data"]["content"] = output

        # Return the list of target block IDs that were updated
        return target_block_ids

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
    
    test_kit = 'TestKit/'
    workflow = WorkFlow()
    for file_name in os.listdir(test_kit):
        # if file_name != "modify_text.json":
        #     continue
        if file_name in {"embedding_search.json", "concurrency.json", "loop_modify_get.json", "loop_modify_structured.json", "modify_get.json", "modify_structured.json", "multiple_output_edge.json"}:
            continue
        # if file_name.startswith("modify") or file_name.startswith("loop_modify"):
        #     continue
        file_path = os.path.join(test_kit, file_name)
        print(f"========================= {file_name} =========================")
        with open(file_path, encoding="utf-8") as f:
            data = json.load(f)

        workflow.config_workflow_json(data)
        for block in workflow.process_all():
            print(block)
        workflow.clear_workflow()
        
