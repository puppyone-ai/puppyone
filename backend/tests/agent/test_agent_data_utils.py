from pathlib import Path

from src.agent.service import extract_data_by_path, execute_file_tool


def test_extract_data_by_path_root():
    data = {"a": 1, "b": {"c": 2}}
    assert extract_data_by_path(data, "") == data


def test_extract_data_by_path_nested_list():
    data = {"users": [{"name": "a"}, {"name": "b"}]}
    assert extract_data_by_path(data, "/users/1/name") == "b"


def test_execute_file_tool_read_file(tmp_path: Path):
    file_path = tmp_path / "note.txt"
    file_path.write_text("hello", encoding="utf-8")
    result = execute_file_tool(
        "read_file", {"path": "note.txt"}, str(tmp_path)
    )
    assert result == "hello"


def test_execute_file_tool_glob_search(tmp_path: Path):
    (tmp_path / "a.txt").write_text("a", encoding="utf-8")
    result = execute_file_tool(
        "glob_search", {"pattern": "*.txt"}, str(tmp_path)
    )
    assert "a.txt" in result


def test_execute_file_tool_grep_search(tmp_path: Path):
    file_path = tmp_path / "log.txt"
    file_path.write_text("hello\nworld", encoding="utf-8")
    result = execute_file_tool(
        "grep_search", {"pattern": "world", "path": "."}, str(tmp_path)
    )
    assert "world" in result
