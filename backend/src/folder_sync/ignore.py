"""
Folder Sync Engine — Ignore Rules

文件过滤规则。决定哪些文件/目录应被跳过。
提取自 sync/triggers/file_watcher.py 的 _should_ignore 逻辑，
并扩展为可配置的规则引擎。
"""

import os
import fnmatch
from dataclasses import dataclass, field


DEFAULT_IGNORE_PATTERNS: list[str] = [
    ".*",                # 隐藏文件/目录 (.git, .DS_Store, .env, ...)
    "*~",                # 编辑器备份
    "*.tmp",
    "*.swp",
    "*.swo",
    "*.swn",
    "*.pyc",
    "*.pyo",
    "__pycache__",
    "node_modules",
    ".metadata.json",    # folder_sync 自身的元数据文件
    "Thumbs.db",
]


@dataclass
class IgnoreRules:
    """
    可配置的忽略规则。

    支持 fnmatch 通配符，分别匹配文件名和目录名。
    上层可以传入额外的 patterns 覆盖或扩展默认规则。
    """
    patterns: list[str] = field(default_factory=lambda: list(DEFAULT_IGNORE_PATTERNS))

    def should_ignore_file(self, rel_path: str) -> bool:
        """判断一个文件（相对路径）是否应被忽略。"""
        basename = os.path.basename(rel_path)
        for pattern in self.patterns:
            if fnmatch.fnmatch(basename, pattern):
                return True
        parts = rel_path.replace("\\", "/").split("/")
        for part in parts[:-1]:
            for pattern in self.patterns:
                if fnmatch.fnmatch(part, pattern):
                    return True
        return False

    def should_ignore_dir(self, dir_name: str) -> bool:
        """判断一个目录名是否应被忽略（用于 os.walk 的 dirs 过滤）。"""
        for pattern in self.patterns:
            if fnmatch.fnmatch(dir_name, pattern):
                return True
        return False

    def add_pattern(self, pattern: str) -> None:
        if pattern not in self.patterns:
            self.patterns.append(pattern)

    def remove_pattern(self, pattern: str) -> None:
        if pattern in self.patterns:
            self.patterns.remove(pattern)
