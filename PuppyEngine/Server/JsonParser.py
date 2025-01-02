# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import re
from typing import Tuple, List, Dict, Any
from concurrent.futures import ThreadPoolExecutor
from Server.StructuredConverter import StructuredConverter
from Utils.PuppyEngineExceptions import global_exception_handler


class JsonParser:
    """
    JSONParser is responsible for parsing and processing JSON data representing blocks and edges in a workflow.
    """

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
        self.structured_converter = StructuredConverter(block_data)

    @global_exception_handler(5100, "Error Parsing Input Block IDs")
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

    @global_exception_handler(5101, "Error Parsing Output Block IDs")
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

    @global_exception_handler(5102, "Error Parsing Edge")
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

    @global_exception_handler(5103, "Error Extracting Content")
    def _extract_content(
        self,
        block_id: str
    ) -> str:
        return self.block_data.get(block_id).get("data", {}).get("content", "")

    @global_exception_handler(5104, "Error Getting Plugin Details")
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

    def _process_placeholders_in_extra_configs(
        self,
        edge_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        extra_configs = edge_data.get("extra_configs", {})

        for key, value in extra_configs.items():
            if isinstance(value, str):
                # Replace all placeholders matching the pattern {{xxx}}
                placeholders = re.findall(r"\{\{(.*?)\}\}", value)
                for block_id in placeholders:
                    content = self._extract_content(block_id)
                    value = value.replace(f"{{{{{block_id}}}}}", content)
                extra_configs[key] = value

        return extra_configs

    @global_exception_handler(5105, "Error Handling LLM Edge")
    def _handle_llm_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        return self._get_plugin_details(edge_dict)

    @global_exception_handler(5106, "Error Handling Modify Edge")
    def _handle_modify_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        edge_data = edge_dict.get("data")
        if edge_data.get("modify_type") in {"modify_text", "modify_structured"}:
            edge_dict = self._get_plugin_details(edge_dict)
            edge_dict["data"]["extra_configs"] = {}
            edge_dict["data"]["extra_configs"]["plugins"] = edge_dict["data"]["plugins"]
            return edge_dict

        source_block_id = list(edge_data.get("inputs").keys())[0]
        edge_dict["data"]["content"] = self._extract_content(source_block_id)
        edge_dict["data"]["extra_configs"] = self._process_placeholders_in_extra_configs(edge_data)

        return edge_dict

    @global_exception_handler(5107, "Error Handling Chunk Edge")
    def _handle_chunk_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        block = self.block_data.get(list(edge_dict.get("data").get("inputs").keys())[0])
        edge_dict["data"]["doc"] = block.get("data", {}).get("embedding_view", [])
        looped = block.get("data", {}).get("looped", False)
        block_type = block.get("type", "")
        edge_dict["data"]["looped"] = True if looped and block_type == "structured" else False
        return edge_dict

    @global_exception_handler(5108, "Error Handling Embedding Edge")
    def _handle_embedding_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        source_block_id = list(edge_dict.get("data", {}).get("inputs", {}).keys())[0]
        edge_dict["data"]["chunks"] = self.block_data.get(source_block_id).get("data", {}).get("embedding_view", [])
        return edge_dict

    @global_exception_handler(5109, "Error Handling Search Edge")
    def _handle_search_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        query_block_id = list(edge_dict.get("data", {}).get("query_id", {}).keys())[0]
        edge_dict["data"]["query"] = self._extract_content(query_block_id)
        if edge_dict.get("data", {}).get("search_type", "") == "rag":
            doc_block_id = list(edge_dict.get("data", {}).get("docs_id", "").keys())[0]
            edge_dict["data"]["docs"] = self.block_data.get(doc_block_id).get("data", {}).get("embedding_view", [])
        return edge_dict

    @global_exception_handler(5110, "Error Handling Code Edge")
    def _handle_code_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        return self._get_plugin_details(edge_dict)

    @global_exception_handler(51112, "Error Handling Choose Edge")
    def _handle_choose_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        edge_dict["data"]["content"] = self._extract_content(list(edge_dict.get("data", {}).get("content", {}).keys())[0])
        edge_dict["data"]["switch"] = self._extract_content(list(edge_dict.get("data", {}).get("switch", {}).keys())[0])
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
