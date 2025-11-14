# TODO 我的理解是repository层仅仅是一个抽象，但是这里似乎直接在里面实现了CRUD

import json
from app.models.mcp_token import McpToken, TokenStatus
from typing import List, Optional
from pathlib import Path
from app.utils.logger import log_error
from app.repositories.base import McpTokenRepositoryBase

DATA_PATH = Path("./data/mcp_tokens.json")

class McpTokenRepositoryJSON(McpTokenRepositoryBase):
    """负责对 MCP Token 数据进行增删改查"""
    
    # 这两个方法进行底层实现
    def _read_data(self) -> List[McpToken]:
        try:
            with open(DATA_PATH, "r", encoding="utf-8") as f:
                tokens = json.load(f)
                return [McpToken(**token) for token in tokens]
        except FileNotFoundError:
            return []
    
    def _write_data(self, tokens: List[McpToken]) -> None:
        try:
            # 确保目录存在
            DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(DATA_PATH, "w", encoding="utf-8") as f:
                json.dump([token.model_dump() for token in tokens], f, ensure_ascii=False, indent=4)
        except Exception as e:
            log_error(f"Failed to write data to {DATA_PATH}: {e}")
    
    # 接口方法
    def get_all(self) -> List[McpToken]:
        return self._read_data()
    
    def get_by_token(self, token: str) -> Optional[McpToken]:
        tokens = self._read_data()
        for token_obj in tokens:
            if token_obj.token == token:
                return token_obj
        return None
    
    def get_by_user_project_context(self, user_id: int, project_id: int, ctx_id: int) -> List[McpToken]:
        tokens = self._read_data()
        return [
            token_obj for token_obj in tokens
            if token_obj.user_id == user_id 
            and token_obj.project_id == project_id 
            and token_obj.ctx_id == ctx_id
        ]
    
    def create(self, user_id: int, project_id: int, ctx_id: int, token: str, token_status: TokenStatus = "active") -> McpToken:
        tokens = self._read_data()
        new_token = McpToken(
            user_id=user_id,
            project_id=project_id,
            ctx_id=ctx_id,
            token=token,
            token_status=token_status
        )
        tokens.append(new_token)
        self._write_data(tokens)
        return new_token
    
    def update_status(self, token: str, token_status: TokenStatus) -> Optional[McpToken]:
        tokens = self._read_data()
        for token_obj in tokens:
            if token_obj.token == token:
                token_obj.token_status = token_status
                self._write_data(tokens)
                return token_obj
        return None
    
    def delete(self, token: str) -> bool:
        tokens = self._read_data()
        new_tokens = [token_obj for token_obj in tokens if token_obj.token != token]
        if len(new_tokens) == len(tokens):
            return False
        self._write_data(new_tokens)
        return True

