"""
Scheduler configuration settings.
"""

import os
from dataclasses import dataclass


@dataclass
class SchedulerSettings:
    """Configuration for the APScheduler service."""
    
    # Whether the scheduler is enabled (for multi-instance deployments)
    enabled: bool = os.getenv("SCHEDULER_ENABLED", "true").lower() == "true"
    
    # Maximum concurrent job executions
    max_workers: int = int(os.getenv("SCHEDULER_MAX_WORKERS", "10"))
    
    # Default timezone for cron jobs
    timezone: str = os.getenv("SCHEDULER_TIMEZONE", "UTC")
    
    # Misfire grace time in seconds (job will still run if missed within this window)
    misfire_grace_time: int = int(os.getenv("SCHEDULER_MISFIRE_GRACE_TIME", "60"))
    
    # Coalesce missed jobs into a single execution
    coalesce: bool = os.getenv("SCHEDULER_COALESCE", "true").lower() == "true"


scheduler_settings = SchedulerSettings()



