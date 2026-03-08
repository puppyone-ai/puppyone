"""
Folder Sync Engine — FolderWatcher

基于 watchdog 的实时文件系统监听。

从 sync/triggers/file_watcher.py 提取并解耦：
  - 去除 source_id 耦合（由上层包装器提供业务上下文）
  - 保留 debounce + 批量回调核心机制
  - 集成 IgnoreRules 替代硬编码的过滤逻辑

上层使用：
  - sync/folder_source.py:  on_change → 读文件 → ContentNodeService.update()
  - access/folder_access.py: on_change → 读文件 → CollaborationService.commit()
"""

import os
import threading
from typing import Callable, Optional, Set

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileSystemEvent

from src.folder_sync.ignore import IgnoreRules


class _DebouncedHandler(FileSystemEventHandler):
    """收集文件变更事件，debounce 后批量回调。"""

    def __init__(
        self,
        watch_path: str,
        debounce_seconds: float,
        callback: Callable[[Set[str]], None],
        ignore_rules: IgnoreRules,
    ):
        super().__init__()
        self._watch_path = watch_path
        self._debounce = debounce_seconds
        self._callback = callback
        self._ignore = ignore_rules
        self._pending: Set[str] = set()
        self._lock = threading.Lock()
        self._timer: Optional[threading.Timer] = None

    def _on_any_change(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        path = event.src_path
        rel_path = os.path.relpath(path, self._watch_path)

        if self._ignore.should_ignore_file(rel_path):
            return

        with self._lock:
            self._pending.add(rel_path)
            if self._timer:
                self._timer.cancel()
            self._timer = threading.Timer(self._debounce, self._flush)
            self._timer.start()

    def on_modified(self, event: FileSystemEvent) -> None:
        self._on_any_change(event)

    def on_created(self, event: FileSystemEvent) -> None:
        self._on_any_change(event)

    def on_deleted(self, event: FileSystemEvent) -> None:
        self._on_any_change(event)

    def on_moved(self, event: FileSystemEvent) -> None:
        self._on_any_change(event)
        if hasattr(event, "dest_path"):
            dest_rel = os.path.relpath(event.dest_path, self._watch_path)
            if not self._ignore.should_ignore_file(dest_rel):
                with self._lock:
                    self._pending.add(dest_rel)

    def _flush(self) -> None:
        with self._lock:
            if not self._pending:
                return
            changed = self._pending.copy()
            self._pending.clear()
        self._callback(changed)


OnChangeCallback = Callable[[Set[str]], None]


class FolderWatcher:
    """
    监听本地文件夹变更，通过回调通知上层。

    与旧 FileWatcher 的区别：
      - 回调签名简化为 (changed_rel_paths: Set[str]) → None
      - 不感知 source_id，由上层包装器负责业务上下文
      - 使用 IgnoreRules 替代硬编码过滤

    Usage:
        watcher = FolderWatcher("/path/to/dir")
        watcher.start(on_change=lambda paths: print(paths))
        # ...
        watcher.stop()
    """

    def __init__(
        self,
        watch_path: str,
        debounce_seconds: float = 2.0,
        ignore_rules: Optional[IgnoreRules] = None,
    ):
        self.watch_path = watch_path
        self.debounce_seconds = debounce_seconds
        self.ignore_rules = ignore_rules or IgnoreRules()
        self._observer: Optional[Observer] = None

    def start(self, on_change: OnChangeCallback) -> None:
        """启动 watchdog 监听。"""
        if self._observer:
            return

        handler = _DebouncedHandler(
            watch_path=self.watch_path,
            debounce_seconds=self.debounce_seconds,
            callback=on_change,
            ignore_rules=self.ignore_rules,
        )

        self._observer = Observer()
        self._observer.schedule(handler, self.watch_path, recursive=True)
        self._observer.start()

    def stop(self) -> None:
        """停止 watchdog 监听。"""
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=5)
            self._observer = None

    @property
    def is_running(self) -> bool:
        return self._observer is not None and self._observer.is_alive()
