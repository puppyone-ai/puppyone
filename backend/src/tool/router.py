"""
Tool 管理 API

对 public.tool 提供 CRUD。
"""

from __future__ import annotations

import asyncio
import datetime as dt

from fastapi import APIRouter, BackgroundTasks, Depends, Query, status
from typing import List

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.common_schemas import ApiResponse
from src.config import settings
from src.s3.service import S3Service
from src.search.dependencies import get_search_service
from src.search.index_task import SearchIndexTaskOut, SearchIndexTaskUpsert
from src.search.index_task_repository import SearchIndexTaskRepository
from src.search.service import SearchService
from src.supabase.client import SupabaseClient
from src.content_node.dependencies import get_content_node_service
from src.content_node.service import ContentNodeService
from src.tool.dependencies import get_tool_service
from src.tool.schemas import ToolCreate, ToolOut, ToolUpdate
from src.tool.service import ToolService
from src.utils.logger import log_error, log_info


router = APIRouter(prefix="/tools", tags=["tools"])


@router.get(
    "/",
    response_model=ApiResponse[List[ToolOut]],
    summary="获取当前用户的 Tool 列表",
    status_code=status.HTTP_200_OK,
)
def list_tools(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    tool_service: ToolService = Depends(get_tool_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    tools = tool_service.list_user_tools(current_user.user_id, skip=skip, limit=limit)
    return ApiResponse.success(data=tools, message="获取 Tool 列表成功")


@router.get(
    "/by-node/{node_id}",
    response_model=ApiResponse[List[ToolOut]],
    summary="获取某个 node_id 下的 Tool 列表",
    status_code=status.HTTP_200_OK,
)
def list_tools_by_node_id(
    node_id: str,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=1000, ge=1, le=1000),
    tool_service: ToolService = Depends(get_tool_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    tools = tool_service.list_user_tools_by_node_id(
        current_user.user_id,
        node_id=node_id,
        skip=skip,
        limit=limit,
    )
    return ApiResponse.success(data=tools, message="获取 Tool 列表成功")


@router.get(
    "/by-project/{project_id}",
    response_model=ApiResponse[List[ToolOut]],
    summary="获取某个 project_id 下的 Tool 列表（聚合所有节点）",
    status_code=status.HTTP_200_OK,
)
def list_tools_by_project_id(
    project_id: str,
    tool_service: ToolService = Depends(get_tool_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    tools = tool_service.list_user_tools_by_project_id(
        current_user.user_id, project_id=project_id
    )
    return ApiResponse.success(data=tools, message="获取 Tool 列表成功")


@router.post(
    "/",
    response_model=ApiResponse[ToolOut],
    summary="创建 Tool",
    description=(
        "创建一个 Tool。\n\n"
        "说明：Search Tool 的索引构建已迁移到独立异步接口（见 `/tools/search`）。\n"
    ),
    status_code=status.HTTP_201_CREATED,
)
def create_tool(
    payload: ToolCreate,
    tool_service: ToolService = Depends(get_tool_service),
    node_service: ContentNodeService = Depends(get_content_node_service),
    search_service: SearchService = Depends(get_search_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    metadata = (
        payload.metadata if isinstance(payload.metadata, dict) else payload.metadata
    )
    tool = tool_service.create(
        user_id=current_user.user_id,
        node_id=payload.node_id,
        json_path=payload.json_path,
        type=payload.type,
        name=payload.name,
        alias=payload.alias,
        description=payload.description,
        input_schema=payload.input_schema,
        output_schema=payload.output_schema,
        metadata=metadata,
        category=payload.category,
        script_type=payload.script_type,
        script_content=payload.script_content,
    )

    return ApiResponse.success(data=tool, message="创建 Tool 成功")


async def _run_search_indexing_background(
    *,
    repo: SearchIndexTaskRepository,
    search_service: SearchService,
    tool_id: str,
    user_id: str,
    project_id: str,
    node_id: str,
    json_path: str,
) -> None:
    """
    后台 indexing 执行器：负责写入 search_index_task 状态，并记录日志（不抛出到请求方）。
    """
    now = dt.datetime.now(tz=dt.timezone.utc)
    log_info(
        f"[search_index] background task accepted: tool_id={tool_id} project_id={project_id} node_id={node_id} json_path='{json_path}'"
    )
    try:
        await asyncio.to_thread(
            repo.upsert,
            SearchIndexTaskUpsert(
                tool_id=tool_id,
                user_id=user_id,
                project_id=project_id,
                node_id=node_id,
                json_path=json_path or "",
                status="indexing",
                started_at=now,
                finished_at=None,
                nodes_count=None,
                chunks_count=None,
                indexed_chunks_count=None,
                last_error=None,
            ),
        )
    except Exception as e:
        # best-effort：不阻断 indexing，但要留日志
        log_error(
            f"[search_index] failed to mark indexing: tool_id={tool_id} node_id={node_id} json_path='{json_path}' err={e}"
        )

    try:
        log_info(
            f"[search_index] start: tool_id={tool_id} project_id={project_id} node_id={node_id} json_path='{json_path}'"
        )
        stats = await asyncio.wait_for(
            search_service.index_scope(
                project_id=project_id,
                node_id=node_id,
                user_id=user_id,
                json_path=json_path or "",
            ),
            timeout=float(settings.SEARCH_INDEX_TIMEOUT_SECONDS),
        )
        finished = dt.datetime.now(tz=dt.timezone.utc)
        await asyncio.to_thread(
            repo.upsert,
            SearchIndexTaskUpsert(
                tool_id=tool_id,
                user_id=user_id,
                project_id=project_id,
                node_id=node_id,
                json_path=json_path or "",
                status="ready",
                started_at=now,
                finished_at=finished,
                nodes_count=int(stats.nodes_count),
                chunks_count=int(stats.chunks_count),
                indexed_chunks_count=int(stats.indexed_chunks_count),
                last_error=None,
            ),
        )
        log_info(
            f"[search_index] done: tool_id={tool_id} nodes={stats.nodes_count} chunks={stats.chunks_count}"
        )
    except asyncio.TimeoutError:
        finished = dt.datetime.now(tz=dt.timezone.utc)
        msg = f"index_scope timeout after {settings.SEARCH_INDEX_TIMEOUT_SECONDS}s"
        try:
            await asyncio.to_thread(
                repo.upsert,
                SearchIndexTaskUpsert(
                    tool_id=tool_id,
                    user_id=user_id,
                    project_id=project_id,
                    node_id=node_id,
                    json_path=json_path or "",
                    status="error",
                    started_at=now,
                    finished_at=finished,
                    last_error=msg,
                ),
            )
        except Exception as e:
            log_error(
                f"[search_index] failed to write timeout status: tool_id={tool_id} err={e}"
            )
        log_error(
            f"[search_index] timeout: tool_id={tool_id} project_id={project_id} node_id={node_id} json_path='{json_path}'"
        )
    except Exception as e:
        finished = dt.datetime.now(tz=dt.timezone.utc)
        err = str(e)[:500]
        try:
            await asyncio.to_thread(
                repo.upsert,
                SearchIndexTaskUpsert(
                    tool_id=tool_id,
                    user_id=user_id,
                    project_id=project_id,
                    node_id=node_id,
                    json_path=json_path or "",
                    status="error",
                    started_at=now,
                    finished_at=finished,
                    last_error=err,
                ),
            )
        except Exception as e2:
            log_error(
                f"[search_index] failed to write error status: tool_id={tool_id} err={e2}"
            )
        log_error(
            f"[search_index] failed: tool_id={tool_id} project_id={project_id} node_id={node_id} json_path='{json_path}' err={e}"
        )


async def _run_folder_search_indexing_background(
    *,
    repo: SearchIndexTaskRepository,
    search_service: SearchService,
    s3_service: S3Service,
    tool_id: str,
    user_id: str,
    project_id: str,
    folder_node_id: str,
) -> None:
    """
    Background indexing executor for folder search.
    """
    now = dt.datetime.now(tz=dt.timezone.utc)
    log_info(
        f"[folder_search_index] background task accepted: tool_id={tool_id} "
        f"project_id={project_id} folder_node_id={folder_node_id}"
    )

    # Mark as indexing
    try:
        await asyncio.to_thread(
            repo.upsert,
            SearchIndexTaskUpsert(
                tool_id=tool_id,
                user_id=user_id,
                project_id=project_id,
                node_id=folder_node_id,
                json_path="",
                status="indexing",
                started_at=now,
                finished_at=None,
                folder_node_id=folder_node_id,
                total_files=None,
                indexed_files=0,
                last_error=None,
            ),
        )
    except Exception as e:
        log_error(
            f"[folder_search_index] failed to mark indexing: tool_id={tool_id} err={e}"
        )

    # Progress callback to update task status
    def update_progress(indexed_files: int, total_files: int) -> None:
        try:
            repo.upsert(
                SearchIndexTaskUpsert(
                    tool_id=tool_id,
                    user_id=user_id,
                    project_id=project_id,
                    node_id=folder_node_id,
                    json_path="",
                    status="indexing",
                    started_at=now,
                    folder_node_id=folder_node_id,
                    total_files=total_files,
                    indexed_files=indexed_files,
                )
            )
        except Exception as e:
            log_error(f"[folder_search_index] progress update error: {e}")

    try:
        log_info(
            f"[folder_search_index] start: tool_id={tool_id} folder_node_id={folder_node_id}"
        )
        stats = await asyncio.wait_for(
            search_service.index_folder(
                project_id=project_id,
                folder_node_id=folder_node_id,
                user_id=user_id,
                s3_service=s3_service,
                progress_callback=update_progress,
            ),
            timeout=float(settings.SEARCH_INDEX_TIMEOUT_SECONDS),
        )
        finished = dt.datetime.now(tz=dt.timezone.utc)
        await asyncio.to_thread(
            repo.upsert,
            SearchIndexTaskUpsert(
                tool_id=tool_id,
                user_id=user_id,
                project_id=project_id,
                node_id=folder_node_id,
                json_path="",
                status="ready",
                started_at=now,
                finished_at=finished,
                nodes_count=int(stats.nodes_count),
                chunks_count=int(stats.chunks_count),
                indexed_chunks_count=int(stats.indexed_chunks_count),
                folder_node_id=folder_node_id,
                total_files=int(stats.total_files),
                indexed_files=int(stats.indexed_files),
                last_error=None,
            ),
        )
        log_info(
            f"[folder_search_index] done: tool_id={tool_id} files={stats.indexed_files}/{stats.total_files} "
            f"chunks={stats.chunks_count}"
        )
    except asyncio.TimeoutError:
        finished = dt.datetime.now(tz=dt.timezone.utc)
        msg = f"index_folder timeout after {settings.SEARCH_INDEX_TIMEOUT_SECONDS}s"
        try:
            await asyncio.to_thread(
                repo.upsert,
                SearchIndexTaskUpsert(
                    tool_id=tool_id,
                    user_id=user_id,
                    project_id=project_id,
                    node_id=folder_node_id,
                    json_path="",
                    status="error",
                    started_at=now,
                    finished_at=finished,
                    folder_node_id=folder_node_id,
                    last_error=msg,
                ),
            )
        except Exception as e:
            log_error(
                f"[folder_search_index] failed to write timeout status: tool_id={tool_id} err={e}"
            )
        log_error(
            f"[folder_search_index] timeout: tool_id={tool_id} folder_node_id={folder_node_id}"
        )
    except Exception as e:
        finished = dt.datetime.now(tz=dt.timezone.utc)
        err = str(e)[:500]
        try:
            await asyncio.to_thread(
                repo.upsert,
                SearchIndexTaskUpsert(
                    tool_id=tool_id,
                    user_id=user_id,
                    project_id=project_id,
                    node_id=folder_node_id,
                    json_path="",
                    status="error",
                    started_at=now,
                    finished_at=finished,
                    folder_node_id=folder_node_id,
                    last_error=err,
                ),
            )
        except Exception as e2:
            log_error(
                f"[folder_search_index] failed to write error status: tool_id={tool_id} err={e2}"
            )
        log_error(
            f"[folder_search_index] failed: tool_id={tool_id} folder_node_id={folder_node_id} err={e}"
        )


@router.post(
    "/search",
    response_model=ApiResponse[ToolOut],
    summary="创建 Search Tool（异步 indexing）",
    description=(
        "创建 `type=search` 的 Tool，并在响应返回后异步触发 indexing（chunking + embedding + upsert）。\n\n"
        "支持两种模式：\n"
        "- **JSON Search**: node_id 指向 json 类型节点，索引该节点的 JSON 内容\n"
        "- **Folder Search**: node_id 指向 folder 类型节点，索引 folder 下所有 json/markdown 文件\n\n"
        "索引状态通过 `/tools/{tool_id}/search-index` 轮询获取。"
    ),
    status_code=status.HTTP_201_CREATED,
)
def create_search_tool_async(
    payload: ToolCreate,
    background_tasks: BackgroundTasks,
    tool_service: ToolService = Depends(get_tool_service),
    node_service: ContentNodeService = Depends(get_content_node_service),
    search_service: SearchService = Depends(get_search_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    if (payload.type or "").strip() != "search":
        # 这里不复用 AppException，避免引入新的错误类型；保持简单
        return ApiResponse.error(message="payload.type must be 'search'")

    if not payload.node_id:
        return ApiResponse.error(message="node_id is required for search tool")

    # 获取节点信息，判断是 folder search 还是 json search
    node = node_service.get_by_id(payload.node_id, current_user.user_id)
    project_id = node.project_id
    is_folder_search = node.type == "folder"

    tool = tool_service.create(
        user_id=current_user.user_id,
        node_id=payload.node_id,
        json_path=payload.json_path,
        type=payload.type,
        name=payload.name,
        alias=payload.alias,
        description=payload.description,
        input_schema=payload.input_schema,
        output_schema=payload.output_schema,
        metadata=payload.metadata,
        category=payload.category,
        script_type=payload.script_type,
        script_content=payload.script_content,
    )

    sb_client = SupabaseClient().get_client()
    repo = SearchIndexTaskRepository(sb_client)

    if is_folder_search:
        # Folder Search: index all files in the folder
        log_info(
            f"[search_index] folder search mode: tool_id={tool.id} folder_node_id={payload.node_id}"
        )
        
        # 先写入一条 pending（便于轮询端立刻拿到状态）
        try:
            repo.upsert(
                SearchIndexTaskUpsert(
                    tool_id=str(tool.id),
                    user_id=str(current_user.user_id),
                    project_id=project_id,
                    node_id=str(payload.node_id),
                    json_path="",
                    status="pending",
                    started_at=None,
                    finished_at=None,
                    folder_node_id=str(payload.node_id),
                    total_files=None,
                    indexed_files=0,
                    last_error=None,
                )
            )
        except Exception as e:
            log_error(
                f"[search_index] failed to create folder task row: tool_id={tool.id} "
                f"folder_node_id={payload.node_id} err={e}"
            )

        # Create S3 service for reading markdown files
        s3_service = S3Service()

        background_tasks.add_task(
            _run_folder_search_indexing_background,
            repo=repo,
            search_service=search_service,
            s3_service=s3_service,
            tool_id=str(tool.id),
            user_id=str(current_user.user_id),
            project_id=project_id,
            folder_node_id=str(payload.node_id),
        )

        return ApiResponse.success(
            data=tool, message="创建 Folder Search Tool 成功（indexing 已异步触发）"
        )
    else:
        # JSON Search: existing behavior
        log_info(
            f"[search_index] json search mode: tool_id={tool.id} node_id={payload.node_id}"
        )
        
        # 先写入一条 pending（便于轮询端立刻拿到状态）
        try:
            repo.upsert(
                SearchIndexTaskUpsert(
                    tool_id=str(tool.id),
                    user_id=str(current_user.user_id),
                    project_id=project_id,
                    node_id=str(payload.node_id),
                    json_path=payload.json_path or "",
                    status="pending",
                    started_at=None,
                    finished_at=None,
                    last_error=None,
                )
            )
        except Exception as e:
            log_error(
                f"[search_index] failed to create task row: tool_id={tool.id} "
                f"node_id={payload.node_id} json_path='{payload.json_path}' err={e}"
            )

        background_tasks.add_task(
            _run_search_indexing_background,
            repo=repo,
            search_service=search_service,
            tool_id=str(tool.id),
            user_id=str(current_user.user_id),
            project_id=project_id,
            node_id=str(payload.node_id),
            json_path=payload.json_path or "",
        )

        return ApiResponse.success(
            data=tool, message="创建 Search Tool 成功（indexing 已异步触发）"
        )


@router.get(
    "/{tool_id}/search-index",
    response_model=ApiResponse[SearchIndexTaskOut],
    summary="查询 Search Tool 索引构建状态",
    description="返回该 Search Tool 的索引任务状态（来自 search_index_task）。",
    status_code=status.HTTP_200_OK,
)
def get_search_index_status(
    tool_id: str,
    tool_service: ToolService = Depends(get_tool_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    import time

    t0 = time.perf_counter()
    log_info(f"[search-index-status] start: tool_id={tool_id}")

    t1 = time.perf_counter()
    tool = tool_service.get_by_id_with_access_check(tool_id, current_user.user_id)
    log_info(
        f"[search-index-status] get_tool: tool_id={tool_id} elapsed_ms={int((time.perf_counter() - t1) * 1000)}"
    )

    if (tool.type or "").strip() != "search":
        log_info(
            f"[search-index-status] not_search_tool: tool_id={tool_id} total_ms={int((time.perf_counter() - t0) * 1000)}"
        )
        return ApiResponse.error(message="Tool is not a search tool")

    t2 = time.perf_counter()
    sb_client = SupabaseClient().get_client()
    log_info(
        f"[search-index-status] get_supabase_client: tool_id={tool_id} elapsed_ms={int((time.perf_counter() - t2) * 1000)}"
    )

    t3 = time.perf_counter()
    repo = SearchIndexTaskRepository(sb_client)
    task = repo.get_by_tool_id(tool_id)
    log_info(
        f"[search-index-status] get_task: tool_id={tool_id} found={task is not None} elapsed_ms={int((time.perf_counter() - t3) * 1000)}"
    )

    if task is None:
        log_info(
            f"[search-index-status] task_not_found: tool_id={tool_id} total_ms={int((time.perf_counter() - t0) * 1000)}"
        )
        return ApiResponse.error(message="Search index task not found")

    out = SearchIndexTaskOut(
        tool_id=tool_id,
        status=task.status,
        started_at=task.started_at,
        finished_at=task.finished_at,
        nodes_count=task.nodes_count,
        chunks_count=task.chunks_count,
        indexed_chunks_count=task.indexed_chunks_count,
        last_error=task.last_error,
        # Folder search specific fields
        folder_node_id=task.folder_node_id,
        total_files=task.total_files,
        indexed_files=task.indexed_files,
    )
    log_info(
        f"[search-index-status] done: tool_id={tool_id} status={task.status} total_ms={int((time.perf_counter() - t0) * 1000)}"
    )
    return ApiResponse.success(data=out, message="获取索引状态成功")


@router.get(
    "/{tool_id}",
    response_model=ApiResponse[ToolOut],
    summary="获取 Tool",
    status_code=status.HTTP_200_OK,
)
def get_tool(
    tool_id: str,
    tool_service: ToolService = Depends(get_tool_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    tool = tool_service.get_by_id_with_access_check(tool_id, current_user.user_id)
    return ApiResponse.success(data=tool, message="获取 Tool 成功")


@router.put(
    "/{tool_id}",
    response_model=ApiResponse[ToolOut],
    summary="更新 Tool",
    status_code=status.HTTP_200_OK,
)
def update_tool(
    tool_id: str,
    payload: ToolUpdate,
    tool_service: ToolService = Depends(get_tool_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    # 只更新「请求体里实际传入」的字段，没传入的不影响
    patch = payload.model_dump(exclude_unset=True)
    tool = tool_service.update(
        tool_id=tool_id, user_id=current_user.user_id, patch=patch
    )
    return ApiResponse.success(data=tool, message="更新 Tool 成功")


@router.delete(
    "/{tool_id}",
    response_model=ApiResponse[None],
    summary="删除 Tool",
    status_code=status.HTTP_200_OK,
)
def delete_tool(
    tool_id: str,
    tool_service: ToolService = Depends(get_tool_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    tool_service.delete(tool_id, current_user.user_id)
    return ApiResponse.success(data=None, message="删除 Tool 成功")
