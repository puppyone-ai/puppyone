"""Structured timing trace for the Git-native version engine hot path."""

from __future__ import annotations

import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Iterator

from loguru import logger

from src.config import settings


_active_trace_var: ContextVar["VersionTrace | None"] = ContextVar(
    "version_trace",
    default=None,
)


def _trace_enabled() -> bool:
    configured = settings.VERSION_TRACE_ENABLED
    if configured is not None:
        return bool(configured)
    return bool(settings.DEBUG)


def active_version_trace() -> "VersionTrace | None":
    return _active_trace_var.get()


@contextmanager
def use_version_trace(trace: "VersionTrace") -> Iterator["VersionTrace"]:
    token = _active_trace_var.set(trace)
    try:
        yield trace
    finally:
        _active_trace_var.reset(token)


@dataclass
class VersionTrace:
    """Small request-scoped timer that emits structured phase logs.

    When tracing is enabled, every phase is logged. When disabled, slow phase
    and slow request summaries still log so production can catch regressions
    without turning the hot path into a log firehose.
    """

    operation: str
    project_id: str = ""
    scope_path: str = ""
    actor: str = ""
    source_channel: str = ""
    enabled: bool = field(default_factory=_trace_enabled)
    started: float = field(default_factory=time.perf_counter)
    phases: list[dict[str, Any]] = field(default_factory=list)

    @contextmanager
    def phase(self, name: str, **fields: Any) -> Iterator[None]:
        started = time.perf_counter()
        status = "ok"
        try:
            yield
        except Exception as exc:
            status = "error"
            fields = {**fields, "error_type": type(exc).__name__}
            raise
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            event = {
                "phase": name,
                "elapsed_ms": round(elapsed_ms, 2),
                "status": status,
                **_compact(fields),
            }
            self.phases.append(event)
            if self.enabled or elapsed_ms >= settings.VERSION_TRACE_SLOW_PHASE_MS:
                self._log("phase", event)

    def mark(self, name: str, **fields: Any) -> None:
        event = {"phase": name, "elapsed_ms": 0.0, "status": "mark", **_compact(fields)}
        self.phases.append(event)
        if self.enabled:
            self._log("phase", event)

    def finish(self, status: str = "ok", **fields: Any) -> None:
        elapsed_ms = (time.perf_counter() - self.started) * 1000
        slow = elapsed_ms >= settings.VERSION_TRACE_SLOW_REQUEST_MS
        if not self.enabled and not slow:
            return
        event = {
            "status": status,
            "elapsed_ms": round(elapsed_ms, 2),
            "slow": slow,
            "phase_count": len(self.phases),
            "phases": self.phases[-25:],
            **_compact(fields),
        }
        self._log("summary", event, warning=slow and not self.enabled)

    def _log(self, event: str, fields: dict[str, Any], *, warning: bool = False) -> None:
        base_fields = {
            "component": "version_engine",
            "event": f"version_trace.{event}",
            "operation": self.operation,
            "project_id": self.project_id,
            "scope_path": self.scope_path,
            "actor": self.actor,
            "source_channel": self.source_channel,
        }
        reserved = set(base_fields)
        log_fields: dict[str, Any] = dict(base_fields)
        for key, value in fields.items():
            if key in reserved:
                # Phase-local fields should never be able to crash logging by
                # colliding with trace metadata. Keep distinct values for
                # debugging, but drop exact duplicates.
                if value != base_fields[key]:
                    log_fields[f"phase_{key}"] = value
                continue
            log_fields[key] = value
        bound = logger.bind(
            **log_fields,
        )
        message = f"[version_trace] {event} operation={self.operation}"
        if warning:
            bound.warning(message)
        else:
            bound.info(message)


def trace_phase(name: str, **fields: Any):
    trace = active_version_trace()
    if trace is None:
        return _noop_phase()
    return trace.phase(name, **fields)


def trace_mark(name: str, **fields: Any) -> None:
    trace = active_version_trace()
    if trace is not None:
        trace.mark(name, **fields)


@contextmanager
def _noop_phase() -> Iterator[None]:
    yield


def _compact(fields: dict[str, Any]) -> dict[str, Any]:
    compact: dict[str, Any] = {}
    for key, value in fields.items():
        if value is None:
            continue
        if isinstance(value, str) and len(value) > 80:
            compact[key] = value[:77] + "..."
        else:
            compact[key] = value
    return compact
