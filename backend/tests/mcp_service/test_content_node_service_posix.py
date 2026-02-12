"""src.content_node.service 新增 POSIX 能力测试。"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from src.content_node.models import ContentNode
from src.content_node.service import ContentNodeService
from src.exceptions import BusinessException, NotFoundException


def _node(
    node_id: str,
    *,
    project_id: str = "proj-1",
    name: str,
    node_type: str,
    parent_id: str | None,
    id_path: str,
) -> ContentNode:
    now = datetime.now(UTC)
    return ContentNode(
        id=node_id,
        project_id=project_id,
        created_by="u1",
        sync_oauth_user_id=None,
        parent_id=parent_id,
        name=name,
        type=node_type,
        id_path=id_path,
        preview_json=None,
        preview_md=None,
        s3_key=None,
        mime_type=None,
        size_bytes=0,
        permissions={"inherit": True},
        sync_url=None,
        sync_id=None,
        sync_config=None,
        sync_status="idle",
        last_synced_at=None,
        created_at=now,
        updated_at=now,
    )


class _Repo:
    def __init__(self, nodes: list[ContentNode]):
        self.nodes = {n.id: n for n in nodes}

    def get_by_id(self, node_id: str):
        return self.nodes.get(node_id)

    def get_by_id_path(self, project_id: str, id_path: str):
        for node in self.nodes.values():
            if node.project_id == project_id and node.id_path == id_path:
                return node
        return None

    def list_children(self, project_id: str, parent_id: str | None = None):
        return [
            node
            for node in self.nodes.values()
            if node.project_id == project_id and node.parent_id == parent_id
        ]

    def get_child_by_name(self, project_id: str, parent_id: str | None, name: str):
        for node in self.nodes.values():
            if (
                node.project_id == project_id
                and node.parent_id == parent_id
                and node.name == name
            ):
                return node
        return None

    def name_exists_in_parent(self, project_id: str, parent_id: str | None, name: str, exclude_node_id: str | None = None):
        for node in self.nodes.values():
            if exclude_node_id and node.id == exclude_node_id:
                continue
            if (
                node.project_id == project_id
                and node.parent_id == parent_id
                and node.name == name
            ):
                return True
        return False

    def create(
        self,
        project_id: str,
        name: str,
        node_type: str,
        id_path: str,
        parent_id: str | None = None,
        created_by: str | None = None,
        **kwargs,
    ):
        new_id = id_path.strip("/").split("/")[-1]
        node = _node(
            new_id,
            project_id=project_id,
            name=name,
            node_type=node_type,
            parent_id=parent_id,
            id_path=id_path,
        )
        self.nodes[node.id] = node
        return node

    def update(
        self,
        node_id: str,
        name: str | None = None,
        id_path: str | None = None,
        parent_id: str | None = None,
        **kwargs,
    ):
        old = self.nodes[node_id]
        updated = old.model_copy(
            update={
                "name": old.name if name is None else name,
                "id_path": old.id_path if id_path is None else id_path,
                "parent_id": old.parent_id if parent_id is None else parent_id,
                "updated_at": datetime.now(UTC),
            }
        )
        self.nodes[node_id] = updated
        return updated

    def update_children_id_path_prefix(self, project_id: str, old_prefix: str, new_prefix: str):
        updated = 0
        for node_id, node in list(self.nodes.items()):
            if node.project_id == project_id and node.id_path.startswith(old_prefix + "/"):
                self.nodes[node_id] = node.model_copy(
                    update={"id_path": new_prefix + node.id_path[len(old_prefix):]}
                )
                updated += 1
        return updated


class _S3:
    pass


def test_resolve_path_single_root_and_build_display_path():
    root = _node("root", name="workspace", node_type="folder", parent_id=None, id_path="/root")
    docs = _node("docs", name="docs", node_type="folder", parent_id="root", id_path="/root/docs")
    readme = _node("readme", name="readme.md", node_type="markdown", parent_id="docs", id_path="/root/docs/readme")
    repo = _Repo([root, docs, readme])
    service = ContentNodeService(repo, _S3())

    root_accesses = [{"node_id": "root", "node_name": "workspace", "node_type": "folder"}]

    assert service.resolve_path("proj-1", root_accesses, "/") == root
    resolved = service.resolve_path("proj-1", root_accesses, "/docs/readme.md")
    assert resolved.id == "readme"
    assert service.build_display_path(resolved, root_accesses) == "/docs/readme.md"
    assert service.build_display_path(root, root_accesses) == "/"


def test_resolve_path_multi_root_behaviors():
    docs_root = _node("docs-root", name="docs", node_type="folder", parent_id=None, id_path="/docs-root")
    api_md = _node("api-md", name="api.md", node_type="markdown", parent_id="docs-root", id_path="/docs-root/api-md")
    repo = _Repo([docs_root, api_md])
    service = ContentNodeService(repo, _S3())

    root_accesses = [{"node_id": "docs-root", "node_name": "docs", "node_type": "folder"}]
    resolved = service.resolve_path("proj-1", root_accesses, "/api.md")
    assert resolved.id == "api-md"

    with pytest.raises(NotFoundException):
        service.resolve_path("proj-1", root_accesses, "/missing.md")

    with pytest.raises(NotFoundException):
        service.resolve_path(
            "proj-1",
            [
                {"node_id": "docs-root", "node_name": "docs", "node_type": "folder"},
                {"node_id": "other", "node_name": "wiki", "node_type": "folder"},
            ],
            "/unknown/x.md",
        )


def test_resolve_path_virtual_root_in_multi_root_raises_business_error():
    docs_root = _node("docs-root", name="docs", node_type="folder", parent_id=None, id_path="/docs-root")
    wiki_root = _node("wiki-root", name="wiki", node_type="folder", parent_id=None, id_path="/wiki-root")
    service = ContentNodeService(_Repo([docs_root, wiki_root]), _S3())

    with pytest.raises(BusinessException, match="VIRTUAL_ROOT"):
        service.resolve_path(
            "proj-1",
            [
                {"node_id": "docs-root", "node_name": "docs", "node_type": "folder"},
                {"node_id": "wiki-root", "node_name": "wiki", "node_type": "folder"},
            ],
            "/",
        )


def test_soft_delete_moves_node_to_trash_and_renames_uniquely():
    root_a = _node("root-a", name="A", node_type="folder", parent_id=None, id_path="/root-a")
    root_b = _node("root-b", name="B", node_type="folder", parent_id=None, id_path="/root-b")
    file_a = _node("file-a", name="readme.md", node_type="markdown", parent_id="root-a", id_path="/root-a/file-a")
    file_b = _node("file-b", name="readme.md", node_type="markdown", parent_id="root-b", id_path="/root-b/file-b")
    repo = _Repo([root_a, root_b, file_a, file_b])
    service = ContentNodeService(repo, _S3())

    moved_a = service.soft_delete_node("file-a", "proj-1", "u1")
    moved_b = service.soft_delete_node("file-b", "proj-1", "u1")

    trash = next(node for node in repo.nodes.values() if node.name == ContentNodeService.TRASH_FOLDER_NAME)

    assert moved_a.parent_id == trash.id
    assert moved_b.parent_id == trash.id
    assert moved_a.name.startswith("readme.md_")
    assert moved_b.name.startswith("readme.md_")
    assert moved_a.name != moved_b.name

