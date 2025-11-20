from fastapi import APIRouter, Depends
from typing import List
from app.service.user_service import UserService
from app.core.dependencies import get_user_service
from app.schemas.user import UserCreate, UserUpdate, UserOut
from app.schemas.response import ApiResponse
router = APIRouter(prefix="/users", tags=["users"])

ERROR_CODE = 1001

@router.get("/", response_model=ApiResponse[List[UserOut]])
def list_users(user_service: UserService = Depends(get_user_service)):
    users = user_service.list_users()
    return ApiResponse.success(data=users)

@router.get("/{user_id}", response_model=ApiResponse[UserOut])
def get_user(user_id: str, user_service: UserService = Depends(get_user_service)):
    user = user_service.get_user(user_id)
    if not user:
        return ApiResponse.error(code=ERROR_CODE, message="用户不存在")
    return ApiResponse.success(data=user)

@router.post("/", response_model=ApiResponse[UserOut])
def create_user(payload: UserCreate, user_service: UserService = Depends(get_user_service)):
    user = user_service.create_user(payload.username)
    return ApiResponse.success(data=user, message="用户创建成功")

@router.put("/{user_id}", response_model=ApiResponse[UserOut])
def update_user(user_id: str, payload: UserUpdate, user_service: UserService = Depends(get_user_service)):
    user = user_service.update_user(user_id, payload.username)
    if not user:
        return ApiResponse.error(code=ERROR_CODE, message="用户不存在")
    return ApiResponse.success(data=user, message="用户更新成功")

@router.delete("/{user_id}", response_model=ApiResponse[None])
def delete_user(user_id: str, user_service: UserService = Depends(get_user_service)):
    success = user_service.delete_user(user_id)
    if not success:
        return ApiResponse.error(code=ERROR_CODE, message="用户不存在")
    return ApiResponse.success(message="用户删除成功")