class AgentService:
    """Placeholder service for agent logic."""

    async def should_use_bash(self, node_data, bash_access) -> bool:
        if not bash_access:
            return False
        return node_data is not None


def merge_data_by_path(original_data, json_path: str, new_node_data):
    if not json_path or json_path == "/":
        return new_node_data

    result = _deep_copy_json(original_data)
    segments = [segment for segment in json_path.split("/") if segment]

    current = result
    for segment in segments[:-1]:
        if isinstance(current, list):
            current = current[int(segment)]
        elif isinstance(current, dict):
            current = current[segment]

    last_segment = segments[-1]
    if isinstance(current, list):
        current[int(last_segment)] = new_node_data
    elif isinstance(current, dict):
        current[last_segment] = new_node_data

    return result


def _deep_copy_json(data):
    import json

    return json.loads(json.dumps(data))
