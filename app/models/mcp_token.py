from pydantic import BaseModel
from typing import Literal

TokenStatus = Literal["active", "expired", "revoked"]

class McpToken(BaseModel):
    user_id: int
    project_id: int
    ctx_id: int
    token: str
    token_status: TokenStatus

