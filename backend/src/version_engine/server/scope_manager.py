"""Server-side scope management owned by PuppyOne."""

from __future__ import annotations

import abc
import json
from pathlib import Path

from src.version_engine.application.path_utils import normalize_path


class ScopeBackend(abc.ABC):
    @abc.abstractmethod
    def get(self, scope_id: str) -> dict | None: ...

    @abc.abstractmethod
    def put(self, scope_id: str, scope: dict) -> None: ...

    @abc.abstractmethod
    def delete(self, scope_id: str) -> bool: ...

    @abc.abstractmethod
    def list_all(self) -> list[dict]: ...

    def find_by_path_prefix(self, path_prefix: str) -> list[dict]:
        prefix = normalize_path(path_prefix)
        results = []
        for scope in self.list_all():
            scope_path = normalize_path(scope.get("path", ""))
            if not prefix or scope_path == prefix or scope_path.startswith(prefix + "/"):
                results.append(scope)
        return results


class FileSystemScopeBackend(ScopeBackend):
    def __init__(self, scopes_dir: Path):
        self.dir = scopes_dir

    def get(self, scope_id: str) -> dict | None:
        path = self.dir / f"{scope_id}.json"
        if not path.exists():
            return None
        return json.loads(path.read_text())

    def put(self, scope_id: str, scope: dict) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / f"{scope_id}.json").write_text(json.dumps(scope, indent=2))

    def delete(self, scope_id: str) -> bool:
        path = self.dir / f"{scope_id}.json"
        if path.exists():
            path.unlink()
            return True
        return False

    def list_all(self) -> list[dict]:
        if not self.dir.exists():
            return []
        return [
            json.loads(path.read_text())
            for path in sorted(self.dir.iterdir())
            if path.suffix == ".json"
        ]


class ScopeManager:
    def __init__(self, backend: ScopeBackend):
        self._backend = backend

    def add(self, scope_id: str, path: str, exclude: list | None = None) -> dict:
        scope = {"id": scope_id, "path": path, "exclude": exclude or []}
        self._backend.put(scope_id, scope)
        return scope

    def get_by_id(self, scope_id: str) -> dict | None:
        return self._backend.get(scope_id)

    def delete(self, scope_id: str) -> bool:
        return self._backend.delete(scope_id)

    def list_all(self) -> list[dict]:
        return self._backend.list_all()

    def find_by_path_prefix(self, path_prefix: str) -> list[dict]:
        return self._backend.find_by_path_prefix(path_prefix)

    def update_path(self, scope_id: str, new_path: str) -> dict | None:
        scope = self._backend.get(scope_id)
        if not scope:
            return None
        scope["path"] = new_path
        self._backend.put(scope_id, scope)
        return scope

    def split_scope(self, old_scope_id: str, new_scopes: list[dict]) -> list[dict]:
        old = self._backend.get(old_scope_id)
        if not old:
            raise ValueError(f"scope '{old_scope_id}' not found")
        created = [
            self.add(scope["id"], scope["path"], scope.get("exclude"))
            for scope in new_scopes
        ]
        self._backend.delete(old_scope_id)
        return created

    def merge_scopes(
        self,
        scope_ids: list[str],
        new_scope_id: str,
        new_path: str,
        new_exclude: list | None = None,
    ) -> dict:
        for scope_id in scope_ids:
            if not self._backend.get(scope_id):
                raise ValueError(f"scope '{scope_id}' not found")
        new_scope = self.add(new_scope_id, new_path, new_exclude)
        for scope_id in scope_ids:
            self._backend.delete(scope_id)
        return new_scope
