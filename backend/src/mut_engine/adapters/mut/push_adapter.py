"""Translate legacy MUT push payloads into version submissions."""

from __future__ import annotations

import base64

from src.mut_engine.adapters.mut.protocol import (
    PushRequest,
    PushResponse,
    require_supported_protocol,
)
from src.mut_engine.application.errors import PermissionDenied
from src.mut_engine.application.path_utils import normalize_path
from src.mut_engine.application.transaction_engine import GitNativeTransactionEngine
from src.mut_engine.domain.intents import VersionSubmissionIntent
from src.mut_engine.server.repo_manager import MutRepoManager


def store_incoming_objects(repo, objects_b64: dict) -> None:
    """Store incoming Git loose-object bytes verbatim."""

    for object_id, b64data in (objects_b64 or {}).items():
        repo.store.put_loose(object_id, base64.b64decode(b64data))


async def submit_mut_push(
    repo_manager: MutRepoManager,
    project_id: str,
    auth: dict,
    body: dict,
) -> dict:
    """Handle a legacy MUT push through the Git-native transaction engine."""

    require_supported_protocol(body)
    scope = auth["_scope"]
    if scope.get("mode", "r") == "r":
        raise PermissionDenied("scope is read-only")

    req = PushRequest.from_dict(body)
    repo = repo_manager.get_server_repo(project_id)
    store_incoming_objects(repo, req.objects)

    scope_path = normalize_path(scope.get("path", ""))
    if not req.snapshots:
        return PushResponse(
            status="ok",
            commit_id=repo.get_scope_head_commit_id(scope_path),
        ).to_dict()

    snapshot = req.snapshots[-1]
    engine = GitNativeTransactionEngine(repo_manager)
    result = await engine.submit_version(
        VersionSubmissionIntent(
            project_id=project_id,
            scope_path=scope_path,
            actor=auth["agent"],
            source_channel="mut",
            base_commit_id=req.base_commit_id,
            proposed_tree_id=snapshot["root"],
            client_commit_id=snapshot.get("commit_id", ""),
            message=snapshot.get("message", ""),
            scope_excludes=scope.get("exclude") or [],
            audit_detail={"snapshots": len(req.snapshots)},
            defer_projection=True,
        )
    )

    return PushResponse(
        status=result.status,
        commit_id=result.commit_id,
        pushed=len(req.snapshots),
        root=result.new_scope_hash,
        merged=result.merged,
        conflicts=result.conflicts,
        merged_changes=result.merged_changes,
        commit_object=result.commit_object,
    ).to_dict()
