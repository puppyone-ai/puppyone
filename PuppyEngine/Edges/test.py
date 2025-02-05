import re
import json
from typing import Any, Dict, List, Union

def parse_json_from_string(input_str: str) -> Union[Dict[str, Any], List[Any]]:
    """
    Parses all valid lists and dicts from a string.
    
    - If there is only one list, return that list.
    - If there is only one dict, return that dict.
    - If multiple lists are found, merge them into a nested dictionary (e.g., {"list_1": [...], "list_2": [...]}).
    - If multiple dicts are found, merge them into a nested dictionary (e.g., {"dict_1": {...}, "dict_2": {...}}).
    - If both lists and dicts are found, combine them into a single dictionary.
    - If no valid JSON structures are found, return `{"original": input_str}`.

    Args:
        input_str (str): The input string containing potential JSON structures.

    Returns:
        Union[Dict[str, Any], List[Any]]: A structured representation of extracted JSON elements.
    """
    list_pattern = re.compile(r'\[.*?\]', re.DOTALL)  # Match valid lists
    dict_pattern = re.compile(r'\{.*?\}', re.DOTALL)  # Match valid dictionaries
    list_pattern = re.compile(r'\[[^\]]*\]')
    dict_pattern = re.compile(r'\{[^\}]*\}')

    parsed_lists = []
    parsed_dicts = []

    # Extract valid dictionaries
    for match in dict_pattern.findall(input_str):
        try:
            parsed_dict = json.loads(match)
            if isinstance(parsed_dict, dict):
                parsed_dicts.append(parsed_dict)
        except json.JSONDecodeError:
            continue

    # Extract valid lists
    for match in list_pattern.findall(input_str):
        try:
            parsed_list = json.loads(match)
            if isinstance(parsed_list, list):
                parsed_lists.append(parsed_list)
        except json.JSONDecodeError:
            continue

    # 1. If only **one list** is found, return it
    if len(parsed_lists) == 1 and not parsed_dicts:
        return parsed_lists[0]

    # 2. If only **one dict** is found, return it
    if len(parsed_dicts) == 1 and not parsed_lists:
        return parsed_dicts[0]

    # 3. If **multiple lists** exist, merge into a nested dictionary
    merged_data = {}
    if len(parsed_lists) > 1:
        for i, lst in enumerate(parsed_lists, start=1):
            merged_data[f"list_{i}"] = lst
    elif len(parsed_lists) == 1:
        merged_data["list_1"] = parsed_lists[0]

    # 4. If **multiple dicts** exist, merge into a nested dictionary
    if len(parsed_dicts) > 1:
        for i, dct in enumerate(parsed_dicts, start=1):
            merged_data[f"dict_{i}"] = dct
    elif len(parsed_dicts) == 1:
        merged_data.update(parsed_dicts[0])  # Merge single dict into base

    # 5. If neither lists nor dicts were found, return original input in a default dict
    return merged_data if merged_data else {"original": input_str}

# Example Test Cases
input_str1 = 'Random text [1, 2, 3] {"a": 1, "b": 2} [4, 5, 6]'
input_str2 = 'Just some text with a list: [10, 20, 30]'
input_str3 = 'Purely {"key1": "value1", "key2": "value2"} text with a JSON'
input_str4 = 'Multiple dicts: {"1": "a"} and {"2": "b"}'
input_str5 = 'No valid JSON here, just text and numbers 12345'

print(parse_json_from_string(input_str1))
# Expected: {'dict_1': {'a': 1, 'b': 2}, 'list_1': [1, 2, 3], 'list_2': [4, 5, 6]}

print(parse_json_from_string(input_str2))
# Expected: [10, 20, 30]

print(parse_json_from_string(input_str3))
# Expected: {'key1': 'value1', 'key2': 'value2'}

print(parse_json_from_string(input_str4))
# Expected: {'dict_1': {'1': 'a'}, 'dict_2': {'2': 'b'}}

print(parse_json_from_string(input_str5))
# Expected: {'original': 'No valid JSON here, just text and numbers 12345'}
