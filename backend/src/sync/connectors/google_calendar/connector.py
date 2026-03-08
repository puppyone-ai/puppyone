"""
Google Calendar Connector - Process Google Calendar event imports.

Architecture:
- All events are stored in a SINGLE content_node as JSONB
- No S3, no separate markdown files
- Agent can query with jq: jq '.events[] | select(.start > "2026-02-01")'
- Uses parallel requests for speed
"""

import asyncio
import hashlib
import json
from datetime import datetime, timedelta, timezone

import httpx

from src.content_node.service import ContentNodeService
from src.sync.connectors._base import (
    BaseConnector,
    ConnectorSpec,
    Capability,
    AuthRequirement,
    TriggerMode,
    FetchResult,
    Credentials,
    ConfigField,
)
from src.oauth.google_calendar_service import GoogleCalendarOAuthService
from src.s3.service import S3Service
from src.utils.logger import log_error


class GoogleCalendarConnector(BaseConnector):
    """Connector for Google Calendar imports - stores all events in single JSONB node."""

    CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList"
    CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events"

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="google_calendar",
            display_name="Google Calendar",
            capabilities=Capability.PULL,
            supported_directions=["inbound"],
            default_trigger=TriggerMode.POLL,
            default_node_type="json",
            auth=AuthRequirement.OAUTH,
            oauth_type="calendar",
            supported_sync_modes=("import_once", "manual", "scheduled"),
            default_sync_mode="import_once",
            config_fields=(
                ConfigField(key="days_past", label="Days of past events", type="number", default=30),
                ConfigField(key="days_future", label="Days of future events", type="number", default=30),
                ConfigField(key="max_results", label="Max events per calendar", type="number", default=100),
            ),
        )

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

    async def fetch(self, config: dict, credentials: Credentials) -> FetchResult:
        """Fetch Google Calendar events using the unified fetch interface."""
        user_email = credentials.metadata.get("user", {}).get("email", "Google Calendar")
        access_token = credentials.access_token

        days_past = config.get("days_past", 30)
        days_future = config.get("days_future", 30)
        max_results = config.get("max_results", 100)

        time_min = (datetime.now(timezone.utc) - timedelta(days=days_past)).isoformat()
        time_max = (datetime.now(timezone.utc) + timedelta(days=days_future)).isoformat()

        calendars = await self._list_calendars(access_token)

        calendars_info = [
            {
                "id": cal.get("id", ""),
                "name": cal.get("summary", "Unknown"),
                "primary": cal.get("primary", False),
            }
            for cal in calendars
        ]

        async def fetch_calendar_events(calendar: dict) -> list[dict]:
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
                for event in events:
                    event["calendar_name"] = calendar_name
                    event["calendar_id"] = calendar_id
                return events
            except Exception as e:
                log_error(f"[Calendar fetch] Failed to fetch events from {calendar_name}: {e}")
                return []

        results = await asyncio.gather(*[fetch_calendar_events(cal) for cal in calendars])

        all_events = []
        for events in results:
            all_events.extend(events)

        events_data = [self._format_event_data(event) for event in all_events]

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

        content_hash = hashlib.sha256(
            json.dumps(content, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()[:16]

        return FetchResult(
            content=content,
            content_hash=content_hash,
            node_type="json",
            node_name=config.get("name") or f"Google Calendar - {user_email}"[:100],
            summary=f"Fetched {len(events_data)} events from {len(calendars_info)} calendars",
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

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()
