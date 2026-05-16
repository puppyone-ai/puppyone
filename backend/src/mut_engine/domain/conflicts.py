"""Conflict policy domain objects.

The first shipped policy is conservative: deterministic server-side auto
merge is allowed, but unsafe conflicts become manual-review pending events.
Future policy rules are control-plane configuration, not repository content.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


ConflictPolicyName = Literal[
    "manual_review",
    "last_write_wins",
    "agent_review",
    "agent_auto_resolve",
]


@dataclass(frozen=True)
class ConflictPolicyRule:
    """A future admin-owned rule for selecting conflict policy."""

    policy: ConflictPolicyName
    scope_path: str = ""
    path_glob: str = ""
    actor_type: str = ""
    source_channel: str = ""
    resolver: dict = field(default_factory=dict)


@dataclass(frozen=True)
class ConflictPolicyConfig:
    """Admin-owned conflict policy configuration.

    V1 defaults to manual review. LWW and agent auto-resolve are represented in
    the model so the API shape is stable, but they are not selected by default.
    """

    default_policy: ConflictPolicyName = "manual_review"
    rules: list[ConflictPolicyRule] = field(default_factory=list)


@dataclass(frozen=True)
class ConflictPolicyDecision:
    policy: ConflictPolicyName
    reason: str
    resolver: dict = field(default_factory=dict)
