"""JSON machine-diff strategy for L5 conflict inputs."""

from __future__ import annotations

import json
from typing import Any


class JsonPathDeltaStrategy:
    id = "json-paths"

    def supports(self, path: str, old_data: bytes | None, new_data: bytes | None) -> bool:
        return path.lower().endswith(".json")

    def changed_regions(
        self,
        path: str,
        old_data: bytes | None,
        new_data: bytes | None,
    ) -> dict:
        try:
            old_map = _flatten_json(_load_json(old_data))
            new_map = _flatten_json(_load_json(new_data))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return {
                "kind": "json-paths",
                "parse_error": type(exc).__name__,
                "fallback": "structural",
            }
        changes = []
        for key_path in sorted(set(old_map) | set(new_map)):
            if key_path not in old_map:
                changes.append(
                    {
                        "path": key_path,
                        "action": "add",
                        "new_type": type(new_map[key_path]).__name__,
                    },
                )
            elif key_path not in new_map:
                changes.append(
                    {
                        "path": key_path,
                        "action": "delete",
                        "old_type": type(old_map[key_path]).__name__,
                    },
                )
            elif old_map[key_path] != new_map[key_path]:
                changes.append(
                    {
                        "path": key_path,
                        "action": "update",
                        "old_type": type(old_map[key_path]).__name__,
                        "new_type": type(new_map[key_path]).__name__,
                    },
                )
        return {"kind": "json-paths", "changed_paths": changes}


def _load_json(data: bytes | None) -> Any:
    if data is None:
        return None
    return json.loads(data.decode("utf-8"))


def _flatten_json(value: Any, prefix: str = "$") -> dict[str, Any]:
    out: dict[str, Any] = {}
    _walk(value, prefix, out)
    return out


def _walk(value: Any, prefix: str, out: dict[str, Any]) -> None:
    if isinstance(value, dict):
        if not value:
            out[prefix] = {}
        for key in sorted(value):
            _walk(value[key], f"{prefix}.{key}", out)
        return
    if isinstance(value, list):
        if not value:
            out[prefix] = []
        for index, item in enumerate(value):
            _walk(item, f"{prefix}[{index}]", out)
        return
    out[prefix] = value
