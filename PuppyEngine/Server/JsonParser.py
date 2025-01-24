# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import re
from typing import List, Dict, Any
from concurrent.futures import ThreadPoolExecutor
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
        self.placeholder_pattern = r"\{\{(.*?)\}\}"
        self.unsupported_structure_error = "Unsupported structured text format. Only list and dict are supported."

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
            "search": self._handle_search_edge,
            "code": self._handle_code_edge,
            "ifelse": self._handle_ifelse_edge,
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
        edge_dict["data"]["looped"] = []
        edge_type = edge_dict.get("type", "")
        if edge_type in edge_handlers:
            return edge_handlers[edge_type](edge_dict)
        return edge_dict

    @global_exception_handler(5103, "Error Extracting Content")
    def _extract_content(
        self,
        block_id: str,
        edge_dict: Dict[str, dict],
        edge_key_name: str,
        content_key_name: str
    ) -> Dict[str, dict]:
        block = self.block_data.get(block_id)
        if block.get("type") == "structured" and block.get("looped", False):
            edge_dict["data"]["looped"].append(edge_key_name)
            block_content = block.get("data", {}).get(content_key_name)
            if isinstance(block_content, list):
                edge_dict["data"][edge_key_name] = [str(item) for item in block_content]
            elif isinstance(block_content, dict):
                edge_dict["data"][edge_key_name] = {str({key: val}) for key, val in block_content.items()}
            else:
                raise ValueError(self.unsupported_structure_error)
        else:
            edge_dict["data"][edge_key_name] = block.get("data", {}).get(content_key_name)

        return edge_dict

    @global_exception_handler(5104, "Error Getting Plugin Details")
    def _get_placeholder_dict(
        self,
        edge_dict: Dict[str, dict],
        edge_key_name: str
    ) -> Dict[str, dict]:
        for block_id, label in edge_dict.get("data").get("inputs").items():
            block_id_key = block_id
            if block_id in edge_dict.get("data").get("inputs").values():
                block_id_key = [key for key, value in edge_dict.get("data").get("inputs").items() if value == block_id][0]

            block = self.block_data.get(block_id_key)

            if block.get("type") == "structured" and block.get("looped", False):
                edge_dict["data"]["looped"].append(block_id)
                block_content = block.get("data", {}).get("content")
                if isinstance(block_content, list):
                    edge_dict["data"][edge_key_name][block_id] = [str(item) for item in block_content]
                elif isinstance(block_content, dict):
                    edge_dict["data"][edge_key_name][block_id] = {str({key: val}) for key, val in block_content.items()}
                else:
                    raise ValueError(self.unsupported_structure_error)
            else:
                edge_dict["data"][edge_key_name][block_id] = block.get("data", {}).get("content")

        return edge_dict

    def _handle_llm_variable_replacement(
        self,
        edge_config: Dict[str, Any]
    ) -> List[List[Dict[str, Any]]]:
        nested_message_list = []

        message_list = edge_config.get("data", {}).get("messages", [])
        local_combinations = [{}]

        # First pass: collect all looped combinations
        for message in message_list:
            message_content = message.get("content")
            placeholders = re.findall(self.placeholder_pattern, message_content)

            for block_id in placeholders:
                block = self.block_data.get(block_id, {})
                content = block.get("data", {}).get("content", "")
                is_looped = block.get("type") == "structured" and block.get("data", {}).get("looped", False)

                if is_looped:
                    local_combinations = self._handle_loop_variable_replacement(content, block_id, local_combinations)

        # Second pass: generate nested messages for each combination
        input_labels = edge_config.get("data", {}).get("inputs", {})
        nested_message_list = self._handle_local_combinations(local_combinations, message_list, nested_message_list, input_labels)

        return nested_message_list

    def _handle_local_combinations(
        self,
        local_combinations: List[Dict[str, Any]],
        message_list: List[Dict[str, Any]],
        nested_message_list: List[List[Dict[str, Any]]],
        input_labels: Dict[str, str]
    ) -> List[Dict[str, Any]]:
        # Second pass: generate nested messages for each combination
        for combo in local_combinations:
            current_messages = []
            for message in message_list:
                message_role = message.get("role", "user")
                message_content = message.get("content")
                message_content = self._handle_variable_replace(message_content, combo, input_labels)
                current_messages.append({"role": message_role, "content": message_content})

            nested_message_list.append(current_messages)

        if len(nested_message_list) == 1:
            nested_message_list = nested_message_list[0]
        return nested_message_list

    def _handle_variable_replace(
        self,
        message_content: str,
        combo: Dict[str, Any],
        input_labels: Dict[str, str]
    ) -> str:
        placeholders = re.findall(self.placeholder_pattern, message_content)
        for block_id in placeholders:
            block_id_key = block_id
            if block_id in input_labels.values():
                block_id_key = [key for key, value in input_labels.items() if value == block_id][0]

            block = self.block_data.get(block_id_key, {})
            content = block.get("data", {}).get("content", "")
            is_looped = block.get("type") == "structured" and block.get("data", {}).get("looped", False)

            if is_looped:
                content = combo.get(block_id, "")
            else:
                content = content if isinstance(content, str) else str(content)

            message_content = message_content.replace(f"{{{{{block_id}}}}}", content)
        return message_content

    def _handle_loop_variable_replacement(
        self,
        content: str,
        block_id: str,
        local_combinations: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        if isinstance(content, list):
            content = [item if isinstance(item, str) else str(item) for item in content]
        elif isinstance(content, dict):
            content = [str({k: v}) for k, v in content.items()]

        # Create combinations for looped placeholders
        local_combinations = [
            {**combo, block_id: value}
            for combo in local_combinations
            for value in content
        ]
        return local_combinations

    def _handle_modify_replacement(
        self,
        edge_dict: Dict[str, Any]
    ) -> Dict[str, Any]:
        content = edge_dict.get("data", {}).get("content")

        def replace_placeholders(text, input_labels):
            placeholders = re.findall(self.placeholder_pattern, text)
            for block_id in placeholders:
                block_id_key = block_id
                if block_id in input_labels.values():
                    block_id_key = [key for key, value in input_labels.items() if value == block_id][0]
                block = self.block_data.get(block_id_key, {})
                block_content = block.get("data", {}).get("content", "")
                text = text.replace(f"{{{{{block_id}}}}}", str(block_content))
            return text

        input_labels = edge_dict.get("data", {}).get("inputs", {})
        if isinstance(content, str):
            content_parsed = replace_placeholders(content, input_labels)
        elif isinstance(content, list):
            content_parsed = [replace_placeholders(item, input_labels) for item in content if isinstance(item, str)]
        elif isinstance(content, dict):
            content_parsed = {
                key: replace_placeholders(value, input_labels) if isinstance(value, str) else value
                for key, value in content.items()
            }
        else:
            content_parsed = content

        edge_dict["data"]["content"] = content_parsed
        return edge_dict

    @global_exception_handler(5105, "Error Handling LLM Edge")
    def _handle_llm_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        edge_dict["data"]["messages"] = self._handle_llm_variable_replacement(edge_dict)
        return edge_dict

    @global_exception_handler(5106, "Error Handling Modify Edge")
    def _handle_modify_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        edge_dict = self._handle_modify_replacement(edge_dict)
        edge_data = edge_dict.get("data")
        if edge_data.get("modify_type") in {"edit_text", "edit_structured"}:
            if "extra_configs" not in edge_dict["data"]:
                edge_dict["data"]["plugins"] = {}
                edge_dict["data"]["extra_configs"] = {}
            edge_dict = self._get_placeholder_dict(edge_dict, "plugins")
            return edge_dict

        source_block_id = list(edge_data.get("inputs").keys())[0]
        edge_dict = self._extract_content(source_block_id, edge_dict, "content", "content")

        return edge_dict

    @global_exception_handler(5107, "Error Handling Chunk Edge")
    def _handle_chunk_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        return self._extract_content(list(edge_dict.get("data").get("inputs").keys())[0], edge_dict, "doc", "content")

    @global_exception_handler(5109, "Error Handling Search Edge")
    def _handle_search_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        query_block_id = list(edge_dict.get("data", {}).get("query_id", {}).keys())[0]
        edge_dict = self._extract_content(query_block_id, edge_dict, "query", "content")

        if edge_dict.get("data", {}).get("search_type", "") == "rag":
            doc_block_id = list(edge_dict.get("data", {}).get("docs_id", "").keys())[0]
            edge_dict = self._extract_content(doc_block_id, edge_dict, "docs", "embedding_view")
            edge_dict["data"]["extra_configs"]["docs"] = edge_dict["docs"]
        return edge_dict

    @global_exception_handler(5110, "Error Handling Code Edge")
    def _handle_code_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        edge_dict["data"]["arg_values"] = {}
        return self._get_placeholder_dict(edge_dict, "arg_values")

    @global_exception_handler(5112, "Error Handling If-Else Edge")
    def _handle_ifelse_edge(
        self,
        edge_dict: Dict[str, dict]
    ) -> Dict[str, dict]:
        edge_dict["data"]["content_blocks"] = {}
        return self._get_placeholder_dict(edge_dict, "content_blocks")


if __name__ == "__main__":
    import json
    with open("PuppyEngine/TestKit/ifelse.json", "r") as file:
        flow_json = json.load(file)

    block_data = flow_json.get("blocks", {})
    edge_data = flow_json.get("edges", {})
    print("Original Edge:", edge_data)
    parser = JsonParser(block_data, edge_data)
    print("After Edge: ", parser.parse(edge_data.values()))
