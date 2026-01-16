from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class SandboxActionRequest(BaseModel):
    action: Literal["start", "exec", "read", "stop", "status"] = Field(
        ..., description="沙盒动作类型"
    )
    session_id: str = Field(..., min_length=1, description="沙盒会话 ID")
    data: Optional[Any] = Field(
        None, description="start 动作写入的数据"
    )
    readonly: Optional[bool] = Field(
        False, description="start 动作是否只读"
    )
    command: Optional[str] = Field(
        None, description="exec 动作执行的命令"
    )
