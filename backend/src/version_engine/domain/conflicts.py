"""Conflict policy domain objects.

The V1 policy stack — per docs/architecture/07-version-engine-supplement.md
§7 — is:

  1. safe auto-merge (identical / one-side / JSON different keys / non-
     overlapping line hunks). Handled in ``application/conflict_policy.py``.
  2. parent-scope-wins for cross-scope same-path overlaps. Parent content
     overrides child content; child writes are audited as
     ``superseded_by_parent`` but not published.
  3. manual_review for scope-bound Access Point Git writes, unless an
     admin-owned rule says otherwise.
  4. last_write_wins for the remaining default path.
  5. manual_review can also be opted into per project / scope / path-glob /
     actor / source.

Future policies (``agent_review`` / ``agent_auto_resolve``) are modelled
here so the API surface stays stable when they are enabled.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


ConflictPolicyName = Literal[
    "last_write_wins",
    "manual_review",
    "reject",
    "agent_review",
    "agent_auto_resolve",
]


@dataclass(frozen=True)
class ConflictPolicyRule:
    """An admin-owned rule for selecting conflict policy.

    ``scope_path`` matches the scope or one of its ancestors (so a rule
    pinned to ``configs/`` also catches ``configs/foo/``). ``path_glob``
    is an ``fnmatch``-style pattern applied to the file's full path.
    """

    policy: ConflictPolicyName
    scope_path: str = ""
    path_glob: str = ""
    actor_type: str = ""
    source_channel: str = ""
    operation_type: str = ""
    resolver: dict = field(default_factory=dict)


@dataclass(frozen=True)
class ConflictPolicyConfig:
    """Admin-owned conflict policy configuration.

    V1 default is ``last_write_wins``: safe auto-merge runs first, then
    parent-scope-wins overrides cross-scope overlaps, then LWW takes the
    incoming write and records the lost content. Admins opt into
    ``manual_review`` (or future agent policies) via ``rules``.
    """

    default_policy: ConflictPolicyName = "last_write_wins"
    rules: list[ConflictPolicyRule] = field(default_factory=list)


@dataclass(frozen=True)
class ConflictPolicyDecision:
    policy: ConflictPolicyName
    reason: str
    resolver: dict = field(default_factory=dict)
