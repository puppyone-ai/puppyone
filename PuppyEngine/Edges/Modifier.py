# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import re
import json
import copy
from typing import Any, List, Dict, Tuple, Union, Optional, Callable
from Utils.PuppyEngineExceptions import PuppyEngineException

plugin_pattern = r'\{\{(.*?)\}\}'


class StructuredNestedOperations:
    def __init__(
        self,
        data: Any
    ):
        self.data = data

    def navigate_to_parent(
        self,
        path: List[Union[str, int]]
    ) -> Tuple[Any, Any, bool]:
        if not path:
            return self.data, None, False

        current = self.data
        *parent_path, last_key = path

        try:
            for key in parent_path:
                current = current[key] if isinstance(current, dict) else current[int(key)]
            return current, last_key, True
        except (KeyError, IndexError, ValueError, TypeError):
            return self.data, None, False

    def nested_get(
        self,
        path: List[Union[str, int]],
        default: Any = None
    ) -> Any:
        current = self.data
        try:
            for key in path:
                current = current[key] if isinstance(current, dict) else current[int(key)]
            return current
        except (KeyError, IndexError, ValueError, TypeError):
            return default

    def nested_delete(
        self,
        path: List[Union[str, int]]
    ) -> Any:
        parent, last_key, success = self.navigate_to_parent(path)
        if not success:
            return self.data

        try:
            if isinstance(parent, dict):
                parent.pop(last_key, None)
            elif isinstance(parent, list):
                parent.pop(int(last_key))
        except (KeyError, IndexError, ValueError, TypeError):
            return self.data

        return self.data

    def nested_set_value(
        self,
        path: List[Union[str, int]],
        value: Any
    ) -> Any:
        if not path:
            return self.data

        self._ensure_path_exists(path[:-1])
        parent, last_key, success = self.navigate_to_parent(path)

        if success:
            try:
                if isinstance(parent, dict):
                    parent[last_key] = value
                elif isinstance(parent, list):
                    parent[int(last_key)] = value
            except (IndexError, ValueError, TypeError):
                return self.data

        return self.data

    def _ensure_path_exists(
        self,
        path: List[Union[str, int]]
    ) -> None:
        current = self.data
        for key in path:
            if isinstance(current, dict):
                current = current.setdefault(key, {})
            elif isinstance(current, list):
                index = int(key)
                while len(current) <= index:
                    current.append({})
                current = current[index]

    def nested_keys(
        self,
        max_depth: int = -1
    ) -> List[List[Union[str, int]]]:
        return self._collect_paths(self.data, [], max_depth)

    def _collect_paths(
        self,
        data: Any,
        current_path: List[Union[str, int]],
        max_depth: int,
        current_depth: int = 0
    ) -> List[List[Union[str, int]]]:
        if max_depth != -1 and current_depth >= max_depth:
            return [current_path] if current_path else []

        paths = []
        if isinstance(data, dict):
            for key, value in data.items():
                paths.extend(self._collect_paths(value, current_path + [key], max_depth, current_depth + 1))
        elif isinstance(data, list):
            for index, value in enumerate(data):
                paths.extend(self._collect_paths(value, current_path + [index], max_depth, current_depth + 1))
        else:
            paths.append(current_path)

        return paths

    def nested_values(
        self,
        max_depth: int = -1
    ) -> List[Any]:
        return [self.nested_get(path) for path in self.nested_keys(max_depth)]

    def nested_append(
        self,
        path: List[Union[str, int]],
        value: Any
    ) -> Any:
        target = self.nested_get(path)
        if isinstance(target, list):
            target.append(value)
        return self.data

    def nested_insert(
        self,
        path: List[Union[str, int]],
        index: int,
        value: Any
    ) -> Any:
        target = self.nested_get(path)
        if isinstance(target, list):
            try:
                target.insert(index, value)
            except IndexError:
                return self.data
        return self.data

    def nested_sort(
        self,
        path: List[Union[str, int]],
        key: Optional[Callable] = None,
        reverse: bool = False
    ) -> Any:
        target = self.nested_get(path)
        if isinstance(target, list):
            try:
                target.sort(key=key, reverse=reverse)
            except TypeError:
                return self.data
        return self.data

    def nested_set_operation(
        self,
        path1: List[Union[str, int]],
        path2: List[Union[str, int]],
        operation: str
    ) -> List[Any]:
        list1 = self.nested_get(path1)
        list2 = self.nested_get(path2)

        if not isinstance(list1, list) or not isinstance(list2, list):
            return []

        # Filter out unhashable elements (e.g., dicts, lists) before set operations
        def filter_hashable(lst):
            return {item for item in lst if isinstance(item, (int, float, str, tuple))}

        list1 = filter_hashable(list1)
        list2 = filter_hashable(list2)

        operations = {
            'union': set(list1) | set(list2),
            'intersection': set(list1) & set(list2),
            'difference': set(list1) - set(list2),
            'symmetric_difference': set(list1) ^ set(list2)
        }

        return list(operations.get(operation, set()))

    def replace_structured_variable_values(
        self,
        **kwargs
    ) -> Any:
        plugins = kwargs.get("plugins", {})

        def replace_value(value: Any) -> Any:
            if isinstance(value, str):
                return re.sub(plugin_pattern, lambda match: plugins.get(match.group(1), match.group(0)), value)
            elif isinstance(value, dict):
                return {k: replace_value(v) for k, v in value.items()}
            elif isinstance(value, list):
                return [replace_value(item) for item in value]
            return value

        # Start the recursive replacement from the root
        self.data = replace_value(self.data)
        return self.data


class JSONModifier(StructuredNestedOperations):
    def __init__(
        self,
        data: Any
    ):
        super().__init__(data)
        self.data = data

    def modify(
        self,
        modify_type: str,
        **kwargs
    ) -> Any:
        self.kwargs = kwargs
        match modify_type:
            case "copy":
                return self._handle_copy()
            case "convert":
                return self._handle_convert(**kwargs)
            case "edit_text":
                return self._handle_edit_text(**kwargs)
            case "edit_structured":
                return self._handle_edit_structured(**kwargs)
            case _:
                raise ValueError(f"Unsupported Modify Type: {modify_type}!")

    def _handle_copy(
        self,
    ) -> Any:
        return copy.deepcopy(self.data)

    def _handle_convert(
        self,
        **kwargs
    ) -> Any:
        source_type = kwargs.get("source_type", "text")
        target_type = kwargs.get("target_type", "structured")
        if source_type == "structured" and target_type == "text":
            return str(self.data)

        if source_type == "text" and target_type == "structured":
            target_structure = kwargs.get("target_structure", "list")
            action_type = kwargs.get("action_type", "default")
            list_separator = kwargs.get("list_separator", [])
            dict_key = kwargs.get("dict_key", "value")
            if action_type == "default":
                if list_separator:
                    self.data = self.split_string_by_multiple_delimiters(self.data, list_separator)
                return [self.data] if target_structure == "list" else {dict_key: self.data}
            else:
                return self.parse_json_from_string(self.data)

        return self.data

    def split_string_by_multiple_delimiters(
        self,
        string: str,
        delimiters: List[str]
    ) -> List[str]:
        pattern = '|'.join(map(re.escape, delimiters))
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
        dict_pattern = re.compile(r'\{[^\}]*\}')
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
        list_pattern = re.compile(r'\[[^\]]*\]')
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

    def _handle_edit_text(
        self,
        **kwargs
    ) -> str:
        plugins = kwargs.get("plugins", {})
        slice_range = kwargs.get("slice", [0, -1])
        sort_type = kwargs.get("sort_type", "")

        def replacer(match):
            key = match.group(1)
            return plugins.get(key, f"{{{{{key}}}}}")

        plugin_pattern_compiled = re.compile(plugin_pattern)
        self.data = plugin_pattern_compiled.sub(replacer, self.data)
        self.data = self.data[slice_range[0]:slice_range[1] if slice_range[1] != -1 else None]
        if sort_type in {"ascending", "descending"}:
            self.data = sorted(self.data, reverse=(sort_type == "descending"))

        return self.data

    def _handle_edit_structured(
        self,
        **kwargs
    ) -> Any:
        operations = kwargs.get("operations", [])
        result = self.data

        # If no operations specified, return original data
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
                        operation_type = op_params.get("operation", "union")
                        result = self.nested_set_operation(path1, path2, operation_type)

                    case _:
                        raise ValueError(f"Unsupported operation type: {op_type}")

            except Exception as e:
                raise PuppyEngineException(3802, f"Error executing structured operation '{op_type}'", str(e))

            finally:
                self.data = result

        return self.data


if __name__ == "__main__":
    # Test data setup
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

    print("\n=== Testing JSONModifier Operations ===\n")
    
    # Initialize modifier
    modifier = JSONModifier(nested_data)

    print("1. Testing Copy Operation")
    print("-" * 50)
    copied_data = modifier.modify("copy")
    print("Deep copy created:", copied_data == nested_data and copied_data is not nested_data)

    print("\n2. Testing Convert Operations")
    print("-" * 50)
    # Test text to structured conversion
    text_data = '{"name": "Test", "values": [1, 2, 3]}'
    text_modifier = JSONModifier(text_data)
    structured_result = text_modifier.modify("convert", 
                                          source_type="text", 
                                          target_type="structured",
                                          action_type="json")
    print("Text to structured:", structured_result)

    # Test structured to text conversion
    structured_to_text = modifier.modify("convert", 
                                       source_type="structured", 
                                       target_type="text")
    print("Structured to text:", structured_to_text)

    print("\n3. Testing Edit Text Operations")
    print("-" * 50)
    text_with_vars = "Hello {{name}}! Your score is {{score}}"
    text_modifier = JSONModifier(text_with_vars)
    replaced_text = text_modifier.modify("edit_text", plugins={"name": "Alice", "score": "95"})
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
    modifier = JSONModifier(nested_data)
    result = modifier.modify("edit_structured", operations=operations)
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
    modifier = JSONModifier(nested_data)
    result = modifier.modify("edit_structured", operations=operations)
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
    modifier = JSONModifier(nested_data)
    result = modifier.modify("edit_structured", operations=operations)
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
    modifier = JSONModifier(nested_data)
    result = modifier.modify("edit_structured", operations=operations)
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
    modifier = JSONModifier(nested_data)
    result = modifier.modify("edit_structured", operations=operations)
    print("Set union result:", result)

    # Test variable replacement in structured data
    operations = [
        {
            "type": "variable_replace",
            "params": {
                "plugins": {"template_name": "custom_template"}
            }
        }
    ]
    modifier = JSONModifier(nested_data)
    result = modifier.modify("edit_structured", operations=operations)
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
    modifier = JSONModifier(nested_data)
    result = modifier.modify("edit_structured", operations=chained_operations)
    print("Chained operations result:", result)

    # Test error handling
    print("\n6. Testing Error Handling")
    print("-" * 50)
    modifier = JSONModifier(nested_data)
    try:
        invalid_operations = [
            {
                "type": "invalid_operation",
                "params": {}
            }
        ]
        modifier.modify("edit_structured", operations=invalid_operations)
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
        result = modifier.modify("edit_structured", operations=invalid_path)
        print("Get with invalid path returns default:", result)
    except Exception as e:
        print("Error with invalid path:", str(e))

    # Test variable replacement
    print("\n7. Testing variable replacement")
    print("-" * 50)
    modifier = JSONModifier(nested_data)
    result = modifier.modify("edit_structured", operations=[
        {
            "type": "variable_replace",
            "params": {
                "plugins": {"template_name": "custom_template"}
            }
        }
    ])
    print("After variable replacement:", result)
