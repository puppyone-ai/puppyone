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
from src.content_node.service import ContentNodeService
from src.content_node.dependencies import get_content_node_service
from src.connect.providers.github_provider import GithubProvider
from src.oauth.github_service import GithubOAuthService
from src.exceptions import NotFoundException, BusinessException, ErrorCode
from src.utils.logger import log_info, log_error

router = APIRouter(
    prefix="/connect",
    tags=["connect"],
    responses={
        400: {"description": "请求参数错误"},
        404: {"description": "资源未找到"},
        500: {"description": "服务器内部错误"},
    },
)


def _is_github_repo_url(url: str) -> bool:
    """判断是否为 GitHub repo URL"""
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.netloc not in ("github.com", "www.github.com"):
        return False
    parts = parsed.path.strip("/").split("/")
    # 只有 owner/repo 格式才是 repo URL（不是 issue/PR 等）
    return len(parts) == 2


def _get_node_type_for_file(filename: str) -> str:
    """根据文件名获取节点类型"""
    ext = filename.split('.')[-1].lower() if '.' in filename else ''
    
    if ext in ('md', 'markdown', 'mdx'):
        return 'markdown'
    elif ext in ('json', 'jsonc'):
        return 'json'
    else:
        # 其他文本文件也存为 markdown（代码高亮）
        return 'markdown'


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
    description="从URL导入数据到指定的项目。GitHub repo 会下载所有文件。",
    response_description="返回导入结果",
    status_code=status.HTTP_201_CREATED,
)
async def import_data(
    payload: ImportDataRequest,
    connect_service: ConnectService = Depends(get_connect_service),
    node_service: ContentNodeService = Depends(get_content_node_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    导入数据到项目

    - GitHub repo: 下载 ZIP，解压，每个文件存 S3，创建文件树
    - 其他类型: 创建 JSON 节点
    """
    log_info(
        f"User {current_user.user_id} importing data from {payload.url} "
        f"to project {payload.project_id}"
    )

    url_str = str(payload.url)
    
    # === GitHub Repo 特殊处理：下载完整文件 ===
    if _is_github_repo_url(url_str):
        return await _import_github_repo(
            url=url_str,
            project_id=payload.project_id,
            table_name=payload.table_name,
            user_id=current_user.user_id,
            node_service=node_service,
        )

    # === 其他类型：使用原有逻辑 ===
    full_data_result = await connect_service.fetch_full_data(url_str)
    data = full_data_result.get("data", [])
    title = full_data_result.get("title", "Imported Data")
    source_type = full_data_result.get("source_type", "generic")

    if not data:
        raise BusinessException(
            message="No data found to import", code=ErrorCode.BAD_REQUEST
        )

    node_name = payload.table_name or title or "Imported Data"
    content_data = {"imported_data": data} if isinstance(data, list) else data
    items_imported = len(data) if isinstance(data, list) else 1

    # 判断是否为 SaaS 同步类型
    is_sync_type = "_" in source_type and source_type != "generic"
    
    if is_sync_type:
        new_node = await node_service.create_synced_node(
            user_id=current_user.user_id,
            project_id=payload.project_id,
            name=node_name,
            sync_type=source_type,
            sync_url=url_str,
            content=content_data,
            parent_id=None,
            )
        message = f"Successfully imported {source_type}: {new_node.name}"
    else:
        new_node = node_service.create_json_node(
            user_id=current_user.user_id,
            project_id=payload.project_id,
            name=node_name,
            content=content_data,
            parent_id=None,
        )
        message = f"Successfully created node {new_node.name} and imported {items_imported} items"

    return ApiResponse.success(
        data=ImportDataResponse(
            success=True,
            project_id=payload.project_id,
            table_id=new_node.id,
            table_name=new_node.name,
            items_imported=items_imported,
            message=message,
        ),
        message="Data imported successfully",
    )


async def _import_github_repo(
    url: str,
    project_id: str,
    table_name: str | None,
    user_id: str,
    node_service: ContentNodeService,
) -> ApiResponse:
    """
    导入 GitHub repo：
    1. 下载 ZIP
    2. 解压获取所有文件
    3. 创建 github_repo 类型的根文件夹
    4. 为每个文件/文件夹创建子节点，内容存 S3
    """
    from datetime import datetime
    
    # 1. 下载 repo 文件
    github_service = GithubOAuthService()
    github_provider = GithubProvider(user_id=user_id, github_service=github_service)
    
    log_info(f"Downloading GitHub repo files from: {url}")
    repo_data = await github_provider.fetch_repo_files(url)
    
    repo_name = table_name or repo_data["repo_name"]
    files = repo_data["files"]
    
    log_info(f"Downloaded {len(files)} files from {repo_data['full_name']}")

    # 2. 创建根节点（github_repo 类型）
    root_node = await node_service.create_synced_node(
        user_id=user_id,
        project_id=project_id,
        name=repo_name,
        sync_type="github_repo",
        sync_url=url,
        content={
            "repo_name": repo_data["repo_name"],
            "owner": repo_data["owner"],
            "full_name": repo_data["full_name"],
            "description": repo_data.get("description"),
            "default_branch": repo_data["default_branch"],
            "html_url": repo_data.get("html_url"),
            "file_count": len(files),
            "synced_at": datetime.utcnow().isoformat(),
        },
        parent_id=None,
    )
    
    log_info(f"Created root node: {root_node.id} ({root_node.name})")

    # 3. 创建文件夹结构和文件节点
    # 首先收集所有需要创建的文件夹
    folders_to_create: dict[str, str | None] = {}  # path -> parent_path (None for root level)
    
    for file_info in files:
        path = file_info["path"]
        parts = path.split("/")
        
        # 创建中间文件夹
        for i in range(len(parts) - 1):
            folder_path = "/".join(parts[:i+1])
            if folder_path not in folders_to_create:
                parent_path = "/".join(parts[:i]) if i > 0 else None
                folders_to_create[folder_path] = parent_path

    # 按层级顺序创建文件夹
    folder_id_map: dict[str, str] = {}  # path -> node_id
    
    sorted_folders = sorted(folders_to_create.keys(), key=lambda x: x.count("/"))
    for folder_path in sorted_folders:
        parent_path = folders_to_create[folder_path]
        parent_id = folder_id_map.get(parent_path, root_node.id) if parent_path else root_node.id
        folder_name = folder_path.split("/")[-1]
        
        folder_node = node_service.create_folder(
            user_id=user_id,
            project_id=project_id,
            name=folder_name,
            parent_id=parent_id,
        )
        folder_id_map[folder_path] = folder_node.id

    # 4. 创建文件节点（内容存 S3）
    files_created = 0
    for file_info in files:
        path = file_info["path"]
        parts = path.split("/")
        file_name = parts[-1]
        
        # 确定父节点
        if len(parts) > 1:
            parent_path = "/".join(parts[:-1])
            parent_id = folder_id_map.get(parent_path, root_node.id)
        else:
            parent_id = root_node.id
        
        # 确定节点类型
        node_type = _get_node_type_for_file(file_name)
        content = file_info["content"]
        
        try:
            if node_type == "markdown":
                # Markdown 文件存 S3
                await node_service.create_markdown_node(
                    user_id=user_id,
                    project_id=project_id,
                    name=file_name,
                    content=content,
                    parent_id=parent_id,
                )
            elif node_type == "json":
                # JSON 文件解析后存储
                import json
                try:
                    json_content = json.loads(content)
                except json.JSONDecodeError:
                    json_content = {"raw": content}
                
                node_service.create_json_node(
                    user_id=user_id,
                    project_id=project_id,
                    name=file_name,
                    content=json_content,
                    parent_id=parent_id,
                )
            
            files_created += 1
        except Exception as e:
            log_error(f"Failed to create node for {path}: {e}")
            continue

    log_info(f"Created {files_created} file nodes for repo {repo_name}")

    return ApiResponse.success(
        data=ImportDataResponse(
            success=True,
            project_id=project_id,
            table_id=root_node.id,
            table_name=root_node.name,
            items_imported=files_created,
            message=f"Successfully imported GitHub repo {repo_data['full_name']}: {files_created} files",
        ),
        message="GitHub repo imported successfully",
    )
