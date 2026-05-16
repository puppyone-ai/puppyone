"""Ignore-pattern handling for server-side ingest paths.

Formerly ``mut.core.ignore``. PuppyOne reads ``.gitignore`` patterns
directly when a client streams a working tree manifest, so the engine's
view of which paths are tracked matches the user's ``git`` view.
"""

from __future__ import annotations

import fnmatch
from pathlib import Path

from src.mut_engine.infrastructure.paths import BUILTIN_IGNORE, IGNORE_FILE


class IgnoreRules:

    def __init__(self, workdir: Path):
        self._patterns = None
        self._workdir = workdir

    def _load(self) -> set[str]:
        patterns = set(BUILTIN_IGNORE)
        ignore_file = self._workdir / IGNORE_FILE
        if ignore_file.exists():
            for line in ignore_file.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    patterns.add(line)
        return patterns

    def should_ignore(self, name: str, rel_path: str = "") -> bool:
        if self._patterns is None:
            self._patterns = self._load()

        for pattern in self._patterns:
            if name == pattern:
                return True
            if pattern.endswith("/"):
                dir_name = pattern.rstrip("/")
                if name == dir_name:
                    return True
                if rel_path and (f"/{dir_name}/" in f"/{rel_path}/"):
                    return True
            if fnmatch.fnmatch(name, pattern):
                return True
        return False
