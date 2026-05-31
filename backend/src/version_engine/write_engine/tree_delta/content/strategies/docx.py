"""DOCX package machine-diff strategy for L5 conflict inputs."""

from __future__ import annotations

from hashlib import sha1
from io import BytesIO
from zipfile import BadZipFile, ZipFile


class DocxPackageDeltaStrategy:
    id = "docx-package-parts"

    def __init__(self, *, max_parts: int = 512) -> None:
        self.max_parts = max_parts

    def supports(self, path: str, old_data: bytes | None, new_data: bytes | None) -> bool:
        return path.lower().endswith(".docx")

    def changed_regions(
        self,
        path: str,
        old_data: bytes | None,
        new_data: bytes | None,
    ) -> dict:
        try:
            old_parts = _package_parts(old_data)
            new_parts = _package_parts(new_data)
        except BadZipFile:
            return {
                "kind": "docx-package-parts",
                "parse_error": "BadZipFile",
                "fallback": "structural",
            }
        changes = []
        truncated = False
        for part in sorted(set(old_parts) | set(new_parts)):
            if len(changes) >= self.max_parts:
                truncated = True
                break
            if part not in old_parts:
                changes.append({"part": part, "action": "add", "new_sha1": new_parts[part]})
            elif part not in new_parts:
                changes.append({"part": part, "action": "delete", "old_sha1": old_parts[part]})
            elif old_parts[part] != new_parts[part]:
                changes.append(
                    {
                        "part": part,
                        "action": "update",
                        "old_sha1": old_parts[part],
                        "new_sha1": new_parts[part],
                    },
                )
        return {
            "kind": "docx-package-parts",
            "changed_parts": changes,
            "truncated": truncated,
        }


def _package_parts(data: bytes | None) -> dict[str, str]:
    if data is None:
        return {}
    parts: dict[str, str] = {}
    with ZipFile(BytesIO(data)) as archive:
        for name in archive.namelist():
            if name.endswith("/"):
                continue
            if not _is_relevant_part(name):
                continue
            parts[name] = sha1(_normalise_part(name, archive.read(name))).hexdigest()
    return parts


def _is_relevant_part(name: str) -> bool:
    return (
        name == "[Content_Types].xml"
        or name.endswith(".rels")
        or name.endswith(".xml")
    )


def _normalise_part(name: str, data: bytes) -> bytes:
    if name.endswith(".xml") or name.endswith(".rels"):
        return b" ".join(data.split())
    return data
