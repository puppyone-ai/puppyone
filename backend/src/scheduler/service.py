"""
Scheduler service for managing scheduled agent executions.
"""

from typing import Optional
from datetime import datetime
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.executors.pool import ThreadPoolExecutor
from apscheduler.job import Job

from src.scheduler.config import scheduler_settings
from src.scheduler.jobs import execute_agent_task, execute_sync_pull
from src.utils.logger import log_info, log_error, log_warning


class SchedulerService:
    """
    Service for managing APScheduler and agent jobs.
    
    Responsibilities:
    - Start/stop the scheduler
    - Add/remove/update agent jobs dynamically
    - Load all schedule agents from database on startup
    """
    
    _instance: Optional["SchedulerService"] = None
    
    def __init__(self):
        self.scheduler: Optional[AsyncIOScheduler] = None
        self._started = False
    
    @classmethod
    def get_instance(cls) -> "SchedulerService":
        """Get singleton instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
    
    async def start(self):
        """Initialize and start the scheduler."""
        if not scheduler_settings.enabled:
            log_info("⏭️  Scheduler disabled (SCHEDULER_ENABLED=false)")
            return
        
        if self._started:
            log_warning("Scheduler already started")
            return
        
        log_info("⏰ Starting APScheduler...")
        
        # Configure executors
        executors = {
            "default": ThreadPoolExecutor(scheduler_settings.max_workers)
        }
        
        # Configure job defaults
        job_defaults = {
            "coalesce": scheduler_settings.coalesce,
            "max_instances": 1,
            "misfire_grace_time": scheduler_settings.misfire_grace_time,
        }
        
        # Create scheduler
        self.scheduler = AsyncIOScheduler(
            executors=executors,
            job_defaults=job_defaults,
            timezone=scheduler_settings.timezone,
        )
        
        # Start the scheduler
        self.scheduler.start()
        self._started = True
        
        # Load existing schedule agents from database
        await self._load_scheduled_agents()
        await self._load_scheduled_syncs()
        
        log_info(f"✅ APScheduler started with {scheduler_settings.max_workers} workers")
    
    async def shutdown(self):
        """Gracefully shutdown the scheduler."""
        if self.scheduler and self._started:
            log_info("⏰ Shutting down APScheduler...")
            self.scheduler.shutdown(wait=True)
            self._started = False
            log_info("✅ APScheduler stopped")
    
    async def _load_scheduled_agents(self):
        """Load all schedule agents from database and register jobs."""
        if not self.scheduler:
            return
        
        try:
            from src.supabase.client import SupabaseClient
            
            client = SupabaseClient().client
            
            # Query all schedule type agents with cron trigger
            result = client.table("agents").select("*").eq("type", "schedule").eq("trigger_type", "cron").execute()
            
            agents = result.data or []
            log_info(f"📋 Found {len(agents)} schedule agents to load")
            
            for agent in agents:
                await self.add_agent_job(
                    agent_id=agent["id"],
                    trigger_config=agent.get("trigger_config") or {},
                    agent_name=agent.get("name", "Unknown")
                )
            
            log_info(f"✅ Loaded {len(agents)} agent jobs")
            
        except Exception as e:
            log_error(f"❌ Failed to load scheduled agents: {e}")
    
    async def add_agent_job(
        self,
        agent_id: str,
        trigger_config: dict,
        agent_name: str = ""
    ) -> Optional[Job]:
        """
        Add a new agent job to the scheduler.
        
        Args:
            agent_id: The agent's unique ID (used as job_id)
            trigger_config: Configuration containing schedule info
                - schedule: cron expression (e.g., "0 9 * * *")
                - timezone: optional timezone override
                - date: ISO date for one-time execution
                - repeat_type: 'once', 'daily', 'weekly'
            agent_name: Human-readable name for logging
        """
        if not self.scheduler or not self._started:
            log_warning(f"Scheduler not running, skipping job for agent {agent_id}")
            return None
        
        # Remove existing job if any
        self.remove_agent_job(agent_id)
        
        # Parse trigger configuration
        trigger = self._parse_trigger(trigger_config)
        if not trigger:
            log_warning(f"Invalid trigger config for agent {agent_id}: {trigger_config}")
            return None
        
        # Add the job
        job = self.scheduler.add_job(
            execute_agent_task,
            trigger=trigger,
            id=agent_id,
            name=f"Agent: {agent_name or agent_id}",
            args=[agent_id],
            replace_existing=True,
        )
        
        next_run = job.next_run_time.strftime("%Y-%m-%d %H:%M:%S") if job.next_run_time else "N/A"
        log_info(f"📅 Added job for agent '{agent_name}' ({agent_id}), next run: {next_run}")
        
        return job
    
    # ── Sync Jobs ─────────────────────────────────────────────

    async def _load_scheduled_syncs(self):
        """Load all syncs with trigger type 'scheduled' and register jobs."""
        if not self.scheduler:
            return

        try:
            from src.supabase.client import SupabaseClient

            client = SupabaseClient().client
            result = (
                client.table("syncs")
                .select("id, provider, trigger, status")
                .eq("status", "active")
                .execute()
            )

            syncs = result.data or []
            scheduled = [
                s for s in syncs
                if (s.get("trigger") or {}).get("type") == "scheduled"
            ]

            log_info(f"Found {len(scheduled)} scheduled syncs to load")

            for sync_row in scheduled:
                trigger_config = sync_row.get("trigger") or {}
                await self.add_sync_job(
                    sync_id=sync_row["id"],
                    trigger_config=trigger_config,
                    provider=sync_row.get("provider", ""),
                )

            if scheduled:
                log_info(f"Loaded {len(scheduled)} sync polling jobs")

        except Exception as e:
            log_error(f"Failed to load scheduled syncs: {e}")

    async def add_sync_job(
        self,
        sync_id: str,
        trigger_config: dict,
        provider: str = "",
    ) -> Optional[Job]:
        """Add a sync polling job to the scheduler."""
        if not self.scheduler or not self._started:
            log_warning(f"Scheduler not running, skipping sync job for {sync_id}")
            return None

        job_id = f"sync:{sync_id}"
        self.remove_sync_job(sync_id)

        trigger = self._parse_trigger(trigger_config)
        if not trigger:
            log_warning(f"Invalid trigger config for sync {sync_id}: {trigger_config}")
            return None

        job = self.scheduler.add_job(
            execute_sync_pull,
            trigger=trigger,
            id=job_id,
            name=f"Sync: {provider} ({sync_id[:8]})",
            args=[sync_id],
            replace_existing=True,
        )

        next_run = job.next_run_time.strftime("%Y-%m-%d %H:%M:%S") if job.next_run_time else "N/A"
        log_info(f"Added sync job for {provider} ({sync_id[:8]}), next run: {next_run}")
        return job

    def remove_sync_job(self, sync_id: str) -> bool:
        """Remove a sync job from the scheduler."""
        if not self.scheduler:
            return False
        try:
            self.scheduler.remove_job(f"sync:{sync_id}")
            return True
        except Exception:
            return False

    def remove_agent_job(self, agent_id: str) -> bool:
        """Remove an agent job from the scheduler."""
        if not self.scheduler:
            return False
        
        try:
            self.scheduler.remove_job(agent_id)
            log_info(f"🗑️  Removed job for agent {agent_id}")
            return True
        except Exception:
            # Job doesn't exist, that's fine
            return False
    
    def _parse_trigger(self, config: dict):
        """
        Parse trigger configuration and return APScheduler trigger.
        
        Supports:
        - Cron expression: {"schedule": "0 9 * * *"}
        - Simple time + repeat: {"time": "09:00", "repeat_type": "daily", "date": "2026-01-30"}
        """
        # If explicit cron schedule provided
        if "schedule" in config:
            try:
                return CronTrigger.from_crontab(
                    config["schedule"],
                    timezone=config.get("timezone", scheduler_settings.timezone)
                )
            except Exception as e:
                log_error(f"Invalid cron expression '{config['schedule']}': {e}")
                return None
        
        # Parse simple time/date/repeat format from frontend
        time_str = config.get("time", "09:00")  # HH:MM format
        date_str = config.get("date")  # YYYY-MM-DD format
        repeat_type = config.get("repeat_type", "once")  # once, daily, weekly
        timezone = config.get("timezone", scheduler_settings.timezone)
        
        try:
            hour, minute = map(int, time_str.split(":"))
        except (ValueError, AttributeError):
            hour, minute = 9, 0  # Default to 9:00 AM
        
        if repeat_type == "once":
            # One-time execution
            if date_str:
                try:
                    run_date = datetime.fromisoformat(f"{date_str}T{time_str}:00")
                    return DateTrigger(run_date=run_date, timezone=timezone)
                except Exception as e:
                    log_error(f"Invalid date '{date_str}': {e}")
                    return None
            else:
                log_warning("One-time trigger without date, skipping")
                return None
        
        elif repeat_type == "daily":
            # Every day at specified time
            return CronTrigger(hour=hour, minute=minute, timezone=timezone)
        
        elif repeat_type == "weekly":
            # Every week on the same day
            if date_str:
                try:
                    dt = datetime.fromisoformat(date_str)
                    day_of_week = dt.weekday()  # 0=Monday, 6=Sunday
                    return CronTrigger(
                        day_of_week=day_of_week,
                        hour=hour,
                        minute=minute,
                        timezone=timezone
                    )
                except Exception as e:
                    log_error(f"Invalid date for weekly trigger '{date_str}': {e}")
                    return None
            else:
                # Default to Monday if no date specified
                return CronTrigger(day_of_week=0, hour=hour, minute=minute, timezone=timezone)
        
        else:
            log_warning(f"Unknown repeat_type: {repeat_type}")
            return None
    
    def get_job_info(self, agent_id: str) -> Optional[dict]:
        """Get information about a scheduled job."""
        if not self.scheduler:
            return None
        
        job = self.scheduler.get_job(agent_id)
        if not job:
            return None
        
        return {
            "job_id": job.id,
            "name": job.name,
            "next_run_time": job.next_run_time.isoformat() if job.next_run_time else None,
            "trigger": str(job.trigger),
        }
    
    def list_jobs(self) -> list[dict]:
        """List all scheduled jobs."""
        if not self.scheduler:
            return []
        
        jobs = self.scheduler.get_jobs()
        return [
            {
                "job_id": job.id,
                "name": job.name,
                "next_run_time": job.next_run_time.isoformat() if job.next_run_time else None,
                "trigger": str(job.trigger),
            }
            for job in jobs
        ]


# Global instance getter
def get_scheduler_service() -> SchedulerService:
    """Get the global scheduler service instance."""
    return SchedulerService.get_instance()

