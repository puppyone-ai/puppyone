"""
Connect Router
提供数据导入的 REST API 接口
"""

from fastapi import APIRouter, Depends, status
from src.connect.dependencies import get_connect_service
from src.connect.service import ConnectService
from src.connect.schemas import (
    ParseUrlRequest,
    ParseUrlResponse,
    ImportDataRequest,
    ImportDataResponse,
)
from src.common_schemas import ApiResponse
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user
from src.table.service import TableService
from src.table.dependencies import get_table_service
from src.exceptions import NotFoundException, BusinessException, ErrorCode
from src.utils.logger import log_info

router = APIRouter(
    prefix="/connect",
    tags=["connect"],
    responses={
        400: {"description": "请求参数错误"},
        404: {"description": "资源未找到"},
        500: {"description": "服务器内部错误"},
    },
)


@router.post(
    "/parse",
    response_model=ApiResponse[ParseUrlResponse],
    summary="解析URL",
    description="解析给定的URL，返回数据预览和结构信息。支持JSON、HTML表格、列表等多种格式。",
    response_description="返回解析后的数据预览",
    status_code=status.HTTP_200_OK,
)
async def parse_url(
    payload: ParseUrlRequest,
    connect_service: ConnectService = Depends(get_connect_service),
):
    """
    解析URL并返回数据预览

    - 支持JSON格式
    - 支持HTML表格
    - 支持HTML列表
    - 自动识别数据源类型（GitHub、Notion等）
    - 支持OAuth认证的SaaS平台
    - 支持Firecrawl多页面爬取（通过crawl_options）
    """
    log_info(f"User parsing URL: {payload.url}")
    
    # Convert crawl_options to dict if provided
    crawl_options_dict = None
    if payload.crawl_options:
        crawl_options_dict = payload.crawl_options.model_dump(by_alias=True, exclude_none=True)
        log_info(f"Crawl options provided: {crawl_options_dict}")

    result = await connect_service.parse_url(str(payload.url), crawl_options_dict)
    return ApiResponse.success(data=result, message="URL parsed successfully")


@router.post(
    "/import",
    response_model=ApiResponse[ImportDataResponse],
    summary="导入数据",
    description="从URL导入数据到指定的项目和表格。如果未指定表格ID，将创建新表格。",
    response_description="返回导入结果",
    status_code=status.HTTP_201_CREATED,
)
async def import_data(
    payload: ImportDataRequest,
    connect_service: ConnectService = Depends(get_connect_service),
    table_service: TableService = Depends(get_table_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    导入数据到表格

    - 如果提供table_id，将数据追加到现有表格
    - 如果未提供table_id，将创建新表格
    - 数据将保持原始平台的结构
    """
    log_info(
        f"User {current_user.user_id} importing data from {payload.url} "
        f"to project {payload.project_id}"
    )

    # 验证项目是否属于当前用户
    if not table_service.verify_project_access(
        payload.project_id, current_user.user_id
    ):
        raise NotFoundException(
            f"Project not found: {payload.project_id}", code=ErrorCode.NOT_FOUND
        )

    # 获取完整数据
    full_data_result = await connect_service.fetch_full_data(str(payload.url))
    data = full_data_result.get("data", [])
    title = full_data_result.get("title", "Imported Data")

    if not data:
        raise BusinessException(
            message="No data found to import", code=ErrorCode.BAD_REQUEST
        )

    # 如果提供了table_id，追加数据到现有表格或指定路径
    if payload.table_id:
        table = table_service.get_by_id(payload.table_id)
        if not table:
            raise NotFoundException(
                f"Table not found: {payload.table_id}", code=ErrorCode.NOT_FOUND
            )

        # 验证表格是否属于指定项目
        if table.project_id != payload.project_id:
            raise BusinessException(
                message="Table does not belong to the specified project",
                code=ErrorCode.BAD_REQUEST,
            )

        existing_data = table.data or {}

        # 优先使用新的foolproof导入模式
        if payload.import_mode in ["add_to_existing", "replace_all", "keep_separate"]:
            log_info(f"Using foolproof import mode: {payload.import_mode}")

            # 使用傻瓜式导入 - 100%成功
            updated_data = connect_service.foolproof_import(
                existing_data, data, payload.import_mode
            )

            items_imported = len(data) if isinstance(data, list) else 1

            # 更新表格
            updated_table = table_service.update(
                table_id=payload.table_id,
                name=None,
                description=None,
                data=updated_data,
            )

            mode_messages = {
                "add_to_existing": f"Added {items_imported} items to existing data",
                "replace_all": f"Replaced all data with {items_imported} new items",
                "keep_separate": f"Stored {items_imported} items in imports section",
            }

            return ApiResponse.success(
                data=ImportDataResponse(
                    success=True,
                    project_id=payload.project_id,
                    table_id=payload.table_id,
                    table_name=updated_table.name,
                    items_imported=items_imported,
                    message=mode_messages.get(
                        payload.import_mode, f"Imported {items_imported} items"
                    ),
                ),
                message="Data imported successfully",
            )

        # 兼容旧的路径级导入（如果指定了target_path）
        if payload.target_path is not None:
            log_info(
                f"Using legacy path import: {payload.target_path} with strategy: {payload.merge_strategy}"
            )

            # 使用智能合并逻辑
            updated_data = connect_service.merge_data_at_path(
                existing_data, data, payload.target_path, payload.merge_strategy
            )

            items_imported = len(data) if isinstance(data, list) else 1
            path_display = payload.target_path or "/"

            # 更新表格
            updated_table = table_service.update(
                table_id=payload.table_id,
                name=None,
                description=None,
                data=updated_data,
            )

            return ApiResponse.success(
                data=ImportDataResponse(
                    success=True,
                    project_id=payload.project_id,
                    table_id=payload.table_id,
                    table_name=updated_table.name,
                    items_imported=items_imported,
                    message=f"Imported {items_imported} items to path {path_display}",
                ),
                message="Data imported successfully",
            )

        # 否则追加数据到表格（原有逻辑）
        # 如果现有数据是字典，将新数据作为一个新key添加
        if isinstance(existing_data, dict):
            # 生成唯一的key
            import_key = f"import_{len([k for k in existing_data.keys() if k.startswith('import_')]) + 1}"
            existing_data[import_key] = data
            updated_data = existing_data
        # 如果现有数据是列表，直接扩展
        elif isinstance(existing_data, list):
            if isinstance(data, list):
                updated_data = existing_data + data
            else:
                updated_data = existing_data + [data]
        else:
            # 其他情况，创建新结构
            updated_data = {"existing": existing_data, "imported": data}

        # 更新表格
        updated_table = table_service.update(
            table_id=payload.table_id, name=None, description=None, data=updated_data
        )

        items_imported = len(data) if isinstance(data, list) else 1

        return ApiResponse.success(
            data=ImportDataResponse(
                success=True,
                project_id=payload.project_id,
                table_id=payload.table_id,
                table_name=updated_table.name,
                items_imported=items_imported,
                message=f"Successfully imported {items_imported} items to table {updated_table.name}",
            ),
            message="Data imported successfully",
        )

    # 否则创建新表格
    else:
        table_name = payload.table_name or title or "Imported Data"
        table_description = payload.table_description or f"Imported from {payload.url}"

        # 创建新表格
        new_table = table_service.create(
            project_id=payload.project_id,
            name=table_name,
            description=table_description,
            data={"imported_data": data} if isinstance(data, list) else data,
        )

        items_imported = len(data) if isinstance(data, list) else 1

        return ApiResponse.success(
            data=ImportDataResponse(
                success=True,
                project_id=payload.project_id,
                table_id=new_table.id,
                table_name=new_table.name,
                items_imported=items_imported,
                message=f"Successfully created table {new_table.name} and imported {items_imported} items",
            ),
            message="Data imported successfully",
        )
