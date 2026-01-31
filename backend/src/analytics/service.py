"""
Access Logging Service

Records context access events (data egress) for monitoring.
Designed to be lightweight and non-blocking.
"""

from typing import Optional
from datetime import datetime
from src.supabase import get_supabase_client
from src.utils.logger import logger


async def log_context_access(
    node_id: str,
    node_type: Optional[str] = None,
    node_name: Optional[str] = None,
    user_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    session_id: Optional[str] = None,
    project_id: Optional[str] = None,
) -> None:
    """
    Record a context access event.
    
    Called when a content_node is sent to the sandbox.
    This is fire-and-forget - errors are logged but don't block the main flow.
    """
    try:
        supabase = get_supabase_client()
        
        supabase.table("access_logs").insert({
            "node_id": node_id,
            "node_type": node_type,
            "node_name": node_name,
            "user_id": user_id,
            "agent_id": agent_id,
            "session_id": session_id,
            "project_id": project_id,
        }).execute()
        
        logger.debug(f"[access_log] Logged access: node={node_id}, agent={agent_id}")
        
    except Exception as e:
        # Don't fail the main request if logging fails
        logger.warning(f"[access_log] Failed to log access: {e}")

