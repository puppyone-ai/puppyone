"""Provider detection helpers for one-time imports."""

from __future__ import annotations

from urllib.parse import urlparse


def detect_import_provider(source_url: str) -> str:
    """Return the import provider key for a pasted source URL."""
    parsed = urlparse(source_url)
    scheme = parsed.scheme.lower()
    host = parsed.netloc.lower()

    if scheme == "oauth":
        oauth_type = host or parsed.path.strip("/")
        mapping = {
            "gmail": "gmail",
            "drive": "google_drive",
            "google-drive": "google_drive",
            "calendar": "google_calendar",
            "google-calendar": "google_calendar",
        }
        return mapping.get(oauth_type, "url")

    if host in ("github.com", "www.github.com"):
        return "github"
    if host in ("notion.so", "www.notion.so") or "notion.site" in host:
        return "notion"
    if "airtable.com" in host:
        return "airtable"
    if "docs.google.com" in host and "/spreadsheets/" in source_url:
        return "google_sheets"
    if "docs.google.com" in host and "/document/" in source_url:
        return "google_docs"
    if "linear.app" in host:
        return "linear"
    if "drive.google.com" in host:
        return "google_drive"

    return "url"


def suggest_import_name(provider: str, source_url: str) -> str | None:
    """Best-effort human name for the imported folder/file."""
    parsed = urlparse(source_url)
    if provider == "github":
        parts = [part for part in parsed.path.strip("/").split("/") if part]
        if len(parts) < 2:
            return None
        repo = parts[1][:-4] if parts[1].endswith(".git") else parts[1]
        repo = repo.strip().strip("/")
        return repo or None

    if provider == "url":
        host = parsed.netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        return host or None

    return None
