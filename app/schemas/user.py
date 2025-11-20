from pydantic import BaseModel

class UserCreate(BaseModel):
    username: str

class UserUpdate(BaseModel):
    username: str

class UserOut(BaseModel):
    user_id: str
    username: str
