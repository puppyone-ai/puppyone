"""
Folder Sync Engine — Data Models

独立于任何业务层（L2/L2.5/L3）的纯数据结构。
上层包装器（sync/folder_source, access/folder_access）在这些结构之上
添加业务语义（版本管理、审计等）。
"""

from dataclasses import dataclass, field
from typing import Any, Optional


# ============================================================
# File-level models
# ============================================================

@dataclass(frozen=True)
class FileEntry:
    """
    目录中一个文件的元信息（不含内容）。

    frozen=True 使其可 hash，方便放入 set / dict。
    """
    rel_path: str
    content_hash: str
    content_type: str       # json | markdown | binary
    size_bytes: int
    modified_at: float      # os.path.getmtime


@dataclass
class FileContent:
    """文件内容 + 元信息。scanner.read_file() 的返回值。"""
    rel_path: str
    raw_bytes: bytes
    content: Any            # dict (JSON) | str (markdown/text)
    content_type: str       # json | markdown
    content_hash: str
    size_bytes: int


# ============================================================
# Change detection models
# ============================================================

@dataclass
class ChangeSet:
    """
    两次快照之间的差异。differ.diff_snapshots() 的返回值。

    上层包装器根据业务场景决定如何处理：
      - collection: created/modified → ContentNodeService.update()
      - distribution: created/modified → CollaborationService.commit()
    """
    created: list[FileEntry] = field(default_factory=list)
    modified: list[FileEntry] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not self.created and not self.modified and not self.deleted

    @property
    def total(self) -> int:
        return len(self.created) + len(self.modified) + len(self.deleted)


# ============================================================
# Folder snapshot
# ============================================================

@dataclass
class FolderSnapshot:
    """
    文件夹在某一时刻的完整状态。

    由 scanner.scan_directory() 生成，由 differ.diff_snapshots() 消费。
    可序列化后持久化，用于下次启动时做增量对比。
    """
    root_path: str
    entries: dict[str, FileEntry] = field(default_factory=dict)  # rel_path → FileEntry
    scanned_at: float = 0.0

    def get(self, rel_path: str) -> Optional[FileEntry]:
        return self.entries.get(rel_path)

    def to_dict(self) -> dict:
        """序列化为可 JSON 持久化的字典。"""
        return {
            "root_path": self.root_path,
            "scanned_at": self.scanned_at,
            "entries": {
                path: {
                    "content_hash": e.content_hash,
                    "content_type": e.content_type,
                    "size_bytes": e.size_bytes,
                    "modified_at": e.modified_at,
                }
                for path, e in self.entries.items()
            },
        }

    @classmethod
    def from_dict(cls, data: dict) -> "FolderSnapshot":
        """从持久化的字典恢复。"""
        entries = {}
        for path, e in data.get("entries", {}).items():
            entries[path] = FileEntry(
                rel_path=path,
                content_hash=e["content_hash"],
                content_type=e["content_type"],
                size_bytes=e["size_bytes"],
                modified_at=e["modified_at"],
            )
        return cls(
            root_path=data.get("root_path", ""),
            entries=entries,
            scanned_at=data.get("scanned_at", 0.0),
        )
