from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class EntitlementSnapshot(BaseModel):
    org_id: str
    plan_id: str = "free"
    status: str = "free"
    source: str = "local"
    entitlements: dict[str, Any] = Field(default_factory=dict)
    current_period_end: datetime | None = None
    effective_until: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class EntitlementUpsert(BaseModel):
    org_id: str
    plan_id: str = "free"
    status: str = "active"
    source: str = "puppypay"
    entitlements: dict[str, Any] = Field(default_factory=dict)
    current_period_end: datetime | None = None
    effective_until: datetime | None = None
    source_event_id: str | None = None
    event_type: str | None = None
