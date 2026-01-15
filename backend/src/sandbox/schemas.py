from typing import Literal, Optional, Any
from pydantic import BaseModel


class SandboxRequest(BaseModel):
    action: Literal["start", "exec", "read", "stop", "status"]
    session_id: str
    command: Optional[str] = None
    data: Optional[Any] = None
    readonly: Optional[bool] = None


class SandboxResponse(BaseModel):
    success: bool
    output: Optional[str] = None
    error: Optional[str] = None
    data: Optional[Any] = None
