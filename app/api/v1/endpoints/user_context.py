from fastapi import APIRouter, Depends, Query, status
from typing import List, Optional
from app.service.user_context_service import UserContextService
from app.service.user_service import UserService
from app.core.dependencies import get_user_service, get_user_context_service
from app.schemas.user_context import (
    UserContextCreate, UserContextUpdate, UserContextOut,
    ContextDataCreate, ContextDataUpdate, ContextDataDelete, ContextDataGet
)
from app.schemas.response import ApiResponse

router = APIRouter(
    prefix="/user_contexts",
    tags=["用户知识库管理"],
    responses={
        404: {"description": "资源未找到"},
        500: {"description": "服务器内部错误"}
    }
)

ERROR_CODE = 1001

@router.get(
    "/{user_id}",
    response_model=ApiResponse[List[UserContextOut]],
    summary="获取用户的所有知识库",
    description="根据用户ID获取该用户下的所有知识库（Context）列表。需要先验证用户是否存在。⚠️后续可能要修改这块的Api，改成Token鉴权",
    response_description="返回用户的所有知识库列表",
    status_code=status.HTTP_200_OK
)
def list_user_contexts(user_id: str, user_context_service: UserContextService = Depends(get_user_context_service),user_service: UserService = Depends(get_user_service)):
    # 1. 验证用户是否存在
    user = user_service.get_user(user_id)
    if not user:
        return ApiResponse.error(code=ERROR_CODE, message="用户不存在")
    # 2. 获取用户知识库
    user_contexts = user_context_service.get_by_user_id(user_id)
    return ApiResponse.success(data=user_contexts, message="用户知识库获取成功")

@router.post(
    "/",
    response_model=ApiResponse[UserContextOut],
    summary="创建新的知识库",
    description="为用户创建一个新的知识库（Context）。需要提供用户ID、项目ID、知识库名称、描述、初始数据和元数据。创建前会验证用户是否存在。⚠️后续可能要修改这块的Api，改成Token鉴权",
    response_description="返回创建成功的知识库信息",
    status_code=status.HTTP_201_CREATED
)
def create_user_context(payload: UserContextCreate, user_context_service: UserContextService = Depends(get_user_context_service),user_service: UserService = Depends(get_user_service)):
    # 1. 验证用户是否存在
    user = user_service.get_user(payload.user_id)
    if not user:
        return ApiResponse.error(code=ERROR_CODE, message="用户不存在")
    # 2. 创建用户知识库
    user_context = user_context_service.create(payload.user_id, payload.project_id, payload.context_name, payload.context_description, payload.context_data, payload.metadata)
    return ApiResponse.success(data=user_context, message="用户知识库创建成功")

@router.put(
    "/{context_id}",
    response_model=ApiResponse[UserContextOut],
    summary="更新知识库信息",
    description="根据知识库ID更新知识库的名称、描述、数据和元数据。如果知识库不存在，将返回错误。⚠️后续可能要修改这块的Api，改成Token鉴权，目前暂时无需传入user_id。",
    response_description="返回更新后的知识库信息",
    status_code=status.HTTP_200_OK
)
def update_user_context(context_id: str, payload: UserContextUpdate, user_context_service: UserContextService = Depends(get_user_context_service)):
    # 如果 context_data 为空（None 或空字典），则不更新 context_data
    context_data = payload.context_data if payload.context_data is not None and payload.context_data != {} else None
    user_context = user_context_service.update(context_id, payload.context_name, payload.context_description, context_data, payload.metadata)
    if not user_context:
        return ApiResponse.error(code=ERROR_CODE, message="知识库更新失败")
    return ApiResponse.success(data=user_context, message="用户知识库更新成功")

@router.delete(
    "/{context_id}",
    response_model=ApiResponse[None],
    summary="删除知识库",
    description="根据知识库ID删除指定的知识库。如果知识库不存在，将返回错误。⚠️后续可能要修改这块的Api，改成Token鉴权，目前暂时无需传入user_id。",
    response_description="删除成功，返回空数据",
    status_code=status.HTTP_200_OK
)
def delete_user_context(context_id: str, user_context_service: UserContextService = Depends(get_user_context_service)):
    success = user_context_service.delete(context_id)
    if not success:
        return ApiResponse.error(code=ERROR_CODE, message="知识库不存在")
    return ApiResponse.success(message="用户知识库删除成功")

# Context Data 相关的接口
@router.post(
    "/{context_id}/data",
    response_model=ApiResponse[ContextDataGet],
    summary="在知识库中创建数据",
    description="在指定知识库的 context_data 中，通过 JSON 指针路径创建新的数据项。可以一次创建多个元素，每个元素包含 key 和 content。⚠️后续可能要修改这块的Api，改成Token鉴权，目前暂时无需传入user_id。\n\n**JSON指针路径说明：**\n- 使用 RFC 6901 标准格式，例如：\"/users\"、\"/users/123\"\n- **根路径：使用空字符串 \"\" 可以在 context_data 的根路径下添加 key**\n- 路径必须指向一个已存在的字典类型节点\n\n**示例：**\n- 在根路径添加 key：`mounted_json_pointer_path: \"\"`\n- 在 /users 路径下添加 key：`mounted_json_pointer_path: \"/users\"`",
    response_description="返回创建后的数据",
    status_code=status.HTTP_201_CREATED
)
def create_context_data(
    context_id: str,
    payload: ContextDataCreate,
    user_context_service: UserContextService = Depends(get_user_context_service)
):
    """
    在 context_data 的指定路径下创建新数据
    
    - **context_id**: 知识库ID
    - **mounted_json_pointer_path**: JSON指针路径，数据将挂载到此路径下
        - 使用 RFC 6901 标准格式（例如："/users"、"/users/123"）
        - **根路径：使用空字符串 "" 可以在 context_data 的根路径下添加 key**
        - 路径必须指向一个已存在的字典类型节点
    - **elements**: 要创建的元素数组，每个元素包含：
        - **key**: 数据项的键名
        - **content**: 数据项的内容，可以是任意JSON可序列化的类型（dict、list、str、int、float、bool等）
    """
    success, error_message, data = user_context_service.create_context_data(
        context_id=context_id,
        mounted_json_pointer_path=payload.mounted_json_pointer_path,
        elements=[{"key": e.key, "content": e.content} for e in payload.elements]
    )
    if not success:
        return ApiResponse.error(code=ERROR_CODE, message=error_message or "创建失败")
    return ApiResponse.success(data=ContextDataGet(data=data), message="数据创建成功")

@router.get(
    "/{context_id}/data",
    response_model=ApiResponse[ContextDataGet],
    summary="获取知识库中的数据",
    description="根据知识库ID和JSON指针路径，获取知识库中指定路径的数据。JSON指针路径使用RFC 6901标准格式（例如：\"/users/123\"）。⚠️后续可能要修改这块的Api，改成Token鉴权，目前暂时无需传入user_id。\n\n**JSON指针路径说明：**\n- 使用 RFC 6901 标准格式，例如：\"/users\"、\"/users/123\"\n- **根路径：使用空字符串 \"\" 可以获取整个 context_data**\n\n**示例：**\n- 获取根路径数据：`json_pointer_path=\"\"`\n- 获取 /users 路径数据：`json_pointer_path=\"/users\"`",
    response_description="返回指定路径的数据",
    status_code=status.HTTP_200_OK
)
def get_context_data(
    context_id: str,
    json_pointer_path: Optional[str] = Query(default="", description="JSON指针路径，使用RFC 6901标准格式。例如：/users 或 /users/123。根路径使用空字符串 \"\" 可以获取整个 context_data。如果不传此参数，默认为空字符串（根路径）", min_length=0, examples=["", "/users", "/users/123"]),
    user_context_service: UserContextService = Depends(get_user_context_service)
):
    """
    获取 context_data 中指定路径的数据
    
    - **context_id**: 知识库ID
    - **json_pointer_path**: JSON指针路径（查询参数），使用RFC 6901标准格式
        - 例如："/users"、"/users/123"
        - **根路径：使用空字符串 "" 或不传此参数可以获取整个 context_data**
        - 如果不传此参数，默认为空字符串（根路径）
    """
    # 如果未传入参数或为 None，使用空字符串（根路径）
    if json_pointer_path is None:
        json_pointer_path = ""
    
    success, error_message, data = user_context_service.get_context_data(
        context_id=context_id,
        json_pointer_path=json_pointer_path
    )
    if not success:
        return ApiResponse.error(code=ERROR_CODE, message=error_message or "获取失败")
    return ApiResponse.success(data=ContextDataGet(data=data), message="数据获取成功")

@router.put(
    "/{context_id}/data",
    response_model=ApiResponse[ContextDataGet],
    summary="更新知识库中的数据",
    description="在指定知识库的 context_data 中，通过 JSON 指针路径更新已存在的数据项。只能更新已存在的 key，不能创建新的 key。⚠️后续可能要修改这块的Api，改成Token鉴权，目前暂时无需传入user_id。\n\n**JSON指针路径说明：**\n- 使用 RFC 6901 标准格式，例如：\"/users\"、\"/users/123\"\n- **根路径：使用空字符串 \"\" 可以在 context_data 的根路径下更新 key**\n- 路径必须指向一个已存在的字典类型节点\n\n**示例：**\n- 在根路径更新 key：`json_pointer_path: \"\"`\n- 在 /users 路径下更新 key：`json_pointer_path: \"/users\"`",
    response_description="返回更新后的数据",
    status_code=status.HTTP_200_OK
)
def update_context_data(
    context_id: str,
    payload: ContextDataUpdate,
    user_context_service: UserContextService = Depends(get_user_context_service)
):
    """
    更新 context_data 中指定路径的数据
    
    - **context_id**: 知识库ID
    - **json_pointer_path**: JSON指针路径
        - 使用 RFC 6901 标准格式（例如："/users"、"/users/123"）
        - **根路径：使用空字符串 "" 可以在 context_data 的根路径下更新 key**
        - 路径必须指向一个已存在的字典类型节点
    - **elements**: 要更新的元素数组，每个元素包含：
        - **key**: 要更新的数据项的键名（必须已存在）
        - **content**: 新的数据内容，可以是任意JSON可序列化的类型
    """
    success, error_message, data = user_context_service.update_context_data(
        context_id=context_id,
        json_pointer_path=payload.json_pointer_path,
        elements=[{"key": e.key, "content": e.content} for e in payload.elements]
    )
    if not success:
        return ApiResponse.error(code=ERROR_CODE, message=error_message or "更新失败")
    return ApiResponse.success(data=ContextDataGet(data=data), message="数据更新成功")

@router.delete(
    "/{context_id}/data",
    response_model=ApiResponse[ContextDataGet],
    summary="删除知识库中的数据",
    description="在指定知识库的 context_data 中，通过 JSON 指针路径删除指定路径下的一个或多个 key。只能删除已存在的 key。⚠️后续可能要修改这块的Api，改成Token鉴权，目前暂时无需传入user_id。\n\n**JSON指针路径说明：**\n- 使用 RFC 6901 标准格式，例如：\"/users\"、\"/users/123\"\n- **根路径：使用空字符串 \"\" 可以在 context_data 的根路径下删除 key**\n- 路径必须指向一个已存在的字典类型节点\n\n**示例：**\n- 在根路径删除 key：`json_pointer_path: \"\"`\n- 在 /users 路径下删除 key：`json_pointer_path: \"/users\"`",
    response_description="返回删除后的数据",
    status_code=status.HTTP_200_OK
)
def delete_context_data(
    context_id: str,
    payload: ContextDataDelete,
    user_context_service: UserContextService = Depends(get_user_context_service)
):
    """
    删除 context_data 中指定路径下的 keys
    
    - **context_id**: 知识库ID
    - **json_pointer_path**: JSON指针路径
        - 使用 RFC 6901 标准格式（例如："/users"、"/users/123"）
        - **根路径：使用空字符串 "" 可以在 context_data 的根路径下删除 key**
        - 路径必须指向一个已存在的字典类型节点
    - **keys**: 要删除的键名列表（必须已存在）
    """
    success, error_message, data = user_context_service.delete_context_data(
        context_id=context_id,
        json_pointer_path=payload.json_pointer_path,
        keys=payload.keys
    )
    if not success:
        return ApiResponse.error(code=ERROR_CODE, message=error_message or "删除失败")
    return ApiResponse.success(data=ContextDataGet(data=data), message="数据删除成功")