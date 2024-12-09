# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from typing import List, Dict, Any
from concurrent.futures import ThreadPoolExecutor
from Utils.PuppyEngineExceptions import global_exception_handler


class JsonParser:
    """
    JSONParser is responsible for parsing and processing JSON data representing blocks and edges in a workflow.
    """

    @global_exception_handler(8300, "Error Initializing JSONParser")
    def __init__(
        self,
        block_data: Dict[str, dict],
        edges_data: Dict[str, dict]
    ):
        """
        Initializes the JSONParser with block and edge data.

        Args:
            block_data (Dict[str, dict]): JSON data containing block information.
            edges_data (Dict[str, dict]): JSON data containing edge information.
        """

        self.block_data = block_data
        self.edge_data = edges_data
    
    def parse_inputs(
        self
    ) -> Dict[str, set]:
        """
        Parses the inputs of the edge data.

        Returns:
            Dict[str, set]: The edge data with parsed inputs.
        """

        return {
            edge_id: set(edge_data["data"]["inputs"].keys())
            for edge_id, edge_data in self.edge_data.items()
            if "data" in edge_data and "inputs" in edge_data["data"]
        }
    
    def parse_outputs(
        self
    ) -> Dict[str, set]:
        """
        Parses the outputs of the edge data.
        
        Returns:
            Dict[str, set]: The edge data with parsed outputs.
        """
 
        return {
            edge_id: set(edge_data["data"]["outputs"].keys())
            for edge_id, edge_data in self.edge_data.items()
            if "data" in edge_data and "outputs" in edge_data["data"]
        }

    @global_exception_handler(8301, "Error Parsing Edge")
    def parse(
        self,
        edge_dicts: List[Dict[str, dict]]
    ) -> List[Dict[str, dict]]:
        edge_handlers = {
            "llm": self._handle_llm_edge,
            "modify": self._handle_modify_edge,
            "chunk": self._handle_chunk_edge,
            "embedding": self._handle_embedding_edge,
            "search": self._handle_search_edge,
            "code": self._handle_code_edge,
            "choose": self._handle_choose_edge,
        }

        result_edges = []
        with ThreadPoolExecutor() as executor:
            results = [
                executor.submit(self.parse_edge, edge_dict, edge_handlers)
                for edge_dict in edge_dicts
            ]

            for future in results:
                result_edges.append(future.result())

        return result_edges

    def parse_edge(
        self,
        edge_dict: Dict[str, dict],
        edge_handlers: Any
    ) -> Dict[str, dict]:
        if "plugins" not in edge_dict.get("data"):
            edge_dict["data"]["plugins"] = {}

        edge_type = edge_dict.get("type", "")
        if edge_type in edge_handlers:
            return edge_handlers[edge_type](edge_dict)
        return edge_dict

    @global_exception_handler(8308, "Error Extracting Content")
    def _extract_content(
        self,
        block_id: str
    ) -> str:
        return self.block_data.get(block_id).get("data", {}).get("content", "")

    def _get_plugin_details(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        for block_id, label in edge_dict.get("data").get("inputs").items():
            source_content = self._extract_content(block_id)
            if label:
                block_id = label
            edge_dict["data"]["plugins"][block_id] = source_content
        return edge_dict

    @global_exception_handler(8302, "Error Handling LLM Edge")
    def _handle_llm_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        return self._get_plugin_details(edge_dict)

    @global_exception_handler(8306, "Error Handling Modify Edge")
    def _handle_modify_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        edge_data = edge_dict.get("data")
        if edge_data.get("modify_type") in {"deep_copy", "get"}:
            source_block_id = list(edge_data.get("inputs").keys())[0]
            edge_dict["data"]["content"] = self._extract_content(source_block_id)
            return edge_dict

        return self._get_plugin_details(edge_dict)

    @global_exception_handler(8303, "Error Handling Chunk Edge")
    def _handle_chunk_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        is_loop = edge_dict.get("data").get("looped", False)
        if is_loop:
            doc_content = [item for sublist in (self._extract_content(block_id) for block_id in edge_dict.get("data").get("inputs").keys()) for item in sublist]
        else:
            doc_content = "".join([self._extract_content(block_id) for block_id in edge_dict.get("data").get("inputs").keys()])
        
        edge_dict["data"]["doc"] = doc_content
        return edge_dict

    @global_exception_handler(8302, "Error Handling Embedding Edge")
    def _handle_embedding_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        source_block_id = list(edge_dict.get("data").get("inputs").keys())[0]
        edge_dict["data"]["chunks"] = self._extract_content(source_block_id)
        return edge_dict

    @global_exception_handler(8304, "Error Handling Search Edge")
    def _handle_search_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        query_block_id = list(edge_dict.get("data").get("inputs").keys())[0]
        edge_dict["data"]["query"] = self._extract_content(query_block_id)
        return edge_dict

    @global_exception_handler(8302, "Error Handling Code Edge")
    def _handle_code_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        return self._get_plugin_details(edge_dict)
    
    @global_exception_handler(8306, "Error Handling Choose Edge")
    def _handle_choose_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        edge_dict["data"]["content"] = self._extract_content(list(edge_dict.get("data").get("content").keys())[0])
        edge_dict["data"]["switch"] = self._extract_content(list(edge_dict.get("data").get("switch").keys())[0])
        return edge_dict


if __name__ == "__main__":
    import json
    with open("PuppyEngine/TestKit/flow_test.json", "r") as file:
        flow_json = json.load(file)

    block_data = flow_json.get("blocks", {})
    edge_data = flow_json.get("edges", {})
    print("Original Edge:", edge_data)
    parser = JsonParser(block_data, edge_data)
    print("After Edge: ", parser.parse(edge_data.values()))
