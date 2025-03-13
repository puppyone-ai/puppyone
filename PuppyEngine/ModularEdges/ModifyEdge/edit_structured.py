# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import re
from typing import Any, List, Tuple, Union, Optional, Callable
from ModularEdges.ModifyEdge.modify_strategy import ModifyStrategy
from Utils.puppy_exception import puppy_exception, global_exception_handler


plugin_pattern = r"\{\{(.*?)\}\}"


class ModifyEditStructured(ModifyStrategy):
    @global_exception_handler(3804, "Error Editing Structured Content")
    def modify(
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
                        result = self._nested_get(path, default)

                    case "delete":
                        path = op_params.get("path", [])
                        result = self._nested_delete(path)

                    case "append":
                        path = op_params.get("path", [])
                        value = op_params.get("value")
                        result = self._nested_append(path, value)

                    case "insert":
                        path = op_params.get("path", [])
                        index = op_params.get("index", 0)
                        value = op_params.get("value")
                        result = self._nested_insert(path, index, value)

                    case "sort":
                        path = op_params.get("path", [])
                        reverse = op_params.get("reverse", False)
                        result = self._nested_sort(path, reverse=reverse)

                    case "set_value":
                        path = op_params.get("path", [])
                        value = op_params.get("value")
                        result = self._nested_set_value(path, value)

                    case "get_keys":
                        max_depth = op_params.get("max_depth", -1)
                        result = self._nested_keys(max_depth)

                    case "get_values":
                        max_depth = op_params.get("max_depth", -1)
                        result = self._nested_values(max_depth)

                    case "variable_replace":
                        plugins = op_params.get("plugins", {})
                        result = self._replace_structured_variable_values(plugins=plugins)

                    case "set_operation":
                        path1 = op_params.get("path1", [])
                        path2 = op_params.get("path2", [])
                        value1 = op_params.get("value1", None)
                        value2 = op_params.get("value2", None)
                        operation_type = op_params.get("operation", "union")
                        result = self._nested_set_operation(operation_type, path1, path2, value1, value2)

                    case _:
                        raise ValueError(f"Unsupported operation type: {op_type}")

            except Exception as e:
                raise puppy_exception(3802, f"Error executing structured operation `{op_type}`", str(e))

            finally:
                self.content = result

        return self.content

    def _navigate_to_parent(
        self,
        path: List[Union[str, int]]
    ) -> Tuple[Any, Any, bool]:
        if not path:
            return self.content, None, False

        current = self.content
        *parent_path, last_key = path

        try:
            for key in parent_path:
                current = current[key] if isinstance(current, dict) else current[int(key)]
            return current, last_key, True
        except (KeyError, IndexError, ValueError, TypeError):
            return self.content, None, False

    @global_exception_handler(4200, "Error Getting Nested Value")
    def _nested_get(
        self,
        path: List[Union[str, int]],
        default: Any = None
    ) -> Any:
        current = self.content
        try:
            if path == ["*"]:
                return current
            for key in path:
                current = current[key] if isinstance(current, dict) else current[int(key)]
            return current
        except (KeyError, IndexError, ValueError, TypeError):
            return default

    @global_exception_handler(4201, "Error Deleting Nested Value")
    def _nested_delete(
        self,
        path: List[Union[str, int]]
    ) -> Any:
        parent, last_key, success = self._navigate_to_parent(path)
        if not success:
            return self.content

        try:
            if isinstance(parent, dict):
                parent.pop(last_key, None)
            elif isinstance(parent, list):
                parent.pop(int(last_key))
        except (KeyError, IndexError, ValueError, TypeError):
            return self.content

        return self.content

    @global_exception_handler(4202, "Error Setting Nested Value")
    def _nested_set_value(
        self,
        path: List[Union[str, int]],
        value: Any
    ) -> Any:
        if not path:
            return self.content

        self._ensure_path_exists(path[:-1])
        parent, last_key, success = self._navigate_to_parent(path)

        if success:
            try:
                if isinstance(parent, dict):
                    parent[last_key] = value
                elif isinstance(parent, list):
                    parent[int(last_key)] = value
            except (IndexError, ValueError, TypeError):
                return self.content

        return self.content

    def _ensure_path_exists(
        self,
        path: List[Union[str, int]]
    ) -> None:
        current = self.content
        for key in path:
            if isinstance(current, dict):
                current = current.setdefault(key, {})
            elif isinstance(current, list):
                index = int(key)
                while len(current) <= index:
                    current.append({})
                current = current[index]

    @global_exception_handler(4203, "Error Ensuring Path Exists")
    def _nested_keys(
        self,
        max_depth: int = -1
    ) -> List[List[Union[str, int]]]:
        return self._collect_paths(self.content, [], max_depth)

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

    @global_exception_handler(4204, "Error Getting Nested Values")
    def _nested_values(
        self,
        max_depth: int = -1
    ) -> List[Any]:
        return [self._nested_get(path) for path in self._nested_keys(max_depth)]

    @global_exception_handler(4205, "Error Appending Nested Value")
    def _nested_append(
        self,
        path: List[Union[str, int]],
        value: Any
    ) -> Any:
        target = self._nested_get(path)
        if isinstance(target, list):
            target.append(value)
        return self.content

    @global_exception_handler(4206, "Error Inserting Nested Value")
    def _nested_insert(
        self,
        path: List[Union[str, int]],
        index: int,
        value: Any
    ) -> Any:
        target = self._nested_get(path)
        if isinstance(target, list):
            try:
                target.insert(index, value)
            except IndexError:
                return self.content
        return self.content

    @global_exception_handler(4207, "Error Sorting Nested Value")
    def _nested_sort(
        self,
        path: List[Union[str, int]],
        key: Optional[Callable] = None,
        reverse: bool = False
    ) -> Any:
        target = self._nested_get(path)
        if isinstance(target, list):
            try:
                target.sort(key=key, reverse=reverse)
            except TypeError:
                return self.content
        return self.content

    @global_exception_handler(4208, "Error Setting Nested Operation")
    def _nested_set_operation(
        self,
        operation: str,
        path1: List[Union[str, int]],
        path2: List[Union[str, int]],
        value1: Any = None,
        value2: Any = None
    ) -> List[Any]:
        if value1 and value2 and isinstance(value1, list) and isinstance(value2, list):
            list1 = value1
            list2 = value2
        else:
            list1 = self._nested_get(path1)
            list2 = self._nested_get(path2)

            if not isinstance(list1, list) or not isinstance(list2, list):
                return []

        # Filter out unhashable elements (e.g., dicts, lists) before set operations
        def filter_hashable(lst):
            return {item for item in lst if isinstance(item, (int, float, str, tuple))}

        list1 = filter_hashable(list1)
        list2 = filter_hashable(list2)

        operations = {
            "union": set(list1) | set(list2),
            "intersection": set(list1) & set(list2),
            "difference": set(list1) - set(list2),
            "symmetric_difference": set(list1) ^ set(list2)
        }

        return list(operations.get(operation, set()))

    @global_exception_handler(4209, "Error Replacing Structured Variable Values")
    def _replace_structured_variable_values(
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
        self.content = replace_value(self.content)
        return self.content


if __name__ == "__main__":
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

    # Test nested get
    operations = [
        {
            "type": "get",
            "params": {
                "path": ["users", 0, "name"]
            }
        }
    ]
    result = ModifyEditStructured(content=nested_data, extra_configs={"operations": operations}).modify()
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
    result = ModifyEditStructured(content=nested_data, extra_configs={"operations": operations}).modify()
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
    result = ModifyEditStructured(content=nested_data, extra_configs={"operations": operations}).modify()
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
    result = ModifyEditStructured(content=nested_data, extra_configs={"operations": operations}).modify()
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
    result = ModifyEditStructured(content=nested_data, extra_configs={"operations": operations}).modify()
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
    result = ModifyEditStructured(content=nested_data, extra_configs={"operations": operations}).modify()
    print("After variable replacement:", result)

    # Test chained operations
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
    result = ModifyEditStructured(content=nested_data, extra_configs={"operations": chained_operations}).modify()
    print("After chained operations:", result)
