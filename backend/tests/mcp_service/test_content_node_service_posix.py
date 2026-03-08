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
    id_path: str,
    parent_id: str | None = None,
) -> ContentNode:
    now = datetime.now(UTC)
    depth = len([s for s in id_path.strip("/").split("/") if s])
    return ContentNode(
        id=node_id,
        project_id=project_id,
        created_by="u1",
        name=name,
        type=node_type,
        id_path=id_path,
        depth=depth,
        preview_json=None,
        preview_md=None,
        s3_key=None,
        mime_type=None,
        size_bytes=0,
        permissions={"inherit": True},
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

    def _is_direct_child(self, node: ContentNode, parent_id_path: str | None, parent_depth: int) -> bool:
        if parent_id_path is None:
            return node.depth == parent_depth + 1
        return (
            node.id_path.startswith(parent_id_path + "/")
            and node.depth == parent_depth + 1
        )

    def list_children(self, project_id: str, parent_id_path: str | None = None, parent_depth: int = 0):
        return [
            node
            for node in self.nodes.values()
            if node.project_id == project_id
            and self._is_direct_child(node, parent_id_path, parent_depth)
        ]

    def get_child_by_name(self, project_id: str, parent_id_path: str | None, parent_depth: int, name: str):
        for node in self.nodes.values():
            if (
                node.project_id == project_id
                and self._is_direct_child(node, parent_id_path, parent_depth)
                and node.name == name
            ):
                return node
        return None

    def name_exists_in_parent(self, project_id: str, parent_id_path: str | None, parent_depth: int, name: str, exclude_node_id: str | None = None):
        for node in self.nodes.values():
            if exclude_node_id and node.id == exclude_node_id:
                continue
            if (
                node.project_id == project_id
                and self._is_direct_child(node, parent_id_path, parent_depth)
                and node.name == name
            ):
                return True
        return False

    def find_names_with_prefix(self, project_id: str, parent_id_path: str | None, parent_depth: int, name_prefix: str):
        return [
            node.name
            for node in self.nodes.values()
            if node.project_id == project_id
            and self._is_direct_child(node, parent_id_path, parent_depth)
            and node.name.startswith(name_prefix)
        ]

    def count_children_batch(self, parent_ids: list[str]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for pid in parent_ids:
            parent = self.nodes.get(pid)
            if parent:
                counts[pid] = sum(
                    1 for n in self.nodes.values()
                    if self._is_direct_child(n, parent.id_path, parent.depth)
                    and n.project_id == parent.project_id
                )
        return counts

    def create(
        self,
        project_id: str,
        name: str,
        node_type: str,
        id_path: str,
        created_by: str | None = None,
        **kwargs,
    ):
        new_id = id_path.strip("/").split("/")[-1]
        node = _node(
            new_id,
            project_id=project_id,
            name=name,
            node_type=node_type,
            id_path=id_path,
        )
        self.nodes[node.id] = node
        return node

    def update(
        self,
        node_id: str,
        name: str | None = None,
        id_path: str | None = None,
        **kwargs,
    ):
        old = self.nodes[node_id]
        updates: dict = {"updated_at": datetime.now(UTC)}
        if name is not None:
            updates["name"] = name
        if id_path is not None:
            updates["id_path"] = id_path
        updated = old.model_copy(update=updates)
        self.nodes[node_id] = updated
        return updated

    def get_by_ids(self, node_ids: list[str]) -> list[ContentNode]:
        return [self.nodes[nid] for nid in node_ids if nid in self.nodes]

    def move_node_atomic(self, node_id: str, project_id: str, new_id_path: str):
        old = self.nodes[node_id]
        old_id_path = old.id_path
        d = {k: v for k, v in old.model_dump().items() if k != "parent_id"}
        d["id_path"] = new_id_path
        self.nodes[node_id] = ContentNode.model_validate(d)
        for nid, node in list(self.nodes.items()):
            if nid != node_id and node.project_id == project_id and node.id_path.startswith(old_id_path + "/"):
                nd = {k: v for k, v in node.model_dump().items() if k != "parent_id"}
                nd["id_path"] = new_id_path + node.id_path[len(old_id_path):]
                self.nodes[nid] = ContentNode.model_validate(nd)


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

