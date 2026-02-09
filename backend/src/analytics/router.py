"""
Analytics API - Access Monitoring for Context Layer

Provides time-series data for monitoring data egress (context → sandbox).
Data source: access_logs table (records each time a node is sent to sandbox).
"""

from fastapi import APIRouter, Depends, Query
from typing import Optional, List
from datetime import datetime, timedelta
from pydantic import BaseModel

from src.auth.dependencies import get_current_user_optional
from src.supabase import get_supabase_client

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


class TimeSeriesBucket(BaseModel):
    bucket: str
    count: int


class TimeSeriesResponse(BaseModel):
    data: List[TimeSeriesBucket]
    interval: str
    range_hours: int
    total: int


@router.get("/access-timeseries", response_model=TimeSeriesResponse)
async def get_access_timeseries(
    interval: str = Query("hour", description="'hour' or 'day'"),
    range_hours: int = Query(168, description="Hours back (default 7 days)"),
    agent_id: Optional[str] = Query(None),
    node_id: Optional[str] = Query(None),
    current_user=Depends(get_current_user_optional),
):
    """
    Time-series of context access events.
    
    Each data point = number of times context was sent to sandbox in that time bucket.
    This is the TRUE measure of data egress.
    """
    supabase = get_supabase_client()
    
    now = datetime.utcnow()
    start_time = now - timedelta(hours=range_hours)
    
    # Query access_logs
    query = supabase.table("access_logs") \
        .select("id, created_at, agent_id, node_id") \
        .gte("created_at", start_time.isoformat()) \
        .order("created_at", desc=False)
    
    if agent_id:
        query = query.eq("agent_id", agent_id)
    if node_id:
        query = query.eq("node_id", node_id)
    
    result = query.execute()
    logs = result.data or []
    
    # Aggregate by hour/day
    bucket_counts: dict[str, int] = {}
    bucket_hours = 24 if interval == "day" else 1
    
    for log in logs:
        created_at = log.get("created_at")
        if created_at:
            dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            if interval == "day":
                bucket_key = dt.strftime("%Y-%m-%dT00:00:00Z")
            else:
                bucket_key = dt.strftime("%Y-%m-%dT%H:00:00Z")
            bucket_counts[bucket_key] = bucket_counts.get(bucket_key, 0) + 1
    
    # Generate all buckets (including empty ones)
    all_buckets: List[TimeSeriesBucket] = []
    current = start_time.replace(minute=0, second=0, microsecond=0)
    if interval == "day":
        current = current.replace(hour=0)
    
    bucket_format = "%Y-%m-%dT00:00:00Z" if interval == "day" else "%Y-%m-%dT%H:00:00Z"
    
    while current <= now:
        bucket_key = current.strftime(bucket_format)
        all_buckets.append(TimeSeriesBucket(
            bucket=bucket_key,
            count=bucket_counts.get(bucket_key, 0)
        ))
        current += timedelta(hours=bucket_hours)
    
    return TimeSeriesResponse(
        data=all_buckets,
        interval=interval,
        range_hours=range_hours,
        total=len(logs)
    )


@router.get("/access-summary")
async def get_access_summary(
    range_hours: int = Query(24),
    current_user=Depends(get_current_user_optional),
):
    """
    Summary stats for access monitoring.
    """
    supabase = get_supabase_client()
    start_time = datetime.utcnow() - timedelta(hours=range_hours)
    
    result = supabase.table("access_logs") \
        .select("agent_id, node_id") \
        .gte("created_at", start_time.isoformat()) \
        .execute()
    
    logs = result.data or []
    
    unique_agents = len(set(log["agent_id"] for log in logs if log.get("agent_id")))
    unique_nodes = len(set(log["node_id"] for log in logs if log.get("node_id")))
    
    return {
        "total_accesses": len(logs),
        "unique_agents": unique_agents,
        "unique_nodes": unique_nodes,
        "range_hours": range_hours,
    }
