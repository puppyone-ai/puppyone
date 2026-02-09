from src.agent.service import extract_data_by_path


def test_extract_data_by_path_root():
    data = {"a": 1, "b": {"c": 2}}
    assert extract_data_by_path(data, "") == data


def test_extract_data_by_path_nested_list():
    data = {"users": [{"name": "a"}, {"name": "b"}]}
    assert extract_data_by_path(data, "/users/1/name") == "b"

def test_extract_data_by_path_invalid_path_returns_none():
    data = {"users": [{"name": "a"}]}
    assert extract_data_by_path(data, "/users/10/name") is None
