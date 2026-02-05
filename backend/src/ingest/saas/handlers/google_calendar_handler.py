"""
Google Calendar Handler - Process Google Calendar event imports.

Architecture:
- All events are stored in a SINGLE content_node as JSONB
- No S3, no separate markdown files
- Agent can query with jq: jq '.events[] | select(.start > "2026-02-01")'
- Uses parallel requests for speed
"""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from src.content_node.service import ContentNodeService
from src.ingest.saas.handlers.base import BaseHandler, ImportResult, PreviewResult, ProgressCallback
from src.ingest.saas.task.models import ImportTask, ImportTaskType
from src.oauth.google_calendar_service import GoogleCalendarOAuthService
from src.s3.service import S3Service
from src.utils.logger import log_info, log_error


class GoogleCalendarHandler(BaseHandler):
    """Handler for Google Calendar imports - stores all events in single JSONB node."""

    CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList"
    CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events"

    def __init__(
        self,
        node_service: ContentNodeService,
        calendar_service: GoogleCalendarOAuthService,
        s3_service: S3Service,
    ):
        self.node_service = node_service
        self.calendar_service = calendar_service
        self.s3_service = s3_service
        self.client = httpx.AsyncClient(timeout=60.0)

    def can_handle(self, task: ImportTask) -> bool:
        return task.task_type == ImportTaskType.GOOGLE_CALENDAR

    async def process(
        self,
        task: ImportTask,
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """Process Google Calendar import - all events stored in single JSONB node."""
        await on_progress(5, "Checking Google Calendar connection...")

        # Get OAuth connection
        connection = await self.calendar_service.refresh_token_if_needed(task.user_id)
        if not connection:
            raise ValueError("Google Calendar not connected. Please authorize first.")

        access_token = connection.access_token
        metadata = connection.metadata or {}
        user_email = metadata.get("user", {}).get("email", "Google Calendar")

        config = task.config or {}
        parent_id = config.get("parent_id")
        
        # Time range for events (default: past 30 days to next 30 days)
        days_past = config.get("days_past", 30)
        days_future = config.get("days_future", 30)
        max_results = config.get("max_results", 100)
        
        time_min = (datetime.now(timezone.utc) - timedelta(days=days_past)).isoformat()
        time_max = (datetime.now(timezone.utc) + timedelta(days=days_future)).isoformat()

        await on_progress(10, f"Fetching calendars for {user_email}...")

        # Get list of calendars
        calendars = await self._list_calendars(access_token)
        
        await on_progress(20, f"Found {len(calendars)} calendars, fetching events in parallel...")

        # Build calendar info
        calendars_info = [
            {
                "id": cal.get("id", ""),
                "name": cal.get("summary", "Unknown"),
                "primary": cal.get("primary", False),
            }
            for cal in calendars
        ]

        # Fetch events from ALL calendars in PARALLEL
        async def fetch_calendar_events(calendar: dict) -> list[dict]:
            """Fetch events for a single calendar."""
            calendar_name = calendar.get("summary", "Unknown")
            calendar_id = calendar.get("id", "")
            try:
                events = await self._list_events(
                    access_token=access_token,
                    calendar_id=calendar_id,
                    time_min=time_min,
                    time_max=time_max,
                    max_results=max_results,
                )
                # Add calendar info to each event
                for event in events:
                    event["calendar_name"] = calendar_name
                    event["calendar_id"] = calendar_id
                return events
            except Exception as e:
                log_error(f"Failed to fetch events from calendar {calendar_name}: {e}")
                return []

        # Execute all calendar fetches in parallel
        results = await asyncio.gather(*[fetch_calendar_events(cal) for cal in calendars])
        
        # Flatten results
        all_events = []
        for events in results:
            all_events.extend(events)

        await on_progress(70, f"Processing {len(all_events)} events...")

        # Format all events for JSONB (this is fast, no need for progress updates)
        events_data = [self._format_event_data(event) for event in all_events]

        await on_progress(90, "Saving to database...")

        # Build JSONB content
        content = {
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "source": "google_calendar",
            "account": user_email,
            "time_range": {
                "from": time_min,
                "to": time_max,
                "days_past": days_past,
                "days_future": days_future,
            },
            "calendar_count": len(calendars_info),
            "calendars": calendars_info,
            "event_count": len(events_data),
            "events": events_data,
        }

        # Create single JSONB node
        node = await self.node_service.create_synced_node(
            user_id=task.user_id,
            project_id=task.project_id,
            name=config.get("name") or f"Google Calendar - {user_email}"[:100],
            sync_type="google_calendar_sync",
            sync_url="oauth://calendar",
            content=content,
            parent_id=parent_id,
            sync_id=user_email,
            sync_config={
                "days_past": days_past,
                "days_future": days_future,
                "max_results": max_results,
            },
        )

        await on_progress(100, "Google Calendar import completed")

        return ImportResult(
            content_node_id=node.id,
            items_count=len(events_data),
        )

    async def _list_calendars(self, access_token: str) -> list[dict]:
        """List user's calendars."""
        response = await self.client.get(
            self.CALENDAR_LIST_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            params={"minAccessRole": "reader"},
        )
        response.raise_for_status()
        return response.json().get("items", [])

    async def _list_events(
        self,
        access_token: str,
        calendar_id: str,
        time_min: str,
        time_max: str,
        max_results: int = 100,
    ) -> list[dict]:
        """List events from a specific calendar."""
        params = {
            "timeMin": time_min,
            "timeMax": time_max,
            "maxResults": min(max_results, 250),
            "singleEvents": "true",
            "orderBy": "startTime",
        }

        response = await self.client.get(
            self.CALENDAR_EVENTS_URL.format(calendar_id=calendar_id),
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
        )
        response.raise_for_status()
        return response.json().get("items", [])

    def _format_event_data(self, event: dict) -> dict:
        """Format event data for JSONB storage."""
        start = event.get("start", {})
        end = event.get("end", {})
        attendees = event.get("attendees", [])
        organizer = event.get("organizer", {})
        
        return {
            "id": event.get("id", ""),
            "summary": event.get("summary", "Untitled Event"),
            "description": event.get("description", ""),
            "location": event.get("location", ""),
            "start": start.get("dateTime") or start.get("date", ""),
            "end": end.get("dateTime") or end.get("date", ""),
            "all_day": "date" in start and "dateTime" not in start,
            "calendar": event.get("calendar_name", ""),
            "calendar_id": event.get("calendar_id", ""),
            "organizer": organizer.get("email", ""),
            "attendees": [a.get("email", "") for a in attendees if a.get("email")][:20],
            "attendee_count": len(attendees),
            "status": event.get("status", ""),
            "html_link": event.get("htmlLink", ""),
            "created": event.get("created", ""),
            "updated": event.get("updated", ""),
        }

    async def preview(self, url: str, user_id: str) -> PreviewResult:
        """Preview Google Calendar contents."""
        connection = await self.calendar_service.refresh_token_if_needed(user_id)
        if not connection:
            raise ValueError("Google Calendar not connected. Please authorize first.")

        access_token = connection.access_token
        
        # Get calendars for preview
        calendars = await self._list_calendars(access_token)
        
        # Get upcoming events from primary calendar
        events = []
        if calendars:
            primary = next((c for c in calendars if c.get("primary")), calendars[0])
            time_min = datetime.now(timezone.utc).isoformat()
            time_max = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
            events = await self._list_events(
                access_token, primary["id"], time_min, time_max, max_results=10
            )

        data = [
            {
                "summary": e.get("summary", "Untitled"),
                "start": e.get("start", {}).get("dateTime") or e.get("start", {}).get("date"),
                "location": e.get("location", ""),
                "link": e.get("htmlLink"),
            }
            for e in events
        ]

        return PreviewResult(
            source_type="google_calendar",
            title="Google Calendar Events",
            description=f"Found {len(calendars)} calendars, {len(events)} upcoming events",
            data=data,
            fields=[
                {"name": "summary", "type": "string"},
                {"name": "start", "type": "datetime"},
                {"name": "location", "type": "string"},
            ],
            total_items=len(events),
            structure_info={"calendars": len(calendars)},
        )

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()
