from src.version_engine.read.text_detection import is_binary_content


def test_markdown_and_json_node_types_are_text():
    assert not is_binary_content(b"# Title\n", node_type="markdown", mime_type="text/markdown")
    assert not is_binary_content(b'{"ok": true}', node_type="json", mime_type="application/json")


def test_octet_stream_with_nul_is_binary():
    assert is_binary_content(b"abc\x00def", node_type="file", mime_type="application/octet-stream")


def test_unknown_utf8_plain_text_can_diff():
    assert not is_binary_content(
        b"hello\nworld\n",
        node_type="file",
        mime_type="application/octet-stream",
    )


def test_invalid_utf8_is_binary():
    assert is_binary_content(b"\xff\xfe\x00\x01", node_type="file", mime_type="application/octet-stream")
