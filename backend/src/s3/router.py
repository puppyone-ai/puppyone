"""S3 存储模块的 API 路由"""

import json
import logging

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
)
from fastapi.responses import StreamingResponse

from src.s3.dependencies import (
    existing_s3_file,
    get_s3_service,
    valid_s3_key,
    validate_batch_keys_count,
    validate_multipart_part_number,
    validate_presigned_url_expiry,
)
from src.s3.exceptions import (
    S3Error,
    S3FileNotFoundError,
    S3FileSizeExceededError,
    S3MultipartError,
)
from src.s3.schemas import (
    BatchDeleteRequest,
    BatchDeleteResponse,
    BatchFileUploadResponse,
    BatchFileUploadResult,
    FileListResponse,
    FileMetadata,
    FileUploadResponse,
    MultipartCompleteResponse,
    MultipartCreateRequest,
    MultipartCreateResponse,
    MultipartPartListResponse,
    MultipartUploadListResponse,
    MultipartUploadPartResponse,
    PresignedDownloadUrlRequest,
    PresignedDownloadUrlResponse,
    PresignedUploadUrlRequest,
    PresignedUploadUrlResponse,
)
from src.s3.service import S3Service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/s3", tags=["S3 Storage"])


# ============= 文件上传 =============


@router.post("/upload", response_model=FileUploadResponse, status_code=201)
async def upload_file(
    file: UploadFile = File(..., description="要上传的文件"),
    key: str = Form(..., description="S3 对象键"),
    content_type: str | None = Form(None, description="文件类型"),
    service: S3Service = Depends(get_s3_service),
) -> FileUploadResponse:
    """
    上传单个文件到 S3
    """
    try:
        content = await file.read()
        result = await service.upload_file(
            key=key,
            content=content,
            content_type=content_type or file.content_type,
        )
        return result

    except S3FileSizeExceededError as e:
        raise HTTPException(
            status_code=413,
            detail={
                "error": "PayloadTooLarge",
                "message": str(e),
                "max_size": e.max_size,
            },
        )
    except S3Error as e:
        raise HTTPException(
            status_code=500, detail={"error": "S3Error", "message": str(e)}
        )


@router.post("/upload/batch", response_model=BatchFileUploadResponse)
async def upload_files_batch(
    files: list[UploadFile] = File(..., description="要上传的文件列表"),
    keys: list[str] = Form(..., description="对应的 S3 对象键列表"),
    service: S3Service = Depends(get_s3_service),
) -> BatchFileUploadResponse:
    """
    批量上传文件
    """
    if len(files) != len(keys):
        raise HTTPException(status_code=400, detail="Files and keys count mismatch")

    if not files:
        raise HTTPException(status_code=400, detail="At least one file is required")

    # 准备文件数据
    files_data = []
    for file, key in zip(files, keys):
        content = await file.read()
        content_type = file.content_type
        files_data.append((key, content, content_type))

    # 批量上传
    results_raw = await service.upload_files_batch(files_data)

    # 转换结果
    results = []
    for key, success, message, data in results_raw:
        results.append(
            BatchFileUploadResult(key=key, success=success, message=message, data=data)
        )

    successful = sum(1 for r in results if r.success)
    failed = len(results) - successful

    return BatchFileUploadResponse(
        results=results, total=len(results), successful=successful, failed=failed
    )


# ============= 文件下载 =============


@router.get("/download/{key:path}")
async def download_file(
    metadata: FileMetadata = Depends(existing_s3_file),
    service: S3Service = Depends(get_s3_service),
) -> StreamingResponse:
    """
    下载文件(流式响应)
    """
    try:
        # 创建流式响应
        stream = service.download_file_stream(metadata.key)

        # 设置响应头
        headers = {}
        if metadata.content_type:
            headers["Content-Type"] = metadata.content_type

        # 从 key 提取文件名
        filename = metadata.key.split("/")[-1]
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'

        return StreamingResponse(stream, headers=headers)

    except S3Error as e:
        raise HTTPException(
            status_code=500, detail={"error": "S3Error", "message": str(e)}
        )


# ============= 文件存在性检查 =============


@router.head("/exists/{key:path}")
async def check_file_exists(
    key: str = Depends(valid_s3_key),
    service: S3Service = Depends(get_s3_service),
) -> Response:
    """
    检查文件是否存在
    """
    exists = await service.file_exists(key)

    if exists:
        return Response(status_code=200)
    else:
        return Response(status_code=404)


# ============= 文件删除 =============


@router.delete("/{key:path}", status_code=204)
async def delete_file(
    key: str = Depends(valid_s3_key),
    service: S3Service = Depends(get_s3_service),
) -> None:
    """
    删除单个文件
    """
    try:
        await service.delete_file(key)

    except S3FileNotFoundError as e:
        raise HTTPException(
            status_code=404, detail={"error": "FileNotFound", "message": str(e)}
        )
    except S3Error as e:
        raise HTTPException(
            status_code=500, detail={"error": "S3Error", "message": str(e)}
        )


@router.post("/delete/batch", response_model=BatchDeleteResponse)
async def delete_files_batch(
    request: BatchDeleteRequest,
    service: S3Service = Depends(get_s3_service),
    validated_keys: list[str] = Depends(
        lambda r=BatchDeleteRequest: validate_batch_keys_count(r.keys)
    ),
) -> BatchDeleteResponse:
    """
    批量删除文件
    """
    results = await service.delete_files_batch(request.keys)

    successful = sum(1 for r in results if r.success)
    failed = len(results) - successful

    return BatchDeleteResponse(
        results=results, total=len(results), successful=successful, failed=failed
    )


# ============= 文件列表 =============


@router.get("/list", response_model=FileListResponse)
async def list_files(
    prefix: str = Query("", description="键前缀"),
    delimiter: str | None = Query(None, description="分隔符(用于模拟文件夹)"),
    max_keys: int = Query(1000, ge=1, le=1000, description="最大返回数量"),
    continuation_token: str | None = Query(None, description="分页 token"),
    service: S3Service = Depends(get_s3_service),
) -> FileListResponse:
    """
    列出文件
    """
    try:
        files, common_prefixes, next_token, is_truncated = await service.list_files(
            prefix=prefix,
            delimiter=delimiter,
            max_keys=max_keys,
            continuation_token=continuation_token,
        )

        return FileListResponse(
            files=files,
            common_prefixes=common_prefixes,
            next_continuation_token=next_token,
            is_truncated=is_truncated,
        )

    except S3Error as e:
        raise HTTPException(
            status_code=500, detail={"error": "S3Error", "message": str(e)}
        )


# ============= 文件元信息 =============


@router.get("/metadata/{key:path}", response_model=FileMetadata)
async def get_file_metadata(
    metadata: FileMetadata = Depends(existing_s3_file),
) -> FileMetadata:
    """
    获取文件元信息
    """
    return metadata


# ============= 预签名 URL =============


@router.post("/presigned-url/upload", response_model=PresignedUploadUrlResponse)
async def generate_presigned_upload_url(
    request: PresignedUploadUrlRequest,
    service: S3Service = Depends(get_s3_service),
    expires_in: int = Depends(
        lambda r=PresignedUploadUrlRequest: validate_presigned_url_expiry(r.expires_in)
    ),
) -> PresignedUploadUrlResponse:
    """
    生成上传预签名 URL
    """
    try:
        url = await service.generate_presigned_upload_url(
            key=request.key,
            expires_in=request.expires_in,
            content_type=request.content_type,
        )

        return PresignedUploadUrlResponse(
            url=url, key=request.key, expires_in=request.expires_in
        )

    except S3Error as e:
        raise HTTPException(
            status_code=500, detail={"error": "S3Error", "message": str(e)}
        )


@router.post("/presigned-url/download", response_model=PresignedDownloadUrlResponse)
async def generate_presigned_download_url(
    request: PresignedDownloadUrlRequest,
    service: S3Service = Depends(get_s3_service),
    expires_in: int = Depends(
        lambda r=PresignedDownloadUrlRequest: validate_presigned_url_expiry(
            r.expires_in
        )
    ),
) -> PresignedDownloadUrlResponse:
    """
    生成下载预签名 URL
    """
    try:
        url = await service.generate_presigned_download_url(
            key=request.key,
            expires_in=request.expires_in,
            response_content_disposition=request.response_content_disposition,
        )

        return PresignedDownloadUrlResponse(
            url=url, key=request.key, expires_in=request.expires_in
        )

    except S3Error as e:
        raise HTTPException(
            status_code=500, detail={"error": "S3Error", "message": str(e)}
        )


# ============= 分片上传 =============


@router.post(
    "/multipart/create", response_model=MultipartCreateResponse, status_code=201
)
async def create_multipart_upload(
    request: MultipartCreateRequest,
    service: S3Service = Depends(get_s3_service),
) -> MultipartCreateResponse:
    """
    创建分片上传会话
    """
    try:
        upload_id = await service.create_multipart_upload(
            key=request.key,
            content_type=request.content_type,
            metadata=request.metadata if request.metadata else None,
        )

        return MultipartCreateResponse(upload_id=upload_id, key=request.key)

    except S3Error as e:
        raise HTTPException(
            status_code=500, detail={"error": "S3Error", "message": str(e)}
        )


@router.put("/multipart/upload-part", response_model=MultipartUploadPartResponse)
async def upload_part(
    key: str = Form(..., description="S3 对象键"),
    upload_id: str = Form(..., description="上传会话 ID"),
    part_number: int = Form(..., ge=1, le=10000, description="分片编号"),
    file: UploadFile = File(..., description="分片数据"),
    service: S3Service = Depends(get_s3_service),
    validated_part_number: int = Depends(lambda pn: validate_multipart_part_number(pn)),
) -> MultipartUploadPartResponse:
    """
    上传单个分片
    """
    try:
        data = await file.read()
        etag = await service.upload_part(
            key=key, upload_id=upload_id, part_number=part_number, data=data
        )

        return MultipartUploadPartResponse(part_number=part_number, etag=etag)

    except S3MultipartError as e:
        raise HTTPException(
            status_code=400, detail={"error": "MultipartError", "message": str(e)}
        )
    except S3Error as e:
        raise HTTPException(
            status_code=500, detail={"error": "S3Error", "message": str(e)}
        )


@router.post("/multipart/complete", response_model=MultipartCompleteResponse)
async def complete_multipart_upload(
    key: str = Form(..., description="S3 对象键"),
    upload_id: str = Form(..., description="上传会话 ID"),
    parts_json: str = Form(..., description="分片信息 JSON 字符串"),
    service: S3Service = Depends(get_s3_service),
) -> MultipartCompleteResponse:
    """
    完成分片上传
    """
    try:
        # 解析分片信息
        parts_data = json.loads(parts_json)
        parts = [(p["part_number"], p["etag"]) for p in parts_data]

        result = await service.complete_multipart_upload(
            key=key, upload_id=upload_id, parts=parts
        )

        return result

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid parts JSON format")
    except S3MultipartError as e:
        raise HTTPException(
            status_code=400, detail={"error": "MultipartError", "message": str(e)}
        )
    except S3Error as e:
        raise HTTPException(
            status_code=500, detail={"error": "S3Error", "message": str(e)}
        )


@router.delete("/multipart/abort", status_code=204)
async def abort_multipart_upload(
    key: str = Query(..., description="S3 对象键"),
    upload_id: str = Query(..., description="上传会话 ID"),
    service: S3Service = Depends(get_s3_service),
) -> None:
    """
    取消分片上传
    """
    try:
        await service.abort_multipart_upload(key=key, upload_id=upload_id)

    except S3MultipartError as e:
        raise HTTPException(
            status_code=400, detail={"error": "MultipartError", "message": str(e)}
        )
    except S3Error as e:
        raise HTTPException(
            status_code=500, detail={"error": "S3Error", "message": str(e)}
        )


@router.get("/multipart/list", response_model=MultipartUploadListResponse)
async def list_multipart_uploads(
    prefix: str = Query("", description="键前缀"),
    max_uploads: int = Query(1000, ge=1, le=1000, description="最大返回数量"),
    service: S3Service = Depends(get_s3_service),
) -> MultipartUploadListResponse:
    """
    列出进行中的分片上传
    """
    try:
        uploads, next_token = await service.list_multipart_uploads(
            prefix=prefix, max_uploads=max_uploads
        )

        return MultipartUploadListResponse(
            uploads=uploads, next_continuation_token=next_token
        )

    except S3Error as e:
        raise HTTPException(
            status_code=500, detail={"error": "S3Error", "message": str(e)}
        )


@router.get("/multipart/list-parts", response_model=MultipartPartListResponse)
async def list_parts(
    key: str = Query(..., description="S3 对象键"),
    upload_id: str = Query(..., description="上传会话 ID"),
    max_parts: int = Query(1000, ge=1, le=1000, description="最大返回数量"),
    service: S3Service = Depends(get_s3_service),
) -> MultipartPartListResponse:
    """
    列出已上传的分片
    """
    try:
        parts, next_marker = await service.list_parts(
            key=key, upload_id=upload_id, max_parts=max_parts
        )

        return MultipartPartListResponse(
            parts=parts, next_part_number_marker=next_marker
        )

    except S3Error as e:
        raise HTTPException(
            status_code=500, detail={"error": "S3Error", "message": str(e)}
        )
