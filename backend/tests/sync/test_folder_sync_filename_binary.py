"""Tests for _validate_filename with binary file extensions."""

from src.connectors.filesystem.service import _validate_filename


def test_validate_filename_accepts_binary_extension():
    assert _validate_filename("report.pdf") is None
    assert _validate_filename("data.xlsx") is None
    assert _validate_filename("sub/folder/report.pdf") is None
    assert _validate_filename("sub/.gitkeep") is None


def test_validate_filename_rejects_traversal():
    assert _validate_filename("../report.pdf") is not None
    assert _validate_filename("a/../b.pdf") is not None
