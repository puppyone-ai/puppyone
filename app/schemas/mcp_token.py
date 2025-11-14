from pydantic import BaseModel

class McpTokenPayload(BaseModel):
    user_id: int
    project_id: int
    ctx_id: int