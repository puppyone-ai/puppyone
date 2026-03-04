from __future__ import annotations

from contextvars import ContextVar
from typing import Any


request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
method_var: ContextVar[str | None] = ContextVar("method", default=None)
path_var: ContextVar[str | None] = ContextVar("path", default=None)
client_ip_var: ContextVar[str | None] = ContextVar("client_ip", default=None)

# Per-request cache: key = "project_id:user_id", value = role string or None
project_access_cache_var: ContextVar[dict[str, str | None] | None] = ContextVar(
    "project_access_cache", default=None
)


def patch_log_record_from_context(record: dict[str, Any]) -> None:
    """
    Loguru patcher: inject per-request contextvars into record["extra"].
    This runs for every log event (including intercepted stdlib logging).
    """
    extra = record.setdefault("extra", {})
    extra.setdefault("request_id", request_id_var.get())
    extra.setdefault("method", method_var.get())
    extra.setdefault("path", path_var.get())
    extra.setdefault("client_ip", client_ip_var.get())
