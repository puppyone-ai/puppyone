from pydantic import BaseModel

class UserContext(BaseModel):
    context_id: int
    user_id: int
    context_name: str
    context_description: str
    context_data: dict
    metadata: dict