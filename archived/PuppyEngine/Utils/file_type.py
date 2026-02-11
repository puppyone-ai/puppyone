"""
Utilities for determining normalized file types used by parsers.

Priority order for deciding type:
1) Explicit file_type (already normalized) if provided
2) MIME type mapping
3) Filename extension mapping

Normalized types expected by parsers:
  json | txt | markdown | pdf | doc | csv | xlsx | image | audio | video | application
"""

from typing import Dict, List, Set

_EXT_MAP: Dict[str, str] = {}
_MIME_MAP: Dict[str, str] = {}
_VALID_TYPES: Set[str] = {
    "json", "txt", "markdown", "pdf", "doc",
    "csv", "xlsx", "image", "audio", "video", "application"
}


def _register_default_mappings() -> None:
    # Extension mappings
    ext_map = {
        # text-like
        ".json": "json",
        ".txt": "txt",
        ".md": "markdown",
        ".markdown": "markdown",
        ".mdx": "markdown",
        # docs
        ".pdf": "pdf",
        ".doc": "doc",
        ".docx": "doc",
        # tabular
        ".csv": "csv",
        ".xlsx": "xlsx",
        ".xls": "xlsx",
        ".xlsm": "xlsx",
        ".xlsb": "xlsx",
        ".ods": "xlsx",
        # images
        ".jpg": "image",
        ".jpeg": "image",
        ".png": "image",
        ".gif": "image",
        ".webp": "image",
        # audio
        ".mp3": "audio",
        ".wav": "audio",
        ".m4a": "audio",
        ".flac": "audio",
        # video
        ".mp4": "video",
        ".avi": "video",
        ".mov": "video",
        ".mkv": "video",
        ".webm": "video",
    }
    _EXT_MAP.update(ext_map)

    # MIME mappings
    mime_map = {
        "application/json": "json",
        "text/plain": "txt",
        "text/markdown": "markdown",
        "text/x-markdown": "markdown",
        "application/pdf": "pdf",
        "application/msword": "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "doc",
        "text/csv": "csv",
        "application/csv": "csv",
        "application/vnd.ms-excel": "xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
        "application/vnd.ms-excel.sheet.macroenabled.12": "xlsx",
        "application/vnd.oasis.opendocument.spreadsheet": "xlsx",
    }
    _MIME_MAP.update(mime_map)


_register_default_mappings()


def normalize_type(value: str) -> str:
    if not value:
        return ""
    v = value.strip().lower()
    return v if v in _VALID_TYPES else ""


def infer_from_ext(name: str) -> str:
    if not name:
        return "application"
    n = name.lower()
    for ext, target in _EXT_MAP.items():
        if n.endswith(ext):
            return target
    return "application"


def map_mime(mime: str) -> str:
    if not mime:
        return ""
    m = mime.lower()
    return _MIME_MAP.get(m, "")


def decide_file_type(file_type: str, mime_type: str, name: str) -> str:
    # Prefer explicit file_type if it is already normalized or can be normalized
    if file_type:
        t = normalize_type(file_type)
        if t:
            return t
    # Then try MIME mapping
    t = map_mime(mime_type)
    if t:
        return t
    # Fallback to extension inference
    return infer_from_ext(name)


def register_type(normalized_type: str, exts: List[str] = None, mimes: List[str] = None) -> None:
    """
    Register additional extensions or mime types for a normalized type.
    normalized_type must be one of VALID_TYPES.
    """
    t = normalize_type(normalized_type)
    if not t:
        return
    if exts:
        for e in exts:
            if not e:
                continue
            ee = e.lower()
            if not ee.startswith('.'):
                ee = '.' + ee
            _EXT_MAP[ee] = t
    if mimes:
        for m in mimes:
            if not m:
                continue
            _MIME_MAP[m.lower()] = t


def is_supported_type(normalized_type: str) -> bool:
    return normalize_type(normalized_type) in _VALID_TYPES


