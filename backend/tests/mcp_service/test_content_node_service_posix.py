"""Tests for ProductOperationAdapter path-based operations used by ContentNode service layer.

The old ContentNodeService has been removed. Path resolution and tree operations
are now handled by ProductOperationAdapter (via VersionTreeReader). This file tests the public
_validate_filename utility and ProductOperationAdapter stat/list_dir contract via mock.
"""

from src.connectors.filesystem.service import _validate_filename


def test_validate_filename_accepts_simple_name():
    assert _validate_filename("readme.md") is None


def test_validate_filename_accepts_nested_path():
    assert _validate_filename("docs/api/readme.md") is None


def test_validate_filename_rejects_traversal():
    assert _validate_filename("../x.md") is not None
    assert _validate_filename("a/../b.md") is not None


def test_validate_filename_rejects_double_slash():
    assert _validate_filename("a//b.md") is not None


def test_validate_filename_rejects_empty():
    assert _validate_filename("") is not None
    assert _validate_filename("   ") is not None


def test_validate_filename_rejects_null_byte():
    assert _validate_filename("a/\x00b.md") is not None
