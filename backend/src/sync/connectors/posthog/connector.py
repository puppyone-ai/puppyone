"""
PostHog Connector — pulls event data and insights from the PostHog API.

Auth: Personal API key (project-scoped).
API docs: https://posthog.com/docs/api
"""

import hashlib
import json

import httpx

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


class PosthogConnector(BaseConnector):

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="posthog",
            display_name="PostHog",
            capabilities=Capability.PULL | Capability.INCREMENTAL,
            supported_directions=["inbound"],
            default_trigger=TriggerMode.POLL,
            default_node_type="json",
            auth=AuthRequirement.API_KEY,
            supported_sync_modes=("manual", "scheduled"),
            default_sync_mode="manual",
            config_fields=(
                ConfigField(
                    key="api_key",
                    label="Personal API Key",
                    required=True,
                    placeholder="phx_...",
                ),
                ConfigField(
                    key="project_id",
                    label="PostHog Project ID",
                    required=True,
                    placeholder="12345",
                ),
                ConfigField(
                    key="host",
                    label="PostHog Host",
                    default="https://app.posthog.com",
                    placeholder="https://app.posthog.com",
                ),
                ConfigField(
                    key="mode",
                    label="Data to sync",
                    type="select",
                    default="events",
                    options=[
                        {"value": "events", "label": "Recent Events"},
                        {"value": "persons", "label": "Persons"},
                        {"value": "insights", "label": "Saved Insights"},
                    ],
                ),
                ConfigField(
                    key="limit",
                    label="Max records",
                    type="number",
                    default=100,
                ),
            ),
            icon="🦔",
        )

    async def fetch(self, config: dict, credentials: Credentials) -> FetchResult:
        api_key = config.get("api_key", "")
        project_id = config.get("project_id", "")
        host = config.get("host", "https://app.posthog.com").rstrip("/")
        mode = config.get("mode", "events")
        limit = min(int(config.get("limit", 100)), 1000)

        if not api_key or not project_id:
            raise ValueError("api_key and project_id are required")

        headers = {"Authorization": f"Bearer {api_key}"}
        base = f"{host}/api/projects/{project_id}"

        async with httpx.AsyncClient(timeout=30, headers=headers) as client:
            if mode == "events":
                resp = await client.get(f"{base}/events/", params={"limit": limit})
                resp.raise_for_status()
                data = resp.json()
                results = data.get("results", [])
                records = [{
                    "id": e.get("id"),
                    "event": e.get("event"),
                    "distinct_id": e.get("distinct_id"),
                    "timestamp": e.get("timestamp"),
                    "properties": e.get("properties", {}),
                } for e in results[:limit]]
                label = "Events"

            elif mode == "persons":
                resp = await client.get(f"{base}/persons/", params={"limit": limit})
                resp.raise_for_status()
                data = resp.json()
                results = data.get("results", [])
                records = [{
                    "id": p.get("id"),
                    "distinct_ids": p.get("distinct_ids", []),
                    "properties": p.get("properties", {}),
                    "created_at": p.get("created_at"),
                } for p in results[:limit]]
                label = "Persons"

            elif mode == "insights":
                resp = await client.get(f"{base}/insights/", params={"limit": limit})
                resp.raise_for_status()
                data = resp.json()
                results = data.get("results", [])
                records = [{
                    "id": ins.get("id"),
                    "name": ins.get("name"),
                    "description": ins.get("description"),
                    "filters": ins.get("filters", {}),
                    "last_modified_at": ins.get("last_modified_at"),
                } for ins in results[:limit]]
                label = "Insights"

            else:
                raise ValueError(f"Unknown mode: {mode}")

        content_hash = hashlib.sha256(
            json.dumps(records, sort_keys=True, default=str).encode()
        ).hexdigest()[:16]

        return FetchResult(
            content=records,
            content_hash=content_hash,
            node_type="json",
            node_name=f"PostHog {label}",
            summary=f"Fetched {len(records)} {label.lower()} from PostHog",
        )
