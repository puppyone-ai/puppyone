"""
Sandbox reaper job — periodically check for idle sandbox sessions
and perform write-back + cleanup.

Runs every 60s, reaps sessions idle for ≥ 4 minutes.
"""

from loguru import logger


async def reap_idle_sandboxes():
    """
    Find all sandbox sessions that have been idle for longer than the
    threshold, perform diff-based write-back, then destroy the sandbox.
    """
    from src.sandbox.registry import get_sandbox_registry, diff_and_writeback
    from src.sandbox.dependencies import get_sandbox_service

    registry = get_sandbox_registry()
    idle_sessions = registry.get_idle_sessions()

    if not idle_sessions:
        return

    logger.info(f"[SandboxReaper] Found {len(idle_sessions)} idle sessions to reap")
    sandbox_service = get_sandbox_service()

    collab_service = None
    node_service = None
    try:
        from src.collaboration.conflict_service import ConflictService
        from src.collaboration.lock_service import LockService
        from src.collaboration.version_service import VersionService
        from src.collaboration.version_repository import (
            FileVersionRepository,
            FolderSnapshotRepository,
        )
        from src.collaboration.audit_service import AuditService
        from src.collaboration.audit_repository import AuditRepository
        from src.collaboration.service import CollaborationService
        from src.content_node.repository import ContentNodeRepository
        from src.content_node.service import ContentNodeService
        from src.supabase.client import SupabaseClient
        from src.s3.service import S3Service

        _sb = SupabaseClient()
        _node_repo = ContentNodeRepository(_sb)
        node_service = ContentNodeService(repo=_node_repo, s3_service=S3Service())

        if _node_repo:
            def _get_changelog_repo(sb):
                try:
                    from src.sync.changelog import SyncChangelogRepository
                    return SyncChangelogRepository(sb)
                except Exception:
                    return None

            collab_service = CollaborationService(
                node_repo=_node_repo,
                node_service=node_service,
                lock_service=LockService(_node_repo),
                conflict_service=ConflictService(),
                version_service=VersionService(
                    node_repo=_node_repo,
                    version_repo=FileVersionRepository(_sb),
                    snapshot_repo=FolderSnapshotRepository(_sb),
                    s3_service=S3Service(),
                    changelog_repo=_get_changelog_repo(_sb),
                ),
                audit_service=AuditService(audit_repo=AuditRepository(_sb)),
            )
    except Exception as e:
        logger.warning(f"[SandboxReaper] CollaborationService init failed: {e}")

    for session in idle_sessions:
        try:
            operator_info = {
                "type": "agent",
                "id": session.agent_id,
                "session_id": session.chat_session_id,
            }

            if not session.readonly and collab_service and node_service:
                updated = await diff_and_writeback(
                    sandbox_service=sandbox_service,
                    sandbox_session_id=session.sandbox_session_id,
                    manifest=session.manifest,
                    node_service=node_service,
                    collab_service=collab_service,
                    operator_info=operator_info,
                )
                if updated:
                    logger.info(
                        f"[SandboxReaper] Write-back completed for {session.chat_session_id}: "
                        f"{len(updated)} nodes updated"
                    )

            await sandbox_service.stop(session.sandbox_session_id)
            registry.remove(session.chat_session_id)
            logger.info(
                f"[SandboxReaper] Reaped sandbox {session.sandbox_session_id} "
                f"(session={session.chat_session_id})"
            )
        except Exception as e:
            logger.warning(
                f"[SandboxReaper] Failed to reap {session.sandbox_session_id}: {e}"
            )
            registry.remove(session.chat_session_id)
