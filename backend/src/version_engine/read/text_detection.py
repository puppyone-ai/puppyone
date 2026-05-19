"""Text/binary heuristics for history diff payloads."""

from __future__ import annotations

_TEXT_MIME_TYPES = {
    "application/javascript",
    "application/json",
    "application/toml",
    "application/x-javascript",
    "application/x-ndjson",
    "application/x-sh",
    "application/x-yaml",
    "application/xml",
}

_TEXT_NODE_TYPES = {"json", "markdown"}
_ALLOWED_CONTROLS = {"\n", "\r", "\t", "\f", "\b"}


def is_binary_content(
    content: bytes,
    *,
    node_type: str = "",
    mime_type: str = "",
    sample_size: int = 8192,
) -> bool:
    if node_type in _TEXT_NODE_TYPES:
        return False

    mime = (mime_type or "").lower()
    if mime.startswith("text/") or mime in _TEXT_MIME_TYPES:
        return False

    sample = content[:sample_size]
    if b"\x00" in sample:
        return True

    try:
        text = sample.decode("utf-8")
    except UnicodeDecodeError:
        return True

    if not text:
        return False

    control_count = sum(
        1
        for char in text
        if ord(char) < 32 and char not in _ALLOWED_CONTROLS
    )
    return control_count / len(text) > 0.02
