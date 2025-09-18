# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import re
import json
import logging
from typing import Any, List, Tuple, Union, Optional, Callable, Dict
from ModularEdges.ModifyEdge.modify_strategy import ModifyStrategy
from Utils.puppy_exception import PuppyException, global_exception_handler


plugin_pattern = r"\{\{(.*?)\}\}"


class ModifyEditStructured(ModifyStrategy):
    @global_exception_handler(3804, "Error Editing Structured Content")
    def modify(
        self,
    ) -> Any:
        """Execute structured operations and apply intelligent type degradation."""
        result = self._execute_operations()
        return self._apply_intelligent_type_degradation(result)
    
    def _execute_operations(self) -> Any:
        """Execute the actual structured operations without type checking."""
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
                raise PuppyException(3802, f"Error executing structured operation `{op_type}`", str(e))

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
                if isinstance(current, dict):
                    current = current[key]
                elif isinstance(current, list):
                    current = current[int(key)]
                else:
                    # 严格类型检查：只允许字典和列表进行索引访问
                    raise PuppyException(4211, f"Invalid data type for navigation: {type(current).__name__}", 
                                       f"Cannot index into {type(current).__name__} with key '{key}'. Only dict and list are supported.")
            return current, last_key, True
        except (KeyError, IndexError, ValueError):
            # 注意：移除了TypeError，让我们的类型检查异常能够传播
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
                if isinstance(current, dict):
                    current = current[key]
                elif isinstance(current, list):
                    current = current[int(key)]
                else:
                    # 严格类型检查：只允许字典和列表进行索引访问
                    # 使用PuppyException而不是TypeError，这样它不会被下面的except块捕获
                    raise PuppyException(4210, f"Invalid data type for indexing: {type(current).__name__}", 
                                       f"Cannot index into {type(current).__name__} with key '{key}'. Only dict and list are supported.")
            return current
        except (KeyError, IndexError, ValueError):
            # 注意：移除了TypeError，让我们的类型检查异常能够传播
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

    def _apply_intelligent_type_degradation(self, result: Any) -> Dict[str, Any]:
        """
        Apply intelligent type degradation based on structured content requirements.
        
        Returns a dict with:
        - type: 'structured' or 'text'
        - content: the actual content (structured or string)
        - metadata: degradation tracking info (if degraded)
        """
        # Check if result should be degraded to text
        degradation_info = self._should_degrade_to_text(result)
        
        if degradation_info["should_degrade"]:
            # Log the degradation
            self._log_degradation(degradation_info)
            
            # Convert to text representation
            text_content = self._convert_to_text_representation(result)
            
            return {
                "type": "text",
                "content": text_content,
                "metadata": {
                    "converted_from": "structured",
                    "edge_id": "edge-modify-edit_structured",
                    "reason": degradation_info["reason"],
                    "trace_id": f"trace-edit-{id(self)}"
                }
            }
        
        # Keep as structured
        return {
            "type": "structured", 
            "content": result
        }
    
    def _should_degrade_to_text(self, result: Any) -> Dict[str, Any]:
        """
        Determine if the result should be degraded to text type.
        
        Returns:
            Dict with 'should_degrade' (bool) and 'reason' (str)
        """
        # Check for empty output
        if result is None or (isinstance(result, str) and result.strip() == ""):
            return {"should_degrade": True, "reason": "empty_output"}
        
        # Check for scalar output (non-structured)
        if isinstance(result, (str, int, float, bool)):
            return {"should_degrade": True, "reason": "scalar_output"}
        
        # Check if it's a valid structured type (dict or list)
        if not isinstance(result, (dict, list)):
            return {"should_degrade": True, "reason": "mixed_content"}
        
        # For dict: check if it has the minimum structured requirements
        if isinstance(result, dict):
            # Check if it's a valid structured block format
            if not self._is_valid_structured_dict(result):
                return {"should_degrade": True, "reason": "schema_validation_failed"}
        
        # For list: check if it contains valid structured elements
        if isinstance(result, list):
            if not self._is_valid_structured_list(result):
                return {"should_degrade": True, "reason": "schema_validation_failed"}
        
        return {"should_degrade": False, "reason": ""}
    
    def _is_valid_structured_dict(self, data: dict) -> bool:
        """Check if a dict meets structured block requirements."""
        # Empty dict is not considered valid structured content
        if not data:
            return False
            
        # Check for mixed content (dict with both structured and non-structured elements)
        # A structured dict should have consistent data types
        try:
            # Try to serialize to ensure it's JSON-compatible
            json.dumps(data)
            return True
        except (TypeError, ValueError):
            return False
    
    def _is_valid_structured_list(self, data: list) -> bool:
        """Check if a list meets structured block requirements."""
        # Empty list is considered valid structured content
        if not data:
            return True
            
        try:
            # Try to serialize to ensure it's JSON-compatible
            json.dumps(data)
            
            # Check if list contains consistent data types
            # A structured list should contain similar types of elements
            if len(data) > 0:
                first_type = type(data[0])
                # Allow some variation but prefer consistency
                return True
                
        except (TypeError, ValueError):
            return False
            
        return True
    
    def _convert_to_text_representation(self, result: Any) -> str:
        """Convert any result to a stable text representation."""
        if result is None:
            return ""
        
        if isinstance(result, str):
            return result
        
        if isinstance(result, (int, float, bool)):
            return str(result)
        
        if isinstance(result, (dict, list)):
            try:
                # Use stable JSON serialization
                return json.dumps(result, ensure_ascii=False, separators=(',', ':'))
            except (TypeError, ValueError):
                return str(result)
        
        return str(result)
    
    def _log_degradation(self, degradation_info: Dict[str, Any]) -> None:
        """Log the degradation event for monitoring."""
        try:
            logging.warning(
                f"Structured content degraded to text - Reason: {degradation_info['reason']} "
                f"- Edge: edit_structured - Trace: trace-edit-{id(self)}"
            )
        except Exception:
            # Silently fail if logging is not available
            pass


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

    # === 边缘情况测试 ===
    print("\n" + "="*50)
    print("边缘情况测试 - 验证类型检查修复")
    print("="*50)
    
    edge_test_cases = [
        {
            "name": "字符串而非数组",
            "content": "should_be_array",
            "description": "传入字符串，尝试获取索引0"
        },
        {
            "name": "空字符串",
            "content": "",
            "description": "传入空字符串，尝试获取索引0"
        },
        {
            "name": "数字",
            "content": 12345,
            "description": "传入数字，尝试获取索引0"
        },
        {
            "name": "空数组",
            "content": [],
            "description": "传入空数组，尝试获取索引0"
        },
        {
            "name": "正常数组",
            "content": [{"name": "test", "food": ["apple"]}],
            "description": "传入正常数组，尝试获取索引0"
        }
    ]
    
    for test_case in edge_test_cases:
        print(f"\n测试: {test_case['name']}")
        print(f"描述: {test_case['description']}")
        print(f"输入: {test_case['content']}")
        
        # 创建get操作
        operations = [
            {
                "type": "get",
                "params": {
                    "path": ["0"],
                    "default": "Get Failed, value not exist"
                }
            }
        ]
        
        try:
            modifier = ModifyEditStructured(
                content=test_case['content'], 
                extra_configs={"operations": operations}
            )
            result = modifier.modify()
            print(f"结果: {result}")
            print("状态: ✅ 成功执行 (可能有问题)")
        except Exception as e:
            print(f"异常: {str(e)}")
            print("状态: ❌ 抛出异常 (符合预期)")
        
        print("-" * 30)
