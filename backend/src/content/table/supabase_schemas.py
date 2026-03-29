"""
Table Data Models

Defines Pydantic models corresponding to the table table, used for type checking and data validation.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class TableBase(BaseModel):
    """Table base model"""

    name: str | None = None
    project_id: str | None = None
    created_by: str | None = None  # Creator user ID, supports standalone Table
    description: str | None = None
    data: Any | None = None  # Supports any JSON type (Dict, List, str, int, etc.)


class TableCreate(TableBase):
    """Table creation model"""

    id: str | None = None


class TableUpdate(BaseModel):
    """Table update model"""

    name: str | None = None
    project_id: str | None = None
    description: str | None = None
    data: Any | None = None  # Supports any JSON type (Dict, List, str, int, etc.)


class TableResponse(TableBase):
    """Table response model"""

    id: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
