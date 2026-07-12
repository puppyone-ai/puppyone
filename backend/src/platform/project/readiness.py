"""Derived Project Git and Claude readiness.

Readiness is a projection of durable facts. It is never a mutable flag on the
Project row, so a non-root push or failed push cannot accidentally unlock the
Project Agent surface.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.platform.project.readiness_repository import ProjectReadinessRepository


@dataclass(frozen=True, slots=True)
class ProjectReadiness:
    project_id: str
    root_scope_id: str | None
    root_surface_exists: bool
    root_head_exists: bool
    root_git_push_accepted: bool
    default_branch: str

    @property
    def git_state(self) -> str:
        if not self.root_surface_exists:
            return "git_not_created"
        if not self.root_head_exists or not self.root_git_push_accepted:
            return "awaiting_first_push"
        return "ready"

    @property
    def claude_ready(self) -> bool:
        return (
            self.root_surface_exists
            and self.root_head_exists
            and self.root_git_push_accepted
        )

    @property
    def blockers(self) -> list[str]:
        blockers: list[str] = []
        if not self.root_surface_exists:
            blockers.append("root_git_surface_missing")
        if not self.root_head_exists:
            blockers.append("root_head_missing")
        if not self.root_git_push_accepted:
            blockers.append("root_git_push_not_accepted")
        return blockers

    def as_dict(self) -> dict[str, Any]:
        return {
            "project_id": self.project_id,
            "git": {
                "root_scope_id": self.root_scope_id,
                "root_surface_exists": self.root_surface_exists,
                "root_head_exists": self.root_head_exists,
                "root_git_push_accepted": self.root_git_push_accepted,
                "default_branch": self.default_branch,
                "state": self.git_state,
            },
            "claude": {
                "ready": self.claude_ready,
                "blockers": self.blockers,
            },
        }


class ProjectReadinessService:
    def __init__(self, repository: ProjectReadinessRepository | None = None):
        self._repository = repository or ProjectReadinessRepository()

    def resolve(self, project_id: str) -> ProjectReadiness:
        facts = self._repository.load(project_id)
        root_head = str(facts["root_head_commit_id"])
        root_head_exists = len(root_head) == 40 and all(
            character in "0123456789abcdef" for character in root_head.lower()
        )
        return ProjectReadiness(
            project_id=project_id,
            root_scope_id=facts["root_scope_id"],
            root_surface_exists=bool(facts["root_surface_exists"]),
            root_head_exists=root_head_exists,
            root_git_push_accepted=bool(facts["root_git_push_accepted"]),
            default_branch=str(facts["default_branch"]),
        )
