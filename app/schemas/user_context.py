from pydantic import BaseModel

class UserContextCreate(BaseModel):
    user_id: int
    context_name: str
    context_description: str
    context_data: dict
    metadata: dict

class UserContextUpdate(BaseModel):
    context_name: str
    context_description: str
    context_data: dict
    metadata: dict

class UserContextOut(BaseModel):
    context_id: int
    context_name: str
    context_description: str
    context_data: dict
    metadata: dict