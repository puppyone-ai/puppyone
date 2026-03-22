"""
Folder Sync Engine — Ignore Rules

File filtering rules. Determines which files/directories should be skipped.
Extracted from the _should_ignore logic of sync/triggers/file_watcher.py,
and extended into a configurable rules engine.
"""

import os
import fnmatch
from dataclasses import dataclass, field


DEFAULT_IGNORE_PATTERNS: list[str] = [
    ".*",                # Hidden files/directories (.git, .DS_Store, .env, ...)
    "*~",                # Editor backup files
    "*.tmp",
    "*.swp",
    "*.swo",
    "*.swn",
    "*.pyc",
    "*.pyo",
    "__pycache__",
    "node_modules",
    ".metadata.json",    # folder_sync's own metadata file
    "Thumbs.db",
]


@dataclass
class IgnoreRules:
    """
    Configurable ignore rules.

    Supports fnmatch wildcards, matching file names and directory names separately.
    Upper layers can pass additional patterns to override or extend the default rules.
    """
    patterns: list[str] = field(default_factory=lambda: list(DEFAULT_IGNORE_PATTERNS))

    def should_ignore_file(self, rel_path: str) -> bool:
        """Determine whether a file (relative path) should be ignored."""
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
        """Determine whether a directory name should be ignored (for os.walk dirs filtering)."""
        return any(fnmatch.fnmatch(dir_name, pattern) for pattern in self.patterns)

    def add_pattern(self, pattern: str) -> None:
        if pattern not in self.patterns:
            self.patterns.append(pattern)

    def remove_pattern(self, pattern: str) -> None:
        if pattern in self.patterns:
            self.patterns.remove(pattern)
