from __future__ import annotations

from datetime import datetime
from typing import Any, Optional, Literal

from pydantic import BaseModel, Field


ToolCategory = Literal["builtin", "custom"]


class Tool(BaseModel):
    id: str
    created_at: datetime

    created_by: Optional[str] = None
    org_id: str
    project_id: Optional[str] = None  # Associated project ID (for filtering by project)
    path: Optional[str] = None  # MUT path
    json_path: str = ""  # JSON internal path (e.g. /users/0)

    type: str  # Tool type: search, query_data, create, update, delete, custom_script, etc. (note: shell_access moved to agent_bash)
    name: str
    alias: Optional[str] = None
    description: Optional[str] = None

    input_schema: Optional[Any] = Field(default=None, description="JSON Schema (input)")
    output_schema: Optional[Any] = Field(
        default=None, description="JSON Schema (output)"
    )
    metadata: Optional[Any] = Field(default=None, description="Extension config (multi-node bindings for custom tools stored here)")

    # Additional fields
    category: ToolCategory = "builtin"  # Tool category: builtin or custom
    script_type: Optional[str] = None  # Script type: python, javascript, shell (only for custom category)
    script_content: Optional[str] = None  # Script code content (only for custom category)
