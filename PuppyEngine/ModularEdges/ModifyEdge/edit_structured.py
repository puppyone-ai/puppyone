# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import re
from typing import Any, List, Tuple, Union, Optional, Callable
from Utils.PuppyEngineExceptions import global_exception_handler


plugin_pattern = r"\{\{(.*?)\}\}"


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

    @global_exception_handler(4200, "Error Getting Nested Value")
    def nested_get(
        self,
        path: List[Union[str, int]],
        default: Any = None
    ) -> Any:
        current = self.data
        try:
            if path == ["*"]:
                return current
            for key in path:
                current = current[key] if isinstance(current, dict) else current[int(key)]
            return current
        except (KeyError, IndexError, ValueError, TypeError):
            return default

    @global_exception_handler(4201, "Error Deleting Nested Value")
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

    @global_exception_handler(4202, "Error Setting Nested Value")
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

    @global_exception_handler(4203, "Error Ensuring Path Exists")
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

    @global_exception_handler(4204, "Error Getting Nested Values")
    def nested_values(
        self,
        max_depth: int = -1
    ) -> List[Any]:
        return [self.nested_get(path) for path in self.nested_keys(max_depth)]

    @global_exception_handler(4205, "Error Appending Nested Value")
    def nested_append(
        self,
        path: List[Union[str, int]],
        value: Any
    ) -> Any:
        target = self.nested_get(path)
        if isinstance(target, list):
            target.append(value)
        return self.data

    @global_exception_handler(4206, "Error Inserting Nested Value")
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

    @global_exception_handler(4207, "Error Sorting Nested Value")
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

    @global_exception_handler(4208, "Error Setting Nested Operation")
    def nested_set_operation(
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
            "union": set(list1) | set(list2),
            "intersection": set(list1) & set(list2),
            "difference": set(list1) - set(list2),
            "symmetric_difference": set(list1) ^ set(list2)
        }

        return list(operations.get(operation, set()))

    @global_exception_handler(4209, "Error Replacing Structured Variable Values")
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

