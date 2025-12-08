from fastapi import APIRouter, Depends
from typing import List
from src.auth.service import UserService
from src.auth.dependencies import get_user_service
from src.auth.schemas import UserCreate, UserUpdate, UserOut
from src.common_schemas import ApiResponse

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/", response_model=ApiResponse[List[UserOut]])
def list_users(user_service: UserService = Depends(get_user_service)):
    users = user_service.list_users()
    return ApiResponse.success(data=users)


@router.get("/{user_id}", response_model=ApiResponse[UserOut])
def get_user(user_id: int, user_service: UserService = Depends(get_user_service)):
    user = user_service.get_user(user_id)
    return ApiResponse.success(data=user)


@router.post("/", response_model=ApiResponse[UserOut])
def create_user(
    payload: UserCreate, user_service: UserService = Depends(get_user_service)
):
    user = user_service.create_user(payload.username)
    return ApiResponse.success(data=user, message="用户创建成功")


@router.put("/{user_id}", response_model=ApiResponse[UserOut])
def update_user(
    user_id: int,
    payload: UserUpdate,
    user_service: UserService = Depends(get_user_service),
):
    user = user_service.update_user(user_id, payload.username)
    return ApiResponse.success(data=user, message="用户更新成功")


@router.delete("/{user_id}", response_model=ApiResponse[None])
def delete_user(user_id: int, user_service: UserService = Depends(get_user_service)):
    user_service.delete_user(user_id)
    return ApiResponse.success(message="用户删除成功")
