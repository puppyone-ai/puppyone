import json
from app.models.user_context import UserContext
from app.repositories.base import UserContextRepositoryBase
from typing import List, Optional
from pathlib import Path
from app.utils.logger import log_error

DATA_PATH = Path("./data/user_contexts.json")

class UserContextRepositoryJSON(UserContextRepositoryBase):
    """负责对用户知识库数据进行增删改查"""
    
    # 这两个方法进行底层实现
    def _read_data(self) -> List[UserContext]:
        try:
            with open(DATA_PATH, "r", encoding="utf-8") as f:
                contexts = json.load(f)
                return [UserContext(**context) for context in contexts]
        except FileNotFoundError:
            return []
    
    def _write_data(self, contexts: List[UserContext]) -> None:
        try:
            # 确保目录存在
            DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(DATA_PATH, "w", encoding="utf-8") as f:
                json.dump([context.model_dump() for context in contexts], f, ensure_ascii=False, indent=4)
        except Exception as e:
            log_error(f"Failed to write data to {DATA_PATH}: {e}")
    
    # 接口方法
    def get_by_user_id(self, user_id: int) -> List[UserContext]:
        contexts = self._read_data()
        return [context for context in contexts if context.user_id == user_id]
    
    def get_by_id(self, context_id: int) -> Optional[UserContext]:
        contexts = self._read_data()
        for context in contexts:
            if context.context_id == context_id:
                return context
        return None
    
    def update(self, context_id: int, context_name: str, context_description: str, context_data: dict, metadata: dict) -> Optional[UserContext]:
        contexts = self._read_data()
        for context in contexts:
            if context.context_id == context_id:
                context.context_name = context_name
                context.context_description = context_description
                context.context_data = context_data
                context.metadata = metadata
                self._write_data(contexts)
                return context
        return None
    
    def delete(self, context_id: int) -> bool:
        contexts = self._read_data()
        new_contexts = [context for context in contexts if context.context_id != context_id]
        if len(new_contexts) == len(contexts):
            return False
        self._write_data(new_contexts)
        return True
    
    def create(self, user_id: str, context_name: str, context_description: str, context_data: dict, metadata: dict) -> UserContext:
        contexts = self._read_data()
        new_id = max([c.context_id for c in contexts], default=0) + 1
        new_context = UserContext(
            context_id=new_id,
            user_id=int(user_id),
            context_name=context_name,
            context_description=context_description,
            context_data=context_data,
            metadata=metadata
        )
        contexts.append(new_context)
        self._write_data(contexts)
        return new_context