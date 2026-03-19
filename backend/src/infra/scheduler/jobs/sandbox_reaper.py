"""
Sandbox reaper job — periodically check for idle sandbox sessions
and perform write-back + cleanup.

Runs every 60s, reaps sessions idle for >= 4 minutes.
"""

from loguru import logger


async def reap_idle_sandboxes():
    """
    Find all sandbox sessions that have been idle for longer than the
    threshold, perform diff-based write-back via MUT protocol, then destroy the sandbox.
    """
    from src.sandbox.registry import get_sandbox_registry, diff_and_writeback
    from src.sandbox.dependencies import get_sandbox_service

    registry = get_sandbox_registry()
    idle_sessions = registry.get_idle_sessions()

    if not idle_sessions:
        return

    logger.info(f"[SandboxReaper] Found {len(idle_sessions)} idle sessions to reap")
    sandbox_service = get_sandbox_service()

    for session in idle_sessions:
        try:
            operator_info = {
                "type": "agent",
                "id": session.agent_id,
                "session_id": session.chat_session_id,
            }

            if not session.readonly:
                ephemeral_client = None
                try:
                    from src.mut_engine.dependencies import create_ephemeral_client
                    import asyncio
                    auth_context = {
                        "agent": f"agent:{session.agent_id}",
                        "_scope": {"id": "_root", "path": "", "exclude": [], "mode": "rw"},
                    }
                    # TODO: need project_id from operator_info; for now skip if not available
                    project_id = operator_info.get("project_id", "")
                    if project_id:
                        ephemeral_client = create_ephemeral_client(project_id, auth_context)
                        await asyncio.to_thread(ephemeral_client.clone)
                except Exception as e:
                    logger.warning(f"[SandboxReaper] MutEphemeralClient init failed: {e}")

                if ephemeral_client:
                    updated = await diff_and_writeback(
                        sandbox_service=sandbox_service,
                        sandbox_session_id=session.sandbox_session_id,
                        manifest=session.manifest,
                        ephemeral_client=ephemeral_client,
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
