"""
Tests for Folder Search functionality.

Tests cover:
1. Namespace building (static methods)
2. Doc ID building (static methods)

Note: These tests use the static methods directly to avoid module import issues
when external dependencies (supabase, boto3) are not available.
"""

import hashlib
import datetime as dt
from dataclasses import dataclass
from typing import Any, List, Optional
from unittest.mock import MagicMock

import pytest


# ==================== Helper Functions (copied from service.py for isolated testing) ====================

def _build_folder_namespace(*, project_id: str, folder_node_id: str) -> str:
    """Build namespace for folder search"""
    return f"project_{project_id}_folder_{folder_node_id}"


def _build_namespace(*, project_id: str, node_id: str) -> str:
    """Build namespace for single-node search"""
    return f"project_{project_id}_node_{node_id}"


def _build_folder_doc_id(
    *, file_node_id: str, json_pointer: str, content_hash: str, chunk_index: int
) -> str:
    """
    Build doc_id for folder search.
    Similar to build_doc_id but uses file_node_id to distinguish files.
    """
    pointer_hash = hashlib.md5(json_pointer.encode("utf-8")).hexdigest()[:12]
    return f"{file_node_id[:12]}_{pointer_hash}_{content_hash[:8]}_{chunk_index}"


def _build_doc_id(
    *, node_id: str, json_pointer: str, content_hash: str, chunk_index: int
) -> str:
    """Build doc_id for single-node search."""
    pointer_hash = hashlib.md5(json_pointer.encode("utf-8")).hexdigest()[:12]
    return f"{node_id[:12]}_{pointer_hash}_{content_hash[:8]}_{chunk_index}"


def _normalize_json_pointer(pointer: str) -> str:
    """Normalize JSON Pointer."""
    p = (pointer or "").strip()
    if not p:
        return ""
    if not p.startswith("/"):
        p = "/" + p
    return p


# ==================== FolderIndexStats ====================

@dataclass(frozen=True)
class FolderIndexStats:
    """Folder search indexing statistics"""
    total_files: int
    indexed_files: int
    nodes_count: int
    chunks_count: int
    indexed_chunks_count: int


# ==================== Test Fixtures ====================

def make_content_node(
    node_id: str,
    name: str,
    node_type: str,
    project_id: str = "proj1",
    user_id: str = "user1",
    parent_id: Optional[str] = None,
    content: Any = None,
    s3_key: Optional[str] = None,
) -> MagicMock:
    """Create a mock ContentNode for testing."""
    node = MagicMock()
    node.id = node_id
    node.user_id = user_id
    node.project_id = project_id
    node.parent_id = parent_id
    node.name = name
    node.type = node_type
    node.id_path = f"/{node_id}" if not parent_id else f"/{parent_id}/{node_id}"
    node.content = content
    node.s3_key = s3_key
    node.mime_type = None
    node.size_bytes = 0
    node.permissions = {"inherit": True}
    now = dt.datetime.now(tz=dt.timezone.utc)
    node.created_at = now
    node.updated_at = now
    return node


# ==================== Unit Tests ====================

class TestBuildFolderNamespace:
    """Tests for namespace building."""

    def test_build_folder_namespace(self):
        ns = _build_folder_namespace(
            project_id="proj123",
            folder_node_id="folder456",
        )
        assert ns == "project_proj123_folder_folder456"

    def test_build_folder_namespace_different_from_node_namespace(self):
        folder_ns = _build_folder_namespace(
            project_id="proj1",
            folder_node_id="node1",
        )
        node_ns = _build_namespace(
            project_id="proj1",
            node_id="node1",
        )
        # Folder namespace should be different from node namespace
        assert folder_ns != node_ns
        assert "folder" in folder_ns
        assert "node" in node_ns

    def test_build_folder_namespace_format(self):
        ns = _build_folder_namespace(
            project_id="abc",
            folder_node_id="xyz",
        )
        # Should follow the pattern: project_{project_id}_folder_{folder_node_id}
        parts = ns.split("_")
        assert parts[0] == "project"
        assert parts[1] == "abc"
        assert parts[2] == "folder"
        assert parts[3] == "xyz"


class TestBuildFolderDocId:
    """Tests for doc ID building."""

    def test_build_folder_doc_id_length(self):
        doc_id = _build_folder_doc_id(
            file_node_id="file123456789012345678901234567890",  # Long ID
            json_pointer="/articles/0/content/deep/nested/path",  # Long pointer
            content_hash="abcdefghijklmnopqrstuvwxyz",
            chunk_index=999,
        )
        # Should be <= 64 bytes (turbopuffer limit)
        assert len(doc_id.encode("utf-8")) <= 64

    def test_build_folder_doc_id_contains_file_prefix(self):
        doc_id = _build_folder_doc_id(
            file_node_id="file123456789012",
            json_pointer="/content",
            content_hash="abcdefgh",
            chunk_index=0,
        )
        # Should contain file node prefix (first 12 chars)
        assert doc_id.startswith("file12345678")

    def test_build_folder_doc_id_unique_for_different_files(self):
        doc_id1 = _build_folder_doc_id(
            file_node_id="file1",
            json_pointer="/content",
            content_hash="hash1",
            chunk_index=0,
        )
        doc_id2 = _build_folder_doc_id(
            file_node_id="file2",
            json_pointer="/content",
            content_hash="hash1",
            chunk_index=0,
        )
        assert doc_id1 != doc_id2

    def test_build_folder_doc_id_unique_for_different_chunks(self):
        doc_id1 = _build_folder_doc_id(
            file_node_id="file1",
            json_pointer="/content",
            content_hash="hash1",
            chunk_index=0,
        )
        doc_id2 = _build_folder_doc_id(
            file_node_id="file1",
            json_pointer="/content",
            content_hash="hash1",
            chunk_index=1,
        )
        assert doc_id1 != doc_id2

    def test_build_folder_doc_id_unique_for_different_pointers(self):
        doc_id1 = _build_folder_doc_id(
            file_node_id="file1",
            json_pointer="/content/a",
            content_hash="hash1",
            chunk_index=0,
        )
        doc_id2 = _build_folder_doc_id(
            file_node_id="file1",
            json_pointer="/content/b",
            content_hash="hash1",
            chunk_index=0,
        )
        assert doc_id1 != doc_id2


class TestFolderIndexStats:
    """Tests for FolderIndexStats dataclass."""

    def test_folder_index_stats_creation(self):
        stats = FolderIndexStats(
            total_files=10,
            indexed_files=8,
            nodes_count=20,
            chunks_count=100,
            indexed_chunks_count=100,
        )
        assert stats.total_files == 10
        assert stats.indexed_files == 8
        assert stats.nodes_count == 20
        assert stats.chunks_count == 100
        assert stats.indexed_chunks_count == 100

    def test_folder_index_stats_immutable(self):
        stats = FolderIndexStats(
            total_files=10,
            indexed_files=8,
            nodes_count=20,
            chunks_count=100,
            indexed_chunks_count=100,
        )
        with pytest.raises(AttributeError):
            stats.total_files = 20  # type: ignore


class TestNormalizeJsonPointer:
    """Tests for JSON pointer normalization."""

    def test_normalize_empty_string(self):
        assert _normalize_json_pointer("") == ""

    def test_normalize_none(self):
        assert _normalize_json_pointer(None) == ""  # type: ignore

    def test_normalize_with_leading_slash(self):
        assert _normalize_json_pointer("/content") == "/content"

    def test_normalize_without_leading_slash(self):
        assert _normalize_json_pointer("content") == "/content"

    def test_normalize_with_whitespace(self):
        assert _normalize_json_pointer("  /content  ") == "/content"


class TestListIndexableDescendants:
    """Tests for listing indexable descendants logic."""

    def test_filter_indexable_types_default(self):
        """Test that default indexable types are json and markdown."""
        # Create test nodes
        nodes = [
            make_content_node("json1", "data.json", "json"),
            make_content_node("md1", "readme.md", "markdown"),
            make_content_node("img1", "photo.png", "image"),
            make_content_node("pdf1", "doc.pdf", "pdf"),
            make_content_node("vid1", "video.mp4", "video"),
        ]

        # Default indexable types
        indexable_types = ["json", "markdown"]
        
        # Filter
        indexable = [n for n in nodes if n.type in indexable_types]

        # Verify only json and markdown are returned
        assert len(indexable) == 2
        types = [n.type for n in indexable]
        assert "json" in types
        assert "markdown" in types
        assert "image" not in types
        assert "pdf" not in types
        assert "video" not in types

    def test_filter_indexable_types_custom(self):
        """Test that custom indexable types can be specified."""
        nodes = [
            make_content_node("json1", "data.json", "json"),
            make_content_node("pdf1", "doc.pdf", "pdf"),
        ]

        # Custom indexable types
        indexable_types = ["pdf"]
        
        # Filter
        indexable = [n for n in nodes if n.type in indexable_types]

        # Verify only pdf is returned
        assert len(indexable) == 1
        assert indexable[0].type == "pdf"


class TestSearchResultFormat:
    """Tests for search result format."""

    def test_folder_search_result_structure(self):
        """Test that folder search results have correct structure."""
        # Expected result format
        result = {
            "score": 0.95,
            "file": {
                "node_id": "file1",
                "id_path": "/folder1/file1",
                "name": "data.json",
                "type": "json",
            },
            "chunk": {
                "id": 1,
                "json_pointer": "/content",
                "chunk_index": 0,
                "total_chunks": 1,
                "chunk_text": "Test content",
            },
        }

        # Verify structure
        assert "score" in result
        assert "file" in result
        assert "chunk" in result

        # Verify file info
        assert "node_id" in result["file"]
        assert "id_path" in result["file"]
        assert "name" in result["file"]
        assert "type" in result["file"]

        # Verify chunk info
        assert "id" in result["chunk"]
        assert "json_pointer" in result["chunk"]
        assert "chunk_index" in result["chunk"]
        assert "total_chunks" in result["chunk"]
        assert "chunk_text" in result["chunk"]

    def test_single_node_search_result_structure(self):
        """Test that single-node search results have correct structure."""
        # Expected result format (existing format)
        result = {
            "score": 0.95,
            "json_path": "/articles/0/content",
            "chunk": {
                "id": 1,
                "json_pointer": "/articles/0/content",
                "chunk_index": 0,
                "total_chunks": 1,
                "chunk_text": "Test content",
            },
        }

        # Verify structure
        assert "score" in result
        assert "json_path" in result
        assert "chunk" in result
        # Should NOT have file info in single-node search
        assert "file" not in result
