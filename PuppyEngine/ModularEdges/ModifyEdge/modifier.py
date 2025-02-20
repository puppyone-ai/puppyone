# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import re
import json
import copy
from typing import Any, List, Dict, Union
from ModularEdges.EdgeFactoryBase import EdgeFactoryBase
from ModularEdges.ModifyEdge.edit_structured import StructuredNestedOperations
from Utils.PuppyEngineExceptions import PuppyEngineException, global_exception_handler


plugin_pattern = r"\{\{(.*?)\}\}"


class Modifier(StructuredNestedOperations):
    def __init__(
        self,
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None,
    ):
        super().__init__(init_configs.get("content"))
        self.init_configs = init_configs
        self.extra_configs = extra_configs
        self.content = init_configs.get("content")

    def modify(
        self
    ) -> Any:
        modify_type = self.init_configs.get("modify_type")
        match modify_type:
            case "copy":
                return self._handle_copy()
            case "convert":
                return self._handle_convert()
            case "edit_text":
                return self._handle_edit_text()
            case "edit_structured":
                return self._handle_edit_structured()
            case _:
                raise ValueError(f"Unsupported execute Type: {modify_type}!")

    @global_exception_handler(4210, "Error Copying Block Content")
    def _handle_copy(
        self,
    ) -> Any:
        return copy.deepcopy(self.content)

    @global_exception_handler(4211, "Error Converting Block Content")
    def _handle_convert(
        self,
    ) -> Any:
        source_type = self.extra_configs.get("source_type", "text")
        target_type = self.extra_configs.get("target_type", "structured")
        if source_type == "structured" and target_type == "text":
            return str(self.content)

        if source_type == "text" and target_type == "structured":
            target_structure = self.extra_configs.get("target_structure", "list")
            action_type = self.extra_configs.get("action_type", "default")
            list_separator = self.extra_configs.get("list_separator", [])
            dict_key = self.extra_configs.get("dict_key", "value")
            if action_type == "default":
                if list_separator:
                    self.content = self.split_string_by_multiple_delimiters(self.content, list_separator)
                return [self.content] if target_structure == "list" else {dict_key: self.content}
            else:
                return self.parse_json_from_string(self.content)

        return self.content

    def split_string_by_multiple_delimiters(
        self,
        string: str,
        delimiters: List[str]
    ) -> List[str]:
        pattern = "|".join(map(re.escape, delimiters))
        return re.split(pattern, string)

    def parse_json_from_string(
        self,
        input_str: str
    ) -> Union[Dict[str, Any], List[Any]]:
        """
        Parses all valid lists and dicts from a string.

        - If there is only one list without context, return that list.
        - If there is only one dict, return that dict.
        - If multiple standalone lists are found, merge them into a nested dictionary with auto-generated keys.
        - If lists are found within a dict context, preserve their original keys.
        - If multiple dicts are found, merge them.
        - If no valid JSON structures are found, return `{"original": input_str}`.

        Args:
            input_str (str): The input string containing potential JSON structures.

        Returns:
            Union[Dict[str, Any], List[Any]]: A structured representation of extracted JSON elements.
        """
        try:
            # First try to parse the entire string as a valid JSON
            return json.loads(input_str)
        except json.JSONDecodeError:
            # If that fails, try to extract individual JSON structures
            parsed_lists = []
            parsed_dicts = []

            # Extract valid dictionaries
            parsed_dicts = self._extract_valid_dicts(input_str, parsed_dicts)

            # Extract valid standalone lists (not within dicts)
            parsed_lists = self._extract_valid_lists(input_str, parsed_dicts, parsed_lists)

            # Match the extracted structures
            merged_data = self.match_structured_cases(parsed_lists, parsed_dicts)

            # If unmatched, return original input in a default dict
            return merged_data if merged_data else {"original": input_str}

    def _extract_valid_dicts(
        self,
        input_str: str,
        parsed_dicts: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        dict_pattern = re.compile(r"\{[^\}]*\}")
        for match in dict_pattern.findall(input_str):
            try:
                parsed_dict = json.loads(match)
                if isinstance(parsed_dict, dict):
                    parsed_dicts.append(parsed_dict)
            except json.JSONDecodeError:
                continue
        return parsed_dicts

    def _extract_valid_lists(
        self,
        input_str: str,
        parsed_dicts: List[Dict[str, Any]],
        parsed_lists: List[Any]
    ) -> List[Any]:
        list_pattern = re.compile(r"\[[^\]]*\]")
        for match in list_pattern.findall(input_str):
            try:
                # Check if this list is not already part of a parsed dict
                is_standalone = True
                for d in parsed_dicts:
                    if match in str(d.values()):
                        is_standalone = False
                        break

                if is_standalone:
                    parsed_list = json.loads(match)
                    if isinstance(parsed_list, list):
                        parsed_lists.append(parsed_list)
            except json.JSONDecodeError:
                continue
        return parsed_lists

    def match_structured_cases(
        self,
        parsed_lists: List[Any],
        parsed_dicts: List[Any]
    ) -> Union[Dict[str, Any], List[Any]]:
        # If only one standalone list, return it
        if len(parsed_lists) == 1 and not parsed_dicts:
            return parsed_lists[0]

        # Start with an empty result dict
        merged_data = {}

        # If we have dicts, merge them first
        for dct in parsed_dicts:
            merged_data.update(dct)

        # Add any standalone lists with auto-generated keys
        for i, lst in enumerate(parsed_lists, start=1):
            merged_data[f"list_{i}"] = lst

        return merged_data

    @global_exception_handler(4212, "Error Editing Text")
    def _handle_edit_text(
        self,
    ) -> str:
        plugins = self.extra_configs.get("plugins", {})
        slice_range = self.extra_configs.get("slice", [0, -1])
        sort_type = self.extra_configs.get("sort_type", "")

        def replacer(match):
            key = match.group(1)
            return plugins.get(key, f"{{{{{key}}}}}")

        plugin_pattern_compiled = re.compile(plugin_pattern)
        self.content = plugin_pattern_compiled.sub(replacer, self.content)
        self.content = self.content[slice_range[0]:slice_range[1] if slice_range[1] != -1 else None]
        if sort_type in {"ascending", "descending"}:
            self.content = "".join(sorted(self.content, reverse=(sort_type == "descending")))
        return self.content

    @global_exception_handler(4213, "Error Editing Structured Content")
    def _handle_edit_structured(
        self,
    ) -> Any:
        operations = self.extra_configs.get("operations", [])
        result = self.content

        # If no operations specified, return original content
        if not operations:
            return result

        for operation in operations:
            op_type = operation.get("type", "")
            op_params = operation.get("params", {})

            try:
                match op_type:
                    case "get":
                        path = op_params.get("path", [])
                        default = op_params.get("default")
                        result = self.nested_get(path, default)

                    case "delete":
                        path = op_params.get("path", [])
                        result = self.nested_delete(path)

                    case "append":
                        path = op_params.get("path", [])
                        value = op_params.get("value")
                        result = self.nested_append(path, value)

                    case "insert":
                        path = op_params.get("path", [])
                        index = op_params.get("index", 0)
                        value = op_params.get("value")
                        result = self.nested_insert(path, index, value)

                    case "sort":
                        path = op_params.get("path", [])
                        reverse = op_params.get("reverse", False)
                        result = self.nested_sort(path, reverse=reverse)

                    case "set_value":
                        path = op_params.get("path", [])
                        value = op_params.get("value")
                        result = self.nested_set_value(path, value)

                    case "get_keys":
                        max_depth = op_params.get("max_depth", -1)
                        result = self.nested_keys(max_depth)

                    case "get_values":
                        max_depth = op_params.get("max_depth", -1)
                        result = self.nested_values(max_depth)

                    case "variable_replace":
                        plugins = op_params.get("plugins", {})
                        result = self.replace_structured_variable_values(plugins=plugins)

                    case "set_operation":
                        path1 = op_params.get("path1", [])
                        path2 = op_params.get("path2", [])
                        value1 = op_params.get("value1", None)
                        value2 = op_params.get("value2", None)
                        operation_type = op_params.get("operation", "union")
                        result = self.nested_set_operation(operation_type, path1, path2, value1, value2)

                    case _:
                        raise ValueError(f"Unsupported operation type: {op_type}")

            except Exception as e:
                raise PuppyEngineException(3802, f"Error executing structured operation `{op_type}`", str(e))

            finally:
                self.content = result

        return self.content


class ModifierFactory(EdgeFactoryBase):
    @classmethod
    def execute(
        cls,
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> Any:
        return Modifier(init_configs, extra_configs).modify()

if __name__ == "__main__":
    # Test Content setup
    nested_data = {
        "users": [
            {"id": 1, "name": "Alice", "scores": [85, 90, 78]},
            {"id": 2, "name": "Bob", "scores": [92, 88, 95]},
            {"id": 3, "name": "Charlie", "scores": [75, 80, 85]}
        ],
        "settings": {
            "theme": "dark",
            "notifications": True,
            "template": "{{template_name}}"
        },
        "lists": {
            "list1": [1, 2, 3, 4, 5],
            "list2": [4, 5, 6, 7, 8]
        }
    }

    print("\n=== Testing ModifierFactory Operations ===\n")
    print("1. Testing Copy Operation")
    print("-" * 50)
    copied_data = ModifierFactory.execute(init_configs={"modify_type": "copy"})
    print("Deep copy created:", copied_data == nested_data and copied_data is not nested_data)

    print("\n2. Testing Convert Operations")
    print("-" * 50)
    # Test text to structured conversion
    text_data = "{'name': 'Test', 'values': [1, 2, 3]}"
    structured_result = ModifierFactory.execute(
        init_configs={"content": text_data, "modify_type": "convert"}, 
        extra_configs={"source_type": "text", 
                        "target_type": "structured",
                        "action_type": "json"})
    print("Text to structured:", structured_result)

    # Test structured to text conversion
    structured_to_text = ModifierFactory.execute(
        init_configs={"content": structured_result, "modify_type": "convert"}, 
        extra_configs={"source_type": "structured", 
                        "target_type": "text"})
    print("Structured to text:", structured_to_text)

    print("\n3. Testing Edit Text Operations")
    print("-" * 50)
    text_with_vars = "Hello {{name}}! Your score is {{score}}"
    replaced_text = ModifierFactory.execute(
        init_configs={"content": text_with_vars, "modify_type": "edit_text"}, 
        extra_configs={"plugins": {"name": "Alice", "score": "95"}})
    print("Variable replacement:", replaced_text)

    print("\n4. Testing Edit Structured Operations")
    print("-" * 50)

    # Test nested get
    operations = [
        {
            "type": "get",
            "params": {
                "path": ["users", 0, "name"]
            }
        }
    ]
    result = ModifierFactory.execute(
        init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
        extra_configs={"operations": operations})
    print("Get operation result:", result)

    # Test nested set_value
    operations = [
        {
            "type": "set_value",
            "params": {
                "path": ["settings", "theme"],
                "value": "light"
            }
        }
    ]
    result = ModifierFactory.execute(
        init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
        extra_configs={"operations": operations})
    print("After set_value:", result)

    # Test nested append
    operations = [
        {
            "type": "append",
            "params": {
                "path": ["users", 0, "scores"],
                "value": 100
            }
        }
    ]
    result = ModifierFactory.execute(
        init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
        extra_configs={"operations": operations})
    print("After append:", result)

    # Test nested sort
    operations = [
        {
            "type": "sort",
            "params": {
                "path": ["users", 0, "scores"],
                "reverse": True
            }
        }
    ]
    result = ModifierFactory.execute(
        init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
        extra_configs={"operations": operations})
    print("After sort:", result)

    # Test set operations
    operations = [
        {
            "type": "set_operation",
            "params": {
                "path1": ["lists", "list1"],
                "path2": ["lists", "list2"],
                "operation": "union"
            }
        }
    ]
    result = ModifierFactory.execute(
        init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
        extra_configs={"operations": operations})
    print("Set union result:", result)

    # Test variable replacement in structured content
    operations = [
        {
            "type": "variable_replace",
            "params": {
                "plugins": {"template_name": "custom_template"}
            }
        }
    ]
    result = ModifierFactory.execute(
        init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
        extra_configs={"operations": operations})
    print("After variable replacement:", result)

    # Test chained operations
    print("\n5. Testing Chained Operations")
    print("-" * 50)
    chained_operations = [
        {
            "type": "sort",
            "params": {
                "path": ["users", 0, "scores"],
                "reverse": True
            }
        },
        {
            "type": "get",
            "params": {
                "path": ["users", 0, "scores"],
                "default": []
            }
        }
    ]
    result = ModifierFactory.execute(
        init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
        extra_configs={"operations": chained_operations})
    print("Chained operations result:", result)

    # Test error handling
    print("\n6. Testing Error Handling")
    print("-" * 50)
    try:
        invalid_operations = [
            {
                "type": "invalid_operation",
                "params": {}
            }
        ]
        result = ModifierFactory.execute(
            init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
            extra_configs={"operations": invalid_operations})
    except Exception as e:
        print("Expected error caught:", str(e))

    try:
        invalid_path = [
            {
                "type": "get",
                "params": {
                    "path": ["nonexistent", "path"]
                }
            }
        ]
        result = ModifierFactory.execute(
            init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
            extra_configs={"operations": invalid_path})
        print("Get with invalid path returns default:", result)
    except Exception as e:
        print("Error with invalid path:", str(e))

    # Test variable replacement
    print("\n7. Testing variable replacement")
    print("-" * 50)
    result = ModifierFactory.execute(
        init_configs={"content": nested_data, "modify_type": "edit_structured"}, 
        extra_configs={"operations": [
            {
                "type": "variable_replace",
                "params": {
                    "plugins": {"template_name": "custom_template"}
                }
            }
        ]})
    print("After variable replacement:", result)
