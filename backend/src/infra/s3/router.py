"""S3 storage module API routes"""

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

from src.infra.s3.dependencies import (
    existing_s3_file,
    get_s3_service,
    valid_s3_key,
    validate_batch_keys_count,
    validate_multipart_part_number,
    validate_presigned_url_expiry,
)
from src.infra.s3.exceptions import (
    S3Error,
    S3FileNotFoundError,
    S3FileSizeExceededError,
    S3MultipartError,
)
from src.infra.s3.schemas import (
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
from src.infra.s3.service import S3Service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/s3", tags=["S3 Storage"])


# ============= File Upload =============


@router.post("/upload", response_model=FileUploadResponse, status_code=201)
async def upload_file(
    file: UploadFile = File(..., description="File to upload"),
    key: str = Form(..., description="S3 object key"),
    content_type: str | None = Form(None, description="Content type"),
    service: S3Service = Depends(get_s3_service),
) -> FileUploadResponse:
    """
    Upload a single file to S3.
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
    files: list[UploadFile] = File(..., description="List of files to upload"),
    keys: list[str] = Form(..., description="Corresponding S3 object key list"),
    service: S3Service = Depends(get_s3_service),
) -> BatchFileUploadResponse:
    """
    Batch upload files.
    """
    if len(files) != len(keys):
        raise HTTPException(status_code=400, detail="Files and keys count mismatch")

    if not files:
        raise HTTPException(status_code=400, detail="At least one file is required")

    # Prepare file data
    files_data = []
    for file, key in zip(files, keys):
        content = await file.read()
        content_type = file.content_type
        files_data.append((key, content, content_type))

    # Batch upload
    results_raw = await service.upload_files_batch(files_data)

    # Convert results
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


# ============= File Download =============


@router.get("/download/{key:path}")
async def download_file(
    metadata: FileMetadata = Depends(existing_s3_file),
    service: S3Service = Depends(get_s3_service),
) -> StreamingResponse:
    """
    Download file (streaming response).
    """
    try:
        # Create streaming response
        stream = service.download_file_stream(metadata.key)

        # Set response headers
        headers = {}
        if metadata.content_type:
            headers["Content-Type"] = metadata.content_type

        # Extract filename from key
        filename = metadata.key.split("/")[-1]
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'

        return StreamingResponse(stream, headers=headers)

    except S3Error as e:
        raise HTTPException(
            status_code=500, detail={"error": "S3Error", "message": str(e)}
        )


# ============= File Existence Check =============


@router.head("/exists/{key:path}")
async def check_file_exists(
    key: str = Depends(valid_s3_key),
    service: S3Service = Depends(get_s3_service),
) -> Response:
    """
    Check if a file exists.
    """
    exists = await service.file_exists(key)

    if exists:
        return Response(status_code=200)
    else:
        return Response(status_code=404)


# ============= File Deletion =============


@router.delete("/{key:path}", status_code=204)
async def delete_file(
    key: str = Depends(valid_s3_key),
    service: S3Service = Depends(get_s3_service),
) -> None:
    """
    Delete a single file.
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
    Batch delete files.
    """
    results = await service.delete_files_batch(request.keys)

    successful = sum(1 for r in results if r.success)
    failed = len(results) - successful

    return BatchDeleteResponse(
        results=results, total=len(results), successful=successful, failed=failed
    )


# ============= File Listing =============


@router.get("/list", response_model=FileListResponse)
async def list_files(
    prefix: str = Query("", description="Key prefix"),
    delimiter: str | None = Query(None, description="Delimiter (for simulating folders)"),
    max_keys: int = Query(1000, ge=1, le=1000, description="Maximum number of results"),
    continuation_token: str | None = Query(None, description="Pagination token"),
    service: S3Service = Depends(get_s3_service),
) -> FileListResponse:
    """
    List files.
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


# ============= File Metadata =============


@router.get("/metadata/{key:path}", response_model=FileMetadata)
async def get_file_metadata(
    metadata: FileMetadata = Depends(existing_s3_file),
) -> FileMetadata:
    """
    Get file metadata.
    """
    return metadata


# ============= Presigned URLs =============


@router.post("/presigned-url/upload", response_model=PresignedUploadUrlResponse)
async def generate_presigned_upload_url(
    request: PresignedUploadUrlRequest,
    service: S3Service = Depends(get_s3_service),
    expires_in: int = Depends(
        lambda r=PresignedUploadUrlRequest: validate_presigned_url_expiry(r.expires_in)
    ),
) -> PresignedUploadUrlResponse:
    """
    Generate a presigned upload URL.
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
    Generate a presigned download URL.
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


# ============= Multipart Upload =============


@router.post(
    "/multipart/create", response_model=MultipartCreateResponse, status_code=201
)
async def create_multipart_upload(
    request: MultipartCreateRequest,
    service: S3Service = Depends(get_s3_service),
) -> MultipartCreateResponse:
    """
    Create a multipart upload session.
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
    key: str = Form(..., description="S3 object key"),
    upload_id: str = Form(..., description="Upload session ID"),
    part_number: int = Form(..., ge=1, le=10000, description="Part number"),
    file: UploadFile = File(..., description="Part data"),
    service: S3Service = Depends(get_s3_service),
    validated_part_number: int = Depends(lambda pn: validate_multipart_part_number(pn)),
) -> MultipartUploadPartResponse:
    """
    Upload a single part.
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
    key: str = Form(..., description="S3 object key"),
    upload_id: str = Form(..., description="Upload session ID"),
    parts_json: str = Form(..., description="Parts info JSON string"),
    service: S3Service = Depends(get_s3_service),
) -> MultipartCompleteResponse:
    """
    Complete a multipart upload.
    """
    try:
        # Parse parts info
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
    key: str = Query(..., description="S3 object key"),
    upload_id: str = Query(..., description="Upload session ID"),
    service: S3Service = Depends(get_s3_service),
) -> None:
    """
    Abort a multipart upload.
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
    prefix: str = Query("", description="Key prefix"),
    max_uploads: int = Query(1000, ge=1, le=1000, description="Maximum number of results"),
    service: S3Service = Depends(get_s3_service),
) -> MultipartUploadListResponse:
    """
    List in-progress multipart uploads.
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
    key: str = Query(..., description="S3 object key"),
    upload_id: str = Query(..., description="Upload session ID"),
    max_parts: int = Query(1000, ge=1, le=1000, description="Maximum number of results"),
    service: S3Service = Depends(get_s3_service),
) -> MultipartPartListResponse:
    """
    List uploaded parts.
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
