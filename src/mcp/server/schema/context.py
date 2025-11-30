"""
Context Tool相关Schema
"""

from typing import Any
from pydantic import BaseModel

class CreateElementRequest(BaseModel):
    """
    创建Context元素的Payload
    """
    key: str
    content: Any
