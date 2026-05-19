"""
Sandbox reaper job — periodically check for idle sandbox sessions
and perform write-back + cleanup.

Runs every 60s, reaps sessions idle for >= 4 minutes.
"""

from loguru import logger


async def reap_idle_sandboxes():
    """
    Find all agent sandbox sessions that have been idle for longer than the
    threshold, perform hash write-back, then destroy the sandbox.
    """
    from src.connectors.agent.sandbox_session import (
        get_agent_sandbox_registry,
        writeback_and_destroy,
    )
    from src.infra.sandbox.dependencies import get_sandbox_service

    registry = get_agent_sandbox_registry()
    idle_sessions = registry.get_idle_sessions()

    if not idle_sessions:
        return

    logger.info(f"[SandboxReaper] Found {len(idle_sessions)} idle sessions to reap")
    sandbox_service = get_sandbox_service()

    for session in idle_sessions:
        try:
            updated = await writeback_and_destroy(session, sandbox_service)
            registry.remove(session.chat_session_id)

            if updated:
                logger.info(
                    f"[SandboxReaper] Write-back completed for {session.chat_session_id}: "
                    f"{len(updated)} nodes updated"
                )
            logger.info(
                f"[SandboxReaper] Reaped sandbox {session.sandbox_session_id} "
                f"(session={session.chat_session_id})"
            )
        except Exception as e:
            logger.warning(
                f"[SandboxReaper] Failed to reap {session.sandbox_session_id}: {e}"
            )
            registry.remove(session.chat_session_id)
