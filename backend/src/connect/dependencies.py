"""
Connect 模块的依赖注入
"""

from typing import Annotated

from fastapi import Depends

from src.connect.service import ConnectService
from src.connect.parser import UrlParser
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user


def get_connect_service(current_user: Annotated[CurrentUser, Depends(get_current_user)]) -> ConnectService:
    """
    获取 Connect 服务实例

    Args:
        current_user: 当前用户信息

    Returns:
        ConnectService 实例，包含用户ID用于OAuth
    """
    parser = UrlParser(user_id=current_user.user_id)
    return ConnectService(parser, user_id=current_user.user_id)

