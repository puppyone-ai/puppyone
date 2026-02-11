"""
Import Worker - ARQ worker configuration and startup.

Run worker:
  uv run arq src.import_.jobs.worker.WorkerSettings
"""

from __future__ import annotations

# Load .env file before any other imports that need env vars
from pathlib import Path
from dotenv import load_dotenv

# Find .env relative to this file (backend/.env)
# worker.py -> jobs/ -> saas/ -> ingest/ -> src/ -> backend/
_env_path = Path(__file__).resolve().parent.parent.parent.parent.parent / ".env"
load_dotenv(_env_path, override=True)

from typing import Any

from arq.connections import RedisSettings

from src.ingest.saas.config import import_config
from src.ingest.saas.jobs.jobs import import_job
from src.db_connector.jobs import db_sync_job
from src.ingest.saas.task.manager import ImportTaskManager
from src.ingest.saas.task.repository import ImportTaskRepository
from src.content_node.repository import ContentNodeRepository
from src.content_node.service import ContentNodeService
from src.supabase.client import SupabaseClient
from src.oauth.github_service import GithubOAuthService
from src.oauth.notion_service import NotionOAuthService
from src.oauth.gmail_service import GmailOAuthService
from src.oauth.google_drive_service import GoogleDriveOAuthService
from src.oauth.google_calendar_service import GoogleCalendarOAuthService
from src.oauth.google_sheets_service import GoogleSheetsOAuthService
from src.oauth.google_docs_service import GoogleDocsOAuthService
from src.oauth.airtable_service import AirtableOAuthService
from src.oauth.linear_service import LinearOAuthService
from src.s3.service import S3Service
from src.db_connector.repository import DBConnectionRepository
from src.utils.logger import log_info


async def startup(ctx: dict[str, Any]) -> None:
    """Initialize services on worker startup."""
    log_info("Import worker starting up...")
    
    # Initialize Supabase client
    supabase_client = SupabaseClient()
    
    # Initialize repositories
    task_repository = ImportTaskRepository()
    node_repository = ContentNodeRepository(supabase_client)
    
    # Initialize services
    s3_service = S3Service()
    
    ctx["task_manager"] = ImportTaskManager(task_repository)
    ctx["node_service"] = ContentNodeService(node_repository, s3_service)
    ctx["s3_service"] = s3_service
    
    # OAuth services
    ctx["github_service"] = GithubOAuthService()
    ctx["notion_service"] = NotionOAuthService()
    ctx["gmail_service"] = GmailOAuthService()
    ctx["drive_service"] = GoogleDriveOAuthService()
    ctx["calendar_service"] = GoogleCalendarOAuthService()
    ctx["sheets_service"] = GoogleSheetsOAuthService()
    ctx["docs_service"] = GoogleDocsOAuthService()
    ctx["airtable_service"] = AirtableOAuthService()
    ctx["linear_service"] = LinearOAuthService()
    
    # DB Connector (for db_sync_job)
    ctx["db_repo"] = DBConnectionRepository(supabase_client)
    
    log_info("Import worker initialized with all OAuth services + DB connector")


async def shutdown(ctx: dict[str, Any]) -> None:
    """Cleanup on worker shutdown."""
    log_info("Import worker shutting down...")


class WorkerSettings:
    """ARQ Worker configuration."""
    
    # Import job for all imports + DB sync job
    functions = [import_job, db_sync_job]
    on_startup = startup
    on_shutdown = shutdown
    
    # Redis connection
    redis_settings = RedisSettings.from_dsn(import_config.import_redis_url)
    
    # Worker settings
    max_jobs = import_config.import_max_jobs
    job_timeout = import_config.import_job_timeout_seconds
    keep_result = 3600  # 1 hour
    queue_name = import_config.import_arq_queue_name
