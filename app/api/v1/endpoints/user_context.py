from fastapi import APIRouter, Depends
from typing import List
from app.service.user_context_service import UserContextService
from app.service.user_service import UserService
from app.core.dependencies import get_user_service, get_user_context_service
from app.schemas.user_context import UserContextCreate, UserContextUpdate, UserContextOut
from app.schemas.response import ApiResponse

router = APIRouter(prefix="/user_contexts", tags=["user_contexts"])

ERROR_CODE = 1001

@router.get("/{user_id}", response_model=ApiResponse[List[UserContextOut]])
def list_user_contexts(user_id: int, user_context_service: UserContextService = Depends(get_user_context_service),user_service: UserService = Depends(get_user_service)):
    # 1. 验证用户是否存在
    user = user_service.get_user(user_id)
    if not user:
        return ApiResponse.error(code=ERROR_CODE, message="用户不存在")
    # 2. 获取用户知识库
    user_contexts = user_context_service.get_by_user_id(user_id)
    return ApiResponse.success(data=user_contexts, message="用户知识库获取成功")

@router.post("/", response_model=ApiResponse[UserContextOut])
def create_user_context(payload: UserContextCreate, user_context_service: UserContextService = Depends(get_user_context_service),user_service: UserService = Depends(get_user_service)):
    # 1. 验证用户是否存在
    user = user_service.get_user(payload.user_id)
    if not user:
        return ApiResponse.error(code=ERROR_CODE, message="用户不存在")
    # 2. 创建用户知识库
    user_context = user_context_service.create(payload.user_id, payload.context_name, payload.context_description, payload.context_data, payload.metadata)
    return ApiResponse.success(data=user_context, message="用户知识库创建成功")

@router.put("/{context_id}", response_model=ApiResponse[UserContextOut])
def update_user_context(context_id: int, payload: UserContextUpdate, user_context_service: UserContextService = Depends(get_user_context_service)):
    user_context = user_context_service.update(context_id, payload.context_name, payload.context_description, payload.context_data, payload.metadata)
    if not user_context:
        return ApiResponse.error(code=ERROR_CODE, message="知识库更新失败")
    return ApiResponse.success(data=user_context, message="用户知识库更新成功")

@router.delete("/{context_id}", response_model=ApiResponse[None])
def delete_user_context(context_id: int, user_context_service: UserContextService = Depends(get_user_context_service)):
    success = user_context_service.delete(context_id)
    if not success:
        return ApiResponse.error(code=ERROR_CODE, message="知识库不存在")
    return ApiResponse.success(message="用户知识库删除成功")