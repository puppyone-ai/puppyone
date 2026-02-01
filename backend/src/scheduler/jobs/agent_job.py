"""
Agent execution job for scheduled tasks.

This module contains the function that APScheduler calls when a scheduled
agent task needs to run.
"""

import asyncio
import json
from datetime import datetime, timezone
from typing import Optional

from src.utils.logger import log_info, log_error, log_warning


async def _execute_agent_task_async(agent_id: str) -> dict:
    """
    Execute a scheduled agent task asynchronously.
    
    This function:
    1. Loads the agent configuration from database
    2. Creates an execution log entry
    3. Runs the agent task using AgentService.execute_task_sync()
    4. Updates the execution log with results
    
    Args:
        agent_id: The unique ID of the agent to execute
        
    Returns:
        dict with execution results
    """
    from src.supabase.client import SupabaseClient
    from src.agent.service import AgentService
    from src.agent.config.service import AgentConfigService
    from src.content_node.service import ContentNodeService
    from src.content_node.repository import ContentNodeRepository
    from src.sandbox.service import SandboxService
    from src.s3.service import S3Service
    
    started_at = datetime.now(timezone.utc)
    execution_id: Optional[str] = None
    
    log_info(f"🚀 Starting scheduled execution for agent {agent_id}")
    
    try:
        db_client = SupabaseClient().client
        
        # 1. Load agent configuration
        agent_result = db_client.table("agents").select("*").eq("id", agent_id).single().execute()
        agent = agent_result.data
        
        if not agent:
            log_error(f"Agent {agent_id} not found")
            return {"status": "failed", "error": "Agent not found"}
        
        user_id = agent.get("user_id")
        agent_name = agent.get("name", "Unknown")
        task_content = agent.get("task_content", "")
        
        log_info(f"📋 Agent loaded: {agent_name} (type: {agent.get('type')})")
        log_info(f"📋 Task content: {task_content[:100]}..." if len(task_content) > 100 else f"📋 Task content: {task_content}")
        
        # 2. Create execution log entry
        execution_data = {
            "agent_id": agent_id,
            "trigger_type": "cron",
            "trigger_source": "scheduler",
            "status": "running",
            "started_at": started_at.isoformat(),
            "input_snapshot": {
                "task_content": task_content,
                "trigger_config": agent.get("trigger_config"),
            }
        }
        
        log_result = db_client.table("agent_execution_log").insert(execution_data).execute()
        if log_result.data:
            execution_id = log_result.data[0].get("id")
            log_info(f"📝 Created execution log: {execution_id}")
        
        # 3. Initialize services
        log_info(f"🔧 Initializing services...")
        
        # 创建服务实例
        supabase_client = SupabaseClient()
        agent_service = AgentService()
        agent_config_service = AgentConfigService()
        node_repository = ContentNodeRepository(supabase_client)
        s3_service = S3Service()
        node_service = ContentNodeService(node_repository, s3_service)
        sandbox_service = SandboxService()
        
        # 4. Execute the agent task using AgentService
        log_info(f"🤖 Running task for agent '{agent_name}'...")
        
        exec_result = await agent_service.execute_task_sync(
            agent_id=agent_id,
            task_content=task_content,
            user_id=user_id,
            node_service=node_service,
            sandbox_service=sandbox_service,
            s3_service=s3_service,
            agent_config_service=agent_config_service,
        )
        
        # 5. Update execution log with results
        finished_at = datetime.now(timezone.utc)
        duration_ms = int((finished_at - started_at).total_seconds() * 1000)
        
        if exec_result.get("status") == "success":
            if execution_id:
                db_client.table("agent_execution_log").update({
                    "status": "success",
                    "finished_at": finished_at.isoformat(),
                    "duration_ms": duration_ms,
                    "output_summary": exec_result.get("output_summary", "")[:2000],
                    "output_snapshot": {
                        "tool_calls": exec_result.get("tool_calls", []),
                        "updated_nodes": exec_result.get("updated_nodes", []),
                    }
                }).eq("id", execution_id).execute()
            
            log_info(f"✅ Agent {agent_id} execution completed in {duration_ms}ms")
            log_info(f"📊 Updated nodes: {exec_result.get('updated_nodes', [])}")
        else:
            error_msg = exec_result.get("error", "Unknown error")
            if execution_id:
                db_client.table("agent_execution_log").update({
                    "status": "failed",
                    "finished_at": finished_at.isoformat(),
                    "duration_ms": duration_ms,
                    "error_message": error_msg,
                }).eq("id", execution_id).execute()
            
            log_error(f"❌ Agent {agent_id} execution failed: {error_msg}")
        
        return {
            "status": exec_result.get("status", "failed"),
            "execution_id": execution_id,
            "duration_ms": duration_ms,
            "output_summary": exec_result.get("output_summary", ""),
            "updated_nodes": exec_result.get("updated_nodes", []),
        }
        
    except Exception as e:
        log_error(f"❌ Agent {agent_id} execution failed: {e}")
        import traceback
        log_error(f"Traceback: {traceback.format_exc()}")
        
        # Update execution log with failure
        if execution_id:
            try:
                client = SupabaseClient().client
                finished_at = datetime.now(timezone.utc)
                duration_ms = int((finished_at - started_at).total_seconds() * 1000)
                
                client.table("agent_execution_log").update({
                    "status": "failed",
                    "finished_at": finished_at.isoformat(),
                    "duration_ms": duration_ms,
                    "error_message": str(e),
                }).eq("id", execution_id).execute()
            except Exception as update_error:
                log_error(f"Failed to update execution log: {update_error}")
        
        return {
            "status": "failed",
            "execution_id": execution_id,
            "error": str(e),
        }


def execute_agent_task(agent_id: str):
    """
    Synchronous wrapper for APScheduler.
    
    APScheduler calls this function from a ThreadPoolExecutor.
    We create a new event loop to run the async task.
    """
    log_info(f"⏰ Scheduler triggered for agent {agent_id}")
    
    try:
        # Create new event loop for this thread
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            result = loop.run_until_complete(_execute_agent_task_async(agent_id))
            return result
        finally:
            loop.close()
            
    except Exception as e:
        log_error(f"Failed to execute agent task: {e}")
        return {"status": "failed", "error": str(e)}

