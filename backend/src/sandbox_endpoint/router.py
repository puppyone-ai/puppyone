from typing import List, Dict, Any
import re
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, Header

from src.sandbox_endpoint.service import SandboxEndpointService
from src.sandbox_endpoint.schemas import (
    SandboxEndpointCreate,
    SandboxEndpointUpdate,
    SandboxEndpointOut,
)
from src.sandbox_endpoint.dependencies import (
    get_sandbox_endpoint_service,
    get_verified_sandbox_endpoint,
)
from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.common_schemas import ApiResponse
from src.content_node.dependencies import get_content_node_service
from src.content_node.service import ContentNodeService
from src.sandbox.dependencies import get_sandbox_service
from src.sandbox.service import SandboxService
from src.agent.sandbox_data import prepare_sandbox_data, SandboxFile


router = APIRouter(
    prefix="/sandbox-endpoints",
    tags=["sandbox-endpoints"],
    responses={
        404: {"description": "Sandbox endpoint not found"},
        403: {"description": "Access denied"},
    },
)


def _to_out(row: dict) -> SandboxEndpointOut:
    return SandboxEndpointOut(
        id=row["id"],
        project_id=row["project_id"],
        node_id=row.get("node_id"),
        name=row["name"],
        description=row.get("description"),
        access_key=row["access_key"],
        mounts=row.get("mounts", []),
        runtime=row.get("runtime", "alpine"),
        timeout_seconds=row.get("timeout_seconds", 30),
        resource_limits=row.get("resource_limits", {}),
        status=row["status"],
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def _normalize_mount_path(path: str) -> str:
    normalized = (path or "/workspace").strip()
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"
    if normalized.endswith("/"):
        normalized = normalized[:-1]
    if not normalized.startswith("/workspace"):
        normalized = f"/workspace{normalized}" if normalized != "/" else "/workspace"
    return normalized or "/workspace"


def _is_write_command(command: str) -> bool:
    write_patterns = [
        r">", r">>", r"\brm\b", r"\bmv\b", r"\bcp\b", r"\btouch\b", r"\bmkdir\b",
        r"\brmdir\b", r"\btruncate\b", r"\bsed\s+-i\b", r"\btee\b", r"\bchmod\b",
        r"\bchown\b", r"\becho\b.*>",
    ]
    return any(re.search(pattern, command) for pattern in write_patterns)


def _validate_command(command: str, mounts: List[Dict[str, Any]]) -> None:
    forbidden_patterns = [
        r"\bsudo\b",
        r"/etc/",
        r"/proc/",
        r"/sys/",
        r"/dev/",
        r"(^|\s)mount(\s|$)",
        r"(^|\s)umount(\s|$)",
        r"(^|\s)reboot(\s|$)",
        r"(^|\s)shutdown(\s|$)",
        r"(^|\s)mkfs(\s|$)",
        r"169\.254\.169\.254",
    ]
    if any(re.search(pattern, command) for pattern in forbidden_patterns):
        raise HTTPException(status_code=400, detail="Command contains forbidden operations")

    readonly_mounts = [_normalize_mount_path(m.get("mount_path", "/workspace")) for m in mounts if (m.get("permissions") or {}).get("write") is False]
    if not readonly_mounts:
        return

    if not _is_write_command(command):
        return

    referenced_paths = re.findall(r"(/workspace[^\s\"']*)", command)
    if not referenced_paths:
        raise HTTPException(status_code=400, detail="Write commands must target explicit /workspace paths")

    for path in referenced_paths:
        for readonly_path in readonly_mounts:
            if path == readonly_path or path.startswith(f"{readonly_path}/"):
                raise HTTPException(status_code=403, detail=f"Write denied for readonly mount: {readonly_path}")


async def _build_sandbox_files(
    endpoint: Dict[str, Any],
    node_service: ContentNodeService,
) -> List[SandboxFile]:
    files: List[SandboxFile] = []
    project_id = endpoint["project_id"]
    mounts = endpoint.get("mounts", [])

    for mount in mounts:
        node_id = mount.get("node_id")
        if not node_id:
            continue
        mount_path = _normalize_mount_path(mount.get("mount_path", "/workspace"))
        prepared = await prepare_sandbox_data(
            node_service=node_service,
            node_id=node_id,
            json_path="",
            user_id="sandbox_endpoint",
        )

        for f in prepared.files:
            source_path = f.path or "/workspace/data.json"
            relative = source_path[len("/workspace"):] if source_path.startswith("/workspace") else source_path
            if not relative.startswith("/"):
                relative = f"/{relative}"
            target_path = f"{mount_path}{relative}"
            files.append(
                SandboxFile(
                    path=target_path,
                    content=f.content,
                    s3_key=f.s3_key,
                    content_type=f.content_type,
                    node_id=f.node_id,
                    node_type=f.node_type,
                    base_version=f.base_version,
                )
            )

    return files


@router.get(
    "",
    response_model=ApiResponse[List[SandboxEndpointOut]],
    summary="列出项目的 Sandbox 端点",
)
def list_endpoints(
    project_id: str = Query(..., description="项目 ID"),
    current_user: CurrentUser = Depends(get_current_user),
    service: SandboxEndpointService = Depends(get_sandbox_endpoint_service),
):
    if not service.verify_project_access(project_id, current_user.user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    rows = service.list_endpoints(project_id)
    return ApiResponse.success(data=[_to_out(r) for r in rows])


@router.get(
    "/{endpoint_id}",
    response_model=ApiResponse[SandboxEndpointOut],
    summary="获取 Sandbox 端点详情",
)
def get_endpoint(
    endpoint: dict = Depends(get_verified_sandbox_endpoint),
):
    return ApiResponse.success(data=_to_out(endpoint))


@router.get(
    "/by-node/{node_id}",
    response_model=ApiResponse[SandboxEndpointOut],
    summary="按节点查 Sandbox 端点",
)
def get_by_node(
    node_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: SandboxEndpointService = Depends(get_sandbox_endpoint_service),
):
    row = service.get_by_node(node_id)
    if not row:
        raise HTTPException(status_code=404, detail="No Sandbox endpoint for this node")
    if not service.verify_access(row["id"], current_user.user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    return ApiResponse.success(data=_to_out(row))


@router.post(
    "",
    response_model=ApiResponse[SandboxEndpointOut],
    summary="创建 Sandbox 端点",
)
def create_endpoint(
    payload: SandboxEndpointCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: SandboxEndpointService = Depends(get_sandbox_endpoint_service),
):
    if not service.verify_project_access(payload.project_id, current_user.user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    row = service.create_endpoint(
        project_id=payload.project_id,
        name=payload.name,
        node_id=payload.node_id,
        description=payload.description,
        mounts=payload.mounts,
        runtime=payload.runtime,
        timeout_seconds=payload.timeout_seconds,
        resource_limits=payload.resource_limits,
    )
    return ApiResponse.success(data=_to_out(row), message="Sandbox endpoint created")


@router.put(
    "/{endpoint_id}",
    response_model=ApiResponse[SandboxEndpointOut],
    summary="更新 Sandbox 端点",
)
def update_endpoint(
    payload: SandboxEndpointUpdate,
    endpoint: dict = Depends(get_verified_sandbox_endpoint),
    current_user: CurrentUser = Depends(get_current_user),
    service: SandboxEndpointService = Depends(get_sandbox_endpoint_service),
):
    update_kwargs = payload.model_dump(exclude_unset=True)
    row = service.update_endpoint(endpoint["id"], **update_kwargs)
    if not row:
        raise HTTPException(status_code=500, detail="Update failed")
    return ApiResponse.success(data=_to_out(row))


@router.delete(
    "/{endpoint_id}",
    response_model=ApiResponse,
    summary="删除 Sandbox 端点",
)
def delete_endpoint(
    endpoint: dict = Depends(get_verified_sandbox_endpoint),
    current_user: CurrentUser = Depends(get_current_user),
    service: SandboxEndpointService = Depends(get_sandbox_endpoint_service),
):
    service.delete_endpoint(endpoint["id"])
    return ApiResponse.success(message="Sandbox endpoint deleted")


@router.post(
    "/{endpoint_id}/regenerate-key",
    response_model=ApiResponse[SandboxEndpointOut],
    summary="重新生成 access key",
)
def regenerate_key(
    endpoint: dict = Depends(get_verified_sandbox_endpoint),
    current_user: CurrentUser = Depends(get_current_user),
    service: SandboxEndpointService = Depends(get_sandbox_endpoint_service),
):
    row = service.regenerate_key(endpoint["id"])
    if not row:
        raise HTTPException(status_code=500, detail="Regenerate failed")
    return ApiResponse.success(data=_to_out(row), message="Access key regenerated")


@router.post(
    "/{endpoint_id}/exec",
    response_model=ApiResponse[dict],
    summary="在 Sandbox 端点执行命令",
)
async def exec_command(
    endpoint_id: str,
    payload: dict,
    x_access_key: str = Header(..., alias="X-Access-Key"),
    service: SandboxEndpointService = Depends(get_sandbox_endpoint_service),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
    node_service: ContentNodeService = Depends(get_content_node_service),
):
    endpoint = service.get_endpoint(endpoint_id)
    if not endpoint:
        raise HTTPException(status_code=404, detail="Sandbox endpoint not found")
    if endpoint.get("access_key") != x_access_key:
        raise HTTPException(status_code=403, detail="Invalid access key")
    if endpoint.get("status") != "active":
        raise HTTPException(status_code=403, detail="Sandbox endpoint is not active")

    command = (payload or {}).get("command", "")
    if not command or not isinstance(command, str):
        raise HTTPException(status_code=400, detail="command is required")

    mounts = endpoint.get("mounts", [])
    _validate_command(command, mounts)
    files = await _build_sandbox_files(endpoint, node_service)
    if not files:
        raise HTTPException(status_code=400, detail="No mount files resolved for this sandbox endpoint")

    session_id = f"sbxep-{endpoint_id}-{uuid.uuid4().hex[:10]}"
    start_res = await sandbox_service.start_with_files(
        session_id=session_id,
        files=files,
        readonly=False,
        s3_service=getattr(node_service, "s3", None),
    )
    if not start_res.get("success"):
        raise HTTPException(status_code=500, detail=start_res.get("error", "Failed to start sandbox session"))

    try:
        exec_res = await sandbox_service.exec(session_id=session_id, command=command)
        return ApiResponse.success(data=exec_res)
    finally:
        await sandbox_service.stop(session_id=session_id)
