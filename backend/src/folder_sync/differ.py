"""
Folder Sync Engine — Differ

变更检测：对比两个 FolderSnapshot，产生 ChangeSet。

纯函数，无副作用。上层包装器根据 ChangeSet 决定写入路径：
  - collection (folder_source): 直写 ContentNodeService
  - distribution (folder_access): 经过 CollaborationService 版本管理
"""

from src.folder_sync.schemas import FolderSnapshot, ChangeSet, FileEntry


def diff_snapshots(
    old: FolderSnapshot,
    new: FolderSnapshot,
) -> ChangeSet:
    """
    对比两个快照，返回变更集。

    Args:
        old: 上一次已知状态（可以是空快照）
        new: 当前扫描结果

    Returns:
        ChangeSet(created=..., modified=..., deleted=...)
    """
    old_paths = set(old.entries.keys())
    new_paths = set(new.entries.keys())

    created_paths = new_paths - old_paths
    deleted_paths = old_paths - new_paths
    common_paths = old_paths & new_paths

    created = [new.entries[p] for p in sorted(created_paths)]
    deleted = sorted(deleted_paths)
    modified = []

    for path in sorted(common_paths):
        old_entry = old.entries[path]
        new_entry = new.entries[path]
        if old_entry.content_hash != new_entry.content_hash:
            modified.append(new_entry)

    return ChangeSet(created=created, modified=modified, deleted=deleted)


def diff_incremental(
    snapshot: FolderSnapshot,
    scanned_entries: dict[str, FileEntry | None],
) -> ChangeSet:
    """
    增量 diff：对比现有快照和 scan_paths() 的增量扫描结果。

    用于 watcher 触发后的快速变更检测（不需要全量重扫）。

    Args:
        snapshot:        上一次已知的完整快照
        scanned_entries: scan_paths() 的返回值
                         {rel_path: FileEntry | None}
                         None 表示文件已删除

    Returns:
        ChangeSet
    """
    created: list[FileEntry] = []
    modified: list[FileEntry] = []
    deleted: list[str] = []

    for rel_path, entry in scanned_entries.items():
        old_entry = snapshot.get(rel_path)

        if entry is None:
            if old_entry is not None:
                deleted.append(rel_path)
        elif old_entry is None:
            created.append(entry)
        elif old_entry.content_hash != entry.content_hash:
            modified.append(entry)

    return ChangeSet(created=created, modified=modified, deleted=deleted)
