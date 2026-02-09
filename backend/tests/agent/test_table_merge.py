from src.agent.service import merge_data_by_path


def test_merge_node_data_by_path():
    assert merge_data_by_path({"a": {"b": 1}}, "/a", {"b": 2}) == {
        "a": {"b": 2}
    }
