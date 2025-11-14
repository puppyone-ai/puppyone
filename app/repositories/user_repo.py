# TODO 我的理解是repository层仅仅是一个抽象，但是这里似乎直接在里面实现了CRUD

import json
from app.models.user import User
from typing import List, Optional
from pathlib import Path
from app.utils.logger import log_error
from app.repositories.base import UserRepositoryBase
DATA_PATH = Path("./data/userdata.json")

class UserRepositoryJSON(UserRepositoryBase):
    """负责对用户数据进行增删改查"""
    
    # 这两个方法进行底层实现
    def _read_data(self) -> List[User]:
        try:
            with open(DATA_PATH, "r", encoding="utf-8") as f:
                users = json.load(f)
                return [User(**user) for user in users]
        except FileNotFoundError:
            return []
    
    def _write_data(self, users: List[User]) -> None:
        try:
            with open(DATA_PATH, "w", encoding="utf-8") as f:
                json.dump([user.model_dump() for user in users], f, ensure_ascii=False, indent=4)
        except Exception as e:
            log_error(f"Failed to write data to {DATA_PATH}: {e}")
    
    # 接口方法
    def get_all(self) -> List[User]:
        return self._read_data()
    
    def get_by_id(self, user_id: int) -> Optional[User]:
        users = self._read_data()
        for user in users:
            if user.user_id == user_id:
                return user
        return None
    
    def create(self, username: str) -> User:
        users = self._read_data()
        new_id = max([u.user_id for u in users], default=0) + 1
        new_user = User(user_id=new_id, username=username)
        users.append(new_user)
        self._write_data(users)
        return new_user
    
    def update(self, user_id: int, username: str) -> User:
        users = self._read_data()
        for user in users:
            if user.user_id == user_id:
                user.username = username
                self._write_data(users)
                return user
        return None
    
    def delete(self, user_id: int) -> bool:
        users = self._read_data()
        new_users = [user for user in users if user.user_id != user_id]
        if len(new_users) == len(users):
            return False
        self._write_data(new_users)
        return True
    
    