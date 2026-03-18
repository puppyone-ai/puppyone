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
        from src.content_node.repository import ContentNodeRepository
        from src.content_node.service import ContentNodeService
        from src.supabase.client import SupabaseClient
        from src.s3.service import S3Service
        from src.collaboration.dependencies import create_collaboration_service

        _sb = SupabaseClient()
        _node_repo = ContentNodeRepository(_sb)
        node_service = ContentNodeService(repo=_node_repo, s3_service=S3Service())
        collab_service = create_collaboration_service()
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
