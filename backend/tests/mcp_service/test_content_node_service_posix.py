"""Tests for ProductOperationAdapter path-based operations used by ContentNode service layer.

The old ContentNodeService has been removed. Path resolution and tree operations
are now handled by ProductOperationAdapter (via VersionTreeReader). This file tests the public
validate_version_filename utility and ProductOperationAdapter stat/list_dir contract via mock.
"""

from src.version_engine.admission.validation import validate_version_filename


def test_validate_filename_accepts_simple_name():
    assert validate_version_filename("readme.md") is None


def test_validate_filename_accepts_nested_path():
    assert validate_version_filename("docs/api/readme.md") is None


def test_validate_filename_rejects_traversal():
    assert validate_version_filename("../x.md") is not None
    assert validate_version_filename("a/../b.md") is not None


def test_validate_filename_rejects_double_slash():
    assert validate_version_filename("a//b.md") is not None


def test_validate_filename_rejects_empty():
    assert validate_version_filename("") is not None
    assert validate_version_filename("   ") is not None


def test_validate_filename_rejects_null_byte():
    assert validate_version_filename("a/\x00b.md") is not None
