"""Text-line machine-diff strategy for L5 conflict inputs."""

from __future__ import annotations

from difflib import SequenceMatcher


class TextLineDeltaStrategy:
    id = "text-lines"

    def __init__(self, *, max_bytes: int = 1_000_000, max_regions: int = 256) -> None:
        self.max_bytes = max_bytes
        self.max_regions = max_regions

    def supports(self, path: str, old_data: bytes | None, new_data: bytes | None) -> bool:
        if not _looks_text_path(path):
            return False
        data = new_data if new_data is not None else old_data
        return _decode_text(data, self.max_bytes) is not None

    def changed_regions(
        self,
        path: str,
        old_data: bytes | None,
        new_data: bytes | None,
    ) -> dict:
        old_text = _decode_text(old_data, self.max_bytes) or ""
        new_text = _decode_text(new_data, self.max_bytes) or ""
        old_lines = old_text.splitlines()
        new_lines = new_text.splitlines()
        regions = []
        truncated = False
        for tag, old_start, old_end, new_start, new_end in SequenceMatcher(
            None,
            old_lines,
            new_lines,
            autojunk=False,
        ).get_opcodes():
            if tag == "equal":
                continue
            if len(regions) >= self.max_regions:
                truncated = True
                break
            regions.append(
                {
                    "action": tag,
                    "old_start": old_start + 1,
                    "old_end": old_end,
                    "new_start": new_start + 1,
                    "new_end": new_end,
                },
            )
        return {"kind": "text-lines", "changed_ranges": regions, "truncated": truncated}


_TEXT_SUFFIXES = {
    ".css",
    ".csv",
    ".html",
    ".ini",
    ".js",
    ".jsx",
    ".md",
    ".markdown",
    ".py",
    ".svg",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}


def _looks_text_path(path: str) -> bool:
    lower = path.lower()
    return any(lower.endswith(suffix) for suffix in _TEXT_SUFFIXES)


def _decode_text(data: bytes | None, max_bytes: int) -> str | None:
    if data is None:
        return ""
    if len(data) > max_bytes:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None
