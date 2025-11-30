from abc import ABC, abstractmethod
from typing import List, Optional
import json
from pathlib import Path

from src.user_context.models import UserContext
from src.utils.logger import log_error


DATA_PATH = Path("./data/user_contexts.json")


class UserContextRepositoryBase(ABC):
    """抽象用户知识库仓库接口"""

    @abstractmethod
    def get_by_user_id(self, user_id: str) -> List[UserContext]:
        pass

    @abstractmethod
    def get_by_id(self, context_id: str) -> Optional[UserContext]:
        pass

    @abstractmethod
    def update(self, context_id: str, context_name: str, context_description: str, context_data: Optional[dict], metadata: dict) -> Optional[UserContext]:
        pass

    @abstractmethod
    def delete(self, context_id: str) -> bool:
        pass

    @abstractmethod
    def create(self, user_id: str, project_id: str, context_name: str, context_description: str, context_data: dict, metadata: dict) -> UserContext:
        pass

    @abstractmethod
    def update_context_data(self, context_id: str, context_data: dict) -> Optional[UserContext]:
        """更新 context_data 字段"""
        pass


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
    def get_by_user_id(self, user_id: str) -> List[UserContext]:
        contexts = self._read_data()
        return [context for context in contexts if context.user_id == user_id]
    
    def get_by_id(self, context_id: str) -> Optional[UserContext]:
        contexts = self._read_data()
        for context in contexts:
            if context.context_id == context_id:
                return context
        return None
    
    def update(self, context_id: str, context_name: str, context_description: str, context_data: Optional[dict], metadata: dict) -> Optional[UserContext]:
        contexts = self._read_data()
        for context in contexts:
            if context.context_id == context_id:
                context.context_name = context_name
                context.context_description = context_description
                # 如果 context_data 不为 None，才更新 context_data
                if context_data is not None:
                    context.context_data = context_data
                context.metadata = metadata
                self._write_data(contexts)
                return context
        return None
    
    def delete(self, context_id: str) -> bool:
        contexts = self._read_data()
        new_contexts = [context for context in contexts if context.context_id != context_id]
        if len(new_contexts) == len(contexts):
            return False
        self._write_data(new_contexts)
        return True
    
    def create(self, user_id: str, project_id: str, context_name: str, context_description: str, context_data: dict, metadata: dict) -> UserContext:
        contexts = self._read_data()
        # 生成新的 ID，使用字符串格式
        # 兼容历史数据：支持 int 和 str 类型的 context_id
        existing_ids = []
        for c in contexts:
            if isinstance(c.context_id, int):
                existing_ids.append(c.context_id)
            elif isinstance(c.context_id, str) and c.context_id.isdigit():
                existing_ids.append(int(c.context_id))
        new_id = str(max(existing_ids, default=0) + 1) if existing_ids else "1"
        new_context = UserContext(
            context_id=new_id,
            user_id=user_id,
            project_id=project_id,
            context_name=context_name,
            context_description=context_description,
            context_data=context_data,
            metadata=metadata
        )
        contexts.append(new_context)
        self._write_data(contexts)
        return new_context
    
    def update_context_data(self, context_id: str, context_data: dict) -> Optional[UserContext]:
        """更新 context_data 字段"""
        contexts = self._read_data()
        for context in contexts:
            if context.context_id == context_id:
                context.context_data = context_data
                self._write_data(contexts)
                return context
        return None
