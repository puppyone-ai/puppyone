"""Admitted Version Engine target facts."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class TargetAdmission:
    """L3 output consumed by adapters and the write engine boundary.

    A target admission is not merely an auth result. It captures the concrete
    project/scope/ref/actions snapshot that a caller is allowed to operate on.
    """

    project_id: str
    actor: str
    source_channel: str
    scope_path: str = ""
    ref: str = "refs/heads/main"
    mode: str = "rw"
    excludes: tuple[str, ...] = ()
    allowed_actions: frozenset[str] = field(default_factory=frozenset)
    audit_detail: dict = field(default_factory=dict)

    def allows(self, action: str) -> bool:
        return action in self.allowed_actions
