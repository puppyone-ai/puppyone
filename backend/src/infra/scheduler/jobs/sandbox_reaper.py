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
                "project_id": session.project_id,
                "parent_path": session.parent_path,
            }

            if not session.readonly and session.project_id:
                ops = None
                try:
                    from src.mut_engine.dependencies import create_mut_ops
                    ops = create_mut_ops()
                except Exception as e:
                    logger.warning(f"[SandboxReaper] MutOps init failed: {e}")

                if ops:
                    updated = await diff_and_writeback(
                        sandbox_service=sandbox_service,
                        sandbox_session_id=session.sandbox_session_id,
                        manifest=session.manifest,
                        ops=ops,
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
