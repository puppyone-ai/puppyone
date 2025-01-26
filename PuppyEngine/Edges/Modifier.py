# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import re
import copy
from typing import Any, List, Dict, Optional, Callable
from Utils.PuppyEngineExceptions import PuppyEngineException

plugin_pattern = r'\{\{(.*?)\}\}'


class StringModifier:
    def __init__(
        self,
        string: str
    ):
        self.string = string
    
    def append_string(
        self,
        string2: str
    ) -> Any:
        return self.string + string2

    def slice_string(
        self,
        start: int,
        end: int
    ) -> str:
        return self.string[start:end]

    def deep_copy_string(
        self,
    ) -> Any:
        return copy.deepcopy(self.string)

    def plugin_replace_string(
        self,
        plugins: Dict[str, str],
    ) -> str:
        def replacer(match):
            key = match.group(1)
            return plugins.get(key, f"{{{{{key}}}}}")

        plugin_pattern_compiled = re.compile(plugin_pattern)
        self.string = plugin_pattern_compiled.sub(replacer, self.string)
        return self.string


class ListModifier:
    def __init__(
        self,
        lst: List[Any]
    ):
        self.lst = lst
    
    def get(
        self,
        key: str
    ) -> Any:
        return self.lst[int(key)]

    def slice_list(
        self,
        start: int,
        end: int
    ) -> List[Any]:
        return self.lst[start:end]

    def append_element(
        self,
        item: Any
    ) -> list:
        self.lst.append(item)
        return self.lst

    def insert_element(
        self,
        index: int,
        item: Any
    ) -> list:
        self.lst.insert(index, item)
        return self.lst

    def list_concatenation(
        self,
        lst2: List[Any]
    ) -> List[Any]:
        return self.lst + lst2

    def list_repetition(
        self,
        n: int
    ) -> List[Any]:
        return self.lst * n

    def modify_element(
        self,
        index: int,
        value: Any
    ) -> list:
        self.lst[index] = value
        return self.lst

    def pop_element(
        self,
        index: int
    ) -> Any:
        return self.lst.pop(index)

    def sort_list(
        self,
        key: Optional[Callable] = None,
        reverse: bool = False
    ) -> list:
        def default_key(item: Any) -> Any:
            try:
                return key(item) if key else (str(type(item)), str(item))
            except Exception as e:
                return str(item) + str(e)

        self.lst.sort(key=default_key, reverse=reverse)
        return self.lst

    def reversed_copy(
        self
    ) -> list:
        return list(reversed(self.lst))

    def deep_copy_list(
        self
    ) -> list:
        return copy.deepcopy(self.lst)

    def set_intersection(
        self,
        lst2: list
    ) -> list:
        return list(set(self.lst) & set(lst2))

    def set_union(
        self,
        lst2: list
    ) -> list:
        return list(set(self.lst) | set(lst2))

    def set_difference(
        self,
        lst2: list
    ) -> list:
        return list(set(self.lst) - set(lst2))

    def plugin_replace_list(
        self,
        plugins: Dict[str, str],
    ) -> List[Any]:
        def replace_item(item):
            if isinstance(item, str):
                return re.sub(plugin_pattern, lambda match: plugins.get(match.group(1), match.group(0)), item)
            return item

        self.lst = [replace_item(item) for item in self.lst]
        return self.lst


class DictModifier:
    def __init__(
        self,
        dct: Dict[str, Any]
    ):
        self.dct = dct
    
    def get(
        self,
        key: Any,
        default_value: Any = None
    ) -> Any:
        current_value = self.dct

        if isinstance(key, (list, tuple)):
            # Navigate the nested dictionary
            for k in key:
                if isinstance(current_value, dict) and k in current_value:
                    current_value = current_value[k]
                else:
                    return default_value
            return current_value

        return current_value.get(key, default_value)

    def get_keys(
        self
    ) -> List[Any]:
        return list(self.dct.keys())

    def get_values(
        self
    ) -> List[Any]:
        return list(self.dct.values())

    def pop_element_dict(
        self,
        key: Any,
        default_value: Any = None
    ) -> Any:
        return self.dct.pop(key, default_value)

    def merge_dicts(
        self,
        dct2: Dict[Any, Any]
    ) -> Dict[Any, Any]:
        return self.dct | dct2

    def deep_copy_dict(
        self
    ) -> Dict[Any, Any]:
        return copy.deepcopy(self.dct)

    def find_key_with_value(
        self,
        desired_value: Any
    ) -> Any:
        return next((key for key, value in self.dct.items() if value == desired_value), None)

    def intersection_of_keys(
        self,
        dct2: Dict[Any, Any]
    ) -> List[Any]:
        return list(self.dct.keys() & dct2.keys())

    def union_of_keys(
        self,
        dct2: Dict[Any, Any]
    ) -> List[Any]:
        return list(self.dct.keys() | dct2.keys())

    def difference_of_keys(
        self,
        dct2: Dict[Any, Any]
    ) -> List[Any]:
        return list(self.dct.keys() - dct2.keys())

    def symmetric_difference_of_keys(
        self,
        dct2: Dict[Any, Any]
    ) -> List[Any]:
        return list(self.dct.keys() ^ dct2.keys())

    def plugin_replace_dict(
        self,
        plugins: Dict[str, str],
    ) -> Dict[Any, Any]:
        def replace_value(value):
            if isinstance(value, str):
                return re.sub(plugin_pattern, lambda match: plugins.get(match.group(1), match.group(0)), value)
            return value

        self.dct = {key: replace_value(value) for key, value in self.dct.items()}
        return self.dct


class JSONModifier:
    def __init__(
        self,
        data: Any
    ):
        self.data = data
        self.str_modifier = StringModifier(self.data)
        self.list_modifier = ListModifier(self.data)
        self.dict_modifier = DictModifier(self.data)

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
            separator = kwargs.get("separator", " ")
            if target_structure == "list":
                return self.data.split(separator)
            if target_structure == "dict":
                return {separator: self.data}

        return self.data
   
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
        plugins = kwargs.get("plugins", {})

        def replace_value(value):
            if isinstance(value, str):
                return re.sub(plugin_pattern, lambda match: plugins.get(match.group(1), match.group(0)), value)
            return value

        if isinstance(self.data, list):
            self.data = [replace_value(item) for item in self.data]
        elif isinstance(self.data, dict):
            self.data = {key: replace_value(value) for key, value in self.data.items()}

        return self.data

    # For future development
    def modify2(
        self,
        operations: List[Dict[str, Any]]
    ) -> Any:
        for operation in operations:
            modify_type = operation.get("modify_type")
            kwargs = {key: value for key, value in operation.items() if key != "modify_type"}
            self.data = self._apply_modification(modify_type, **kwargs)
        return self.data

    def _apply_modification(
        self,
        modify_type: str,
        **kwargs
    ) -> Any:
        content_type = type(self.data).__name__
        match content_type:
            case "list":
                return self._handle_list_modifications(modify_type, **kwargs)
            case "dict":
                return self._handle_dict_modifications(modify_type, **kwargs)
            case _:
                raise ValueError(f"Unsupported Content Type: {content_type}!")

    def _handle_str_modifications(
        self,
        modify_type: str
    ) -> Any:
        str_operations = {
            "append": lambda: self.str_modifier.append_string(self.kwargs.get("string2", "")),
            "slice": lambda: self.str_modifier.slice_string(self.kwargs.get("start", 0), self.kwargs.get("end", -1)),
            "deep_copy": lambda: self.str_modifier.deep_copy_string(),
            "modify_text": lambda: self.str_modifier.plugin_replace_string(self.kwargs.get("plugins", {}))
        }

        if modify_type in str_operations:
            try:
                return str_operations[modify_type]()
            except Exception as e:
                raise ValueError(3800, "Error Executing String Operation", str(e))
        else:
            raise ValueError(f"Unsupported String Operation: {modify_type}!")

    def _handle_list_modifications(
        self,
        modify_type: str
    ) -> Any:
        list_operations = {
            "get": lambda: self.list_modifier.get(self.kwargs.get("key", "0")),
            "slice": lambda: self.list_modifier.slice_list(self.kwargs.get("start", 0), self.kwargs.get("end", -1)),
            "append": lambda: self.list_modifier.append_element(self.kwargs.get("item")),
            "insert": lambda: self.list_modifier.insert_element(self.kwargs.get("index", 0), self.kwargs.get("item")),
            "concatenation": lambda: self.list_modifier.list_concatenation(self.kwargs.get("lst2")),
            "repetition": lambda: self.list_modifier.list_repetition(self.kwargs.get("n", 1)),
            "modify_element": lambda: self.list_modifier.modify_element(self.kwargs.get("index", 0), self.kwargs.get("value")),
            "pop_element": lambda: self.list_modifier.pop_element(self.kwargs.get("index", 0)),
            "sort": lambda: self.list_modifier.sort_list(self.kwargs.get("key"), self.kwargs.get("reverse", False)),
            "reversed_copy": self.list_modifier.reversed_copy,
            "deep_copy": self.list_modifier.deep_copy_list,
            "intersection": lambda: self.list_modifier.set_intersection(self.kwargs.get("lst2")),
            "union": lambda: self.list_modifier.set_union(self.kwargs.get("lst2")),
            "difference": lambda: self.list_modifier.set_difference(self.kwargs.get("lst2")),
            "modify_structured": lambda: self.list_modifier.plugin_replace_list(self.kwargs.get("plugins", {}))
        }

        if modify_type in list_operations:
            try:
                return list_operations[modify_type]()
            except Exception as e:
                raise PuppyEngineException(3801, "Error Executing List Operation", str(e))
        else:
            raise ValueError(f"Unsupported List Operation: {modify_type}!")

    def _handle_dict_modifications(
        self,
        modify_type: str
    ) -> Any:
        dict_operations = {
            "get": lambda: self.dict_modifier.get(self.kwargs.get("key"), self.kwargs.get("default_value")),
            "get_keys": self.dict_modifier.get_keys,
            "get_values": self.dict_modifier.get_values,
            "pop_element": lambda: self.dict_modifier.pop_element_dict(self.kwargs.get("key"), self.kwargs.get("default_value")),
            "merge": lambda: self.dict_modifier.merge_dicts(self.kwargs.get("dct2")),
            "deep_copy": self.dict_modifier.deep_copy_dict,
            "find_key_with_value": lambda: self.dict_modifier.find_key_with_value(self.kwargs.get("desired_value")),
            "intersection": lambda: self.dict_modifier.intersection_of_keys(self.kwargs.get("dct2")),
            "union": lambda: self.dict_modifier.union_of_keys(self.kwargs.get("dct2")),
            "difference": lambda: self.dict_modifier.difference_of_keys(self.kwargs.get("dct2")),
            "symmetric_difference": lambda: self.dict_modifier.symmetric_difference_of_keys(self.kwargs.get("dct2")),
            "modify_structured": lambda: self.dict_modifier.plugin_replace_dict(self.kwargs.get("plugins", {}))
        }

        if modify_type in dict_operations:
            try:
                return dict_operations[modify_type]()
            except Exception as e:
                raise PuppyEngineException(3802, "Error Executing Dict Operation", str(e))
        else:
            raise ValueError(f"Unsupported Dict Operation: {modify_type}!")


if __name__ == "__main__":
    # Initialize a BlockModifier instance for str
    str_data = "Hello, world!{{abc}}"
    block_modifier = JSONModifier(str_data)
    print("Appended string:", block_modifier.modify("append", string2=" How are you?"))
    print("Sliced string:", block_modifier.modify("slice", start=7, end=12))
    print("Deep copy of the string:", block_modifier.modify("deep_copy"))
    print("After string plugin replacement:", block_modifier.modify("modify_text", plugins={"abc": "cba"}))
    
    # Initialize a BlockModifier instance for list
    list_data = [1, 2, 3, 4, 5, "{{abc}}", "{{def}}"]
    block_modifier = JSONModifier(list_data)
    print("Access element at index 1:", block_modifier.modify("get", key="1"))
    print("Slice the list from index 1 to 3:", block_modifier.modify("slice", start=1, end=3))
    block_modifier.modify("append", item=6)
    print("After appending 6:", block_modifier.data)
    block_modifier.modify("insert", index=2, item=7)
    print("After inserting 7 at index 2:", block_modifier.data)
    concatenated_list = block_modifier.modify("concatenation", lst2=[10, 11])
    print("Concatenated list:", concatenated_list)
    repeated_list = block_modifier.modify("repetition", n=2)
    print("Repeated list:", repeated_list)
    block_modifier.modify("modify_element", index=1, value=20)
    print("After modifying element at index 1:", block_modifier.data)
    popped_element = block_modifier.modify("pop_element", index=0)
    print("Popped element at index 0:", popped_element)
    print("After popping element:", block_modifier.data)
    block_modifier.modify("sort", reverse=False)
    print("After sorting:", block_modifier.data)
    block_modifier.modify("reversed_copy")
    print("After reversing:", block_modifier.data)
    deep_copy = block_modifier.modify("deep_copy")
    print("Deep copy of the list:", deep_copy)
    set_intersection = block_modifier.modify("intersection", lst2=[5, 6, 7])
    print("Set intersection:", set_intersection)
    set_union = block_modifier.modify("union", lst2=[5, 6, 7])
    print("Set union:", set_union)
    set_difference = block_modifier.modify("difference", lst2=[5, 6, 7])
    print("Set difference:", set_difference)
    print("After list plugin replacement:", block_modifier.modify("modify_structured", plugins={"abc": "cba"}))

    # Initialize a BlockModifier instance for dict
    dict_data = {"a": 1, "b": 2, "c": 3, "replaced": "{{abc}}"}
    block_modifier = JSONModifier(dict_data)
    print("\nOriginal dict:", block_modifier.data)
    print("Get value for key b:", block_modifier.modify("get", key="b"))
    print("Keys in dict:", block_modifier.modify("get_keys"))
    print("Values in dict:", block_modifier.modify("get_values"))
    popped_value = block_modifier.modify("pop_element", key="b")
    print("Popped value for key b:", popped_value)
    print("After popping b:", block_modifier.data)
    merged_dict = block_modifier.modify("merge", dct2={"d": 4, "e": 5})
    print("Merged dict:", merged_dict)
    deep_copy_dict = block_modifier.modify("deep_copy")
    print("Deep copy of the dict:", deep_copy_dict)
    key_with_value = block_modifier.modify("find_key_with_value", desired_value=7)
    print("Key with value 7:", key_with_value)
    set_intersection_keys = block_modifier.modify("intersection", dct2={"f": 10, "a": 11})
    print("Intersection of keys:", set_intersection_keys)
    set_union_keys = block_modifier.modify("union", dct2={"f": 10, "a": 11})
    print("Union of keys:", set_union_keys)
    set_difference_keys = block_modifier.modify("difference", dct2={"f": 10, "a": 11})
    print("Difference of keys:", set_difference_keys)
    print("After dict plugin replacement:", block_modifier.modify("modify_structured", plugins={"abc": "cba"}))
 