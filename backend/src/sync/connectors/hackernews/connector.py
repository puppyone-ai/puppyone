"""
Hacker News Connector — pulls top/new/best stories from the HN Firebase API.

No auth required. Uses the public https://hacker-news.firebaseio.com/v0/ API.
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

HN_API = "https://hacker-news.firebaseio.com/v0"


class HackerNewsConnector(BaseConnector):

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="hackernews",
            display_name="Hacker News",
            capabilities=Capability.PULL | Capability.INCREMENTAL,
            supported_directions=["inbound"],
            default_trigger=TriggerMode.POLL,
            default_node_type="json",
            auth=AuthRequirement.NONE,
            supported_sync_modes=("manual", "scheduled"),
            default_sync_mode="scheduled",
            config_fields=(
                ConfigField(
                    key="feed_type",
                    label="Feed type",
                    type="select",
                    default="topstories",
                    options=[
                        {"value": "topstories", "label": "Top Stories"},
                        {"value": "newstories", "label": "New Stories"},
                        {"value": "beststories", "label": "Best Stories"},
                        {"value": "askstories", "label": "Ask HN"},
                        {"value": "showstories", "label": "Show HN"},
                    ],
                ),
                ConfigField(
                    key="limit",
                    label="Max stories",
                    type="number",
                    default=30,
                ),
            ),
            icon="🟠",
        )

    async def fetch(self, config: dict, credentials: Credentials) -> FetchResult:
        feed_type = config.get("feed_type", "topstories")
        limit = min(int(config.get("limit", 30)), 100)

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{HN_API}/{feed_type}.json")
            resp.raise_for_status()
            story_ids: list[int] = resp.json()[:limit]

            stories = []
            for sid in story_ids:
                item_resp = await client.get(f"{HN_API}/item/{sid}.json")
                if item_resp.status_code == 200 and item_resp.json():
                    item = item_resp.json()
                    stories.append({
                        "id": item.get("id"),
                        "title": item.get("title", ""),
                        "url": item.get("url", ""),
                        "score": item.get("score", 0),
                        "by": item.get("by", ""),
                        "time": item.get("time"),
                        "descendants": item.get("descendants", 0),
                        "type": item.get("type", "story"),
                    })

        content_hash = hashlib.sha256(
            json.dumps([s["id"] for s in stories], sort_keys=True).encode()
        ).hexdigest()[:16]

        return FetchResult(
            content=stories,
            content_hash=content_hash,
            node_type="json",
            node_name=f"HN {feed_type.replace('stories', '').title() or 'Top'} Stories",
            summary=f"Fetched {len(stories)} stories from /{feed_type}",
        )
