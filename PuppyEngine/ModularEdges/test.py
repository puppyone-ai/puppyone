from itertools import product
from typing import List, Dict, Any

def get_looped_configs(input_dict: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    looped_values = {}
    non_looped_values = {}

    # Separate looped and non-looped items
    for key, info in input_dict.items():
        content = info.get("content")
        is_looped = info.get("looped", False)

        if is_looped and isinstance(content, (list, dict)):
            looped_values[key] = (
                [str(item) for item in content] if isinstance(content, list) 
                else [str({k: v}) for k, v in content.items()]
            )
        else:
            non_looped_values[key] = content  # Keep original content

    # Generate all combinations of looped values
    looped_combinations = [
        dict(zip(looped_values.keys(), values))
        for values in product(*looped_values.values())
    ] if looped_values else [{}]  # Ensure at least one entry exists

    # Merge looped results with non-looped values
    result = [{**combo, **non_looped_values} for combo in looped_combinations]

    return result

# Example Usage
input_data = {
    "a": {"content": [1, 2, 3], "looped": True},
    "b": {"content": [4, 5, 6], "looped": True}
}
print(get_looped_configs(input_data))

input_data_2 = {
    "a": {"content": [1, 2, 3], "looped": True},
    "b": {"content": [4, 5, 6], "looped": False}
}
print(get_looped_configs(input_data_2))
input_data_3 = {
    "a": {"content": [1, 2, 3], "looped": False},
    "b": {"content": [4, 5, 6], "looped": False}
}
print(get_looped_configs(input_data_3))
