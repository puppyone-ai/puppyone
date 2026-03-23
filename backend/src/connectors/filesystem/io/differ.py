"""
Folder Sync Engine — Differ

Change detection: compare two FolderSnapshots and produce a ChangeSet.

Pure functions, no side effects. Upper-layer wrappers decide the write path based on ChangeSet:
  - collection (folder_source): direct write to ContentNodeService
  - distribution (folder_access): through CollaborationService version management
"""

from src.connectors.filesystem.io.schemas import FolderSnapshot, ChangeSet, FileEntry


def diff_snapshots(
    old: FolderSnapshot,
    new: FolderSnapshot,
) -> ChangeSet:
    """
    Compare two snapshots and return a change set.

    Args:
        old: Previous known state (can be an empty snapshot)
        new: Current scan result

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
    Incremental diff: compare existing snapshot with incremental scan results from scan_paths().

    Used for fast change detection after a watcher trigger (no full re-scan needed).

    Args:
        snapshot:        Previous known complete snapshot
        scanned_entries: Return value of scan_paths()
                         {rel_path: FileEntry | None}
                         None means the file has been deleted

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
