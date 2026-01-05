"""
ETL Runtime State Models

Redis runtime state is the source of truth for in-flight ETL tasks.
"""

from __future__ import annotations

from datetime import datetime, UTC
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field

from src.etl.tasks.models import ETLTaskStatus


class ETLPhase(str, Enum):
    OCR = "ocr"
    POSTPROCESS = "postprocess"
    FINALIZE = "finalize"


class ETLRuntimeState(BaseModel):
    """Runtime state stored in Redis."""

    task_id: int

    # Identifiers needed for access-check without DB round-trip
    user_id: str
    project_id: int
    filename: str
    rule_id: int

    status: ETLTaskStatus = Field(default=ETLTaskStatus.PENDING)
    phase: ETLPhase = Field(default=ETLPhase.OCR)
    progress: int = Field(default=0, ge=0, le=100)

    attempt_ocr: int = 0
    attempt_postprocess: int = 0

    arq_job_id_ocr: Optional[str] = None
    arq_job_id_postprocess: Optional[str] = None

    artifact_mineru_markdown_key: Optional[str] = None
    provider_task_id: Optional[str] = None  # e.g. mineru_task_id

    error_code: Optional[str] = None
    error_message: Optional[str] = None
    error_stage: Optional[str] = None  # "mineru" | "postprocess"

    metadata: dict[str, Any] = Field(default_factory=dict)

    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    def touch(self) -> None:
        self.updated_at = datetime.now(UTC)
