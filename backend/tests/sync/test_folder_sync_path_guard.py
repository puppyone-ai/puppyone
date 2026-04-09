"""Tests for _validate_filename utility used by filesystem connector."""

from src.connectors.filesystem.service import _validate_filename


def test_validate_filename_rejects_traversal():
    assert _validate_filename("../x.md") is not None
    assert _validate_filename("a/../b.md") is not None


def test_validate_filename_rejects_double_slash():
    assert _validate_filename("a//b.md") is not None


def test_validate_filename_rejects_null_byte():
    assert _validate_filename("a/\x00b.md") is not None


def test_validate_filename_rejects_dot_segment():
    assert _validate_filename("./x.md") is not None


def test_validate_filename_accepts_normal_nested_path():
    assert _validate_filename("a/b/c.md") is None


def test_validate_filename_accepts_nested_dotfiles():
    assert _validate_filename("a/.gitkeep") is None
    assert _validate_filename(".well-known/openid-configuration") is None
