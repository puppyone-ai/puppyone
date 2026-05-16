"""Filesystem helpers used by the object-store and tree implementations.

Slimmed-down copy of ``mut.foundation.fs`` containing only what the
PuppyOne backend's storage adapters and tests need.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data, *, indent: int = 2):
    atomic_write(path, json.dumps(data, indent=indent, ensure_ascii=False).encode("utf-8"))


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def write_text(path: Path, text: str):
    atomic_write(path, text.encode("utf-8"))


def atomic_write(path: Path, data: bytes):
    """Write data to path atomically via temp file + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent))
    try:
        os.write(fd, data)
        os.close(fd)
        os.replace(tmp, str(path))
    except BaseException:
        try:
            os.close(fd)
        except OSError:
            pass
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def mkdir_p(path: Path):
    path.mkdir(parents=True, exist_ok=True)


def rmtree(path: Path):
    if path.is_dir():
        shutil.rmtree(path)
    elif path.is_file():
        path.unlink()


def is_safe_path(base: Path, target: Path) -> bool:
    """Ensure target resolves within base (prevents path traversal via '..')."""
    try:
        target.resolve().relative_to(base.resolve())
        return True
    except ValueError:
        return False
