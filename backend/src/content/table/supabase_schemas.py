"""
Table Data Models

Defines Pydantic models corresponding to the table table, used for type checking and data validation.
"""

from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, ConfigDict


class TableBase(BaseModel):
    """Table base model"""

    name: Optional[str] = None
    project_id: Optional[str] = None
    created_by: Optional[str] = None  # Creator user ID, supports standalone Table
    description: Optional[str] = None
    data: Optional[Any] = None  # Supports any JSON type (Dict, List, str, int, etc.)


class TableCreate(TableBase):
    """Table creation model"""

    id: Optional[str] = None


class TableUpdate(BaseModel):
    """Table update model"""

    name: Optional[str] = None
    project_id: Optional[str] = None
    description: Optional[str] = None
    data: Optional[Any] = None  # Supports any JSON type (Dict, List, str, int, etc.)


class TableResponse(TableBase):
    """Table response model"""

    id: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
