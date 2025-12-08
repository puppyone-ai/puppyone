from pydantic import BaseModel


class User(BaseModel):
    user_id: int
    username: str
