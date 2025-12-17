"""
Table Tool相关Schema
"""

from typing import Any
from pydantic import BaseModel


class CreateElementRequest(BaseModel):
    """
    创建Table元素的Payload
    """

    key: str
    content: Any
