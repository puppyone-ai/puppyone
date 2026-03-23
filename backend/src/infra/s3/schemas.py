"""S3 storage module Pydantic schemas"""

from datetime import datetime
from pydantic import BaseModel, Field


# ============= Basic Upload/Download Schemas =============


class FileUploadResponse(BaseModel):
    """File upload response"""

    key: str = Field(..., description="S3 object key")
    bucket: str = Field(..., description="Bucket name")
    size: int = Field(..., description="File size (bytes)")
    etag: str = Field(..., description="ETag hash")
    content_type: str | None = Field(None, description="Content type")


class BatchFileUploadRequest(BaseModel):
    """Batch file upload request"""

    files: list[tuple[str, bytes]] = Field(..., description="File list (key, content)")


class BatchFileUploadResult(BaseModel):
    """Single file upload result"""

    key: str
    success: bool
    message: str | None = None
    data: FileUploadResponse | None = None


class BatchFileUploadResponse(BaseModel):
    """Batch file upload response"""

    results: list[BatchFileUploadResult]
    total: int
    successful: int
    failed: int


# ============= File Info Schemas =============


class FileMetadata(BaseModel):
    """File metadata"""

    key: str = Field(..., description="S3 object key")
    bucket: str = Field(..., description="Bucket name")
    size: int = Field(..., description="File size (bytes)")
    etag: str = Field(..., description="ETag hash")
    last_modified: datetime = Field(..., description="Last modified time")
    content_type: str | None = Field(None, description="Content type")
    metadata: dict[str, str] = Field(default_factory=dict, description="Custom metadata")


class FileListItem(BaseModel):
    """File list item"""

    key: str
    size: int
    last_modified: datetime
    etag: str


class FileListResponse(BaseModel):
    """File list response"""

    files: list[FileListItem]
    common_prefixes: list[str] = Field(
        default_factory=list, description="Common prefixes (folders)"
    )
    next_continuation_token: str | None = Field(None, description="Next page token")
    is_truncated: bool = Field(False, description="Whether there are more results")


# ============= Batch Delete Schemas =============


class BatchDeleteRequest(BaseModel):
    """Batch delete request"""

    keys: list[str] = Field(
        ..., min_length=1, max_length=1000, description="List of keys to delete"
    )


class BatchDeleteResult(BaseModel):
    """Single file delete result"""

    key: str
    success: bool
    message: str | None = None


class BatchDeleteResponse(BaseModel):
    """Batch delete response"""

    results: list[BatchDeleteResult]
    total: int
    successful: int
    failed: int


# ============= Presigned URL Schemas =============


class PresignedUploadUrlRequest(BaseModel):
    """Presigned upload URL request"""

    key: str = Field(..., description="Target object key")
    expires_in: int = Field(3600, ge=1, le=86400, description="Expiration time (seconds)")
    content_type: str | None = Field(None, description="Restricted content type")


class PresignedUploadUrlResponse(BaseModel):
    """Presigned upload URL response"""

    url: str = Field(..., description="Presigned URL")
    key: str = Field(..., description="Object key")
    expires_in: int = Field(..., description="Validity period (seconds)")


class PresignedDownloadUrlRequest(BaseModel):
    """Presigned download URL request"""

    key: str = Field(..., description="Object key")
    expires_in: int = Field(3600, ge=1, le=86400, description="Expiration time (seconds)")
    response_content_disposition: str | None = Field(
        None, description="Response Content-Disposition header"
    )


class PresignedDownloadUrlResponse(BaseModel):
    """Presigned download URL response"""

    url: str = Field(..., description="Presigned URL")
    key: str = Field(..., description="Object key")
    expires_in: int = Field(..., description="Validity period (seconds)")


# ============= Multipart Upload Schemas =============


class MultipartCreateRequest(BaseModel):
    """Create multipart upload request"""

    key: str = Field(..., description="Target object key")
    content_type: str | None = Field(None, description="Content type")
    metadata: dict[str, str] = Field(default_factory=dict, description="Custom metadata")


class MultipartCreateResponse(BaseModel):
    """Create multipart upload response"""

    upload_id: str = Field(..., description="Upload session ID")
    key: str = Field(..., description="Object key")


class MultipartUploadPartRequest(BaseModel):
    """Upload single part request"""

    upload_id: str = Field(..., description="Upload session ID")
    part_number: int = Field(..., ge=1, le=10000, description="Part number")


class MultipartUploadPartResponse(BaseModel):
    """Upload single part response"""

    part_number: int = Field(..., description="Part number")
    etag: str = Field(..., description="Part ETag")


class MultipartPart(BaseModel):
    """Part info"""

    part_number: int = Field(..., ge=1, le=10000, description="Part number")
    etag: str = Field(..., description="Part ETag")


class MultipartCompleteRequest(BaseModel):
    """Complete multipart upload request"""

    upload_id: str = Field(..., description="Upload session ID")
    parts: list[MultipartPart] = Field(..., description="List of all part info")


class MultipartCompleteResponse(BaseModel):
    """Complete multipart upload response"""

    key: str = Field(..., description="Object key")
    bucket: str = Field(..., description="Bucket name")
    etag: str = Field(..., description="Complete file ETag")
    size: int | None = Field(None, description="File size (bytes)")


class MultipartAbortRequest(BaseModel):
    """Abort multipart upload request"""

    upload_id: str = Field(..., description="Upload session ID")


class MultipartUploadListItem(BaseModel):
    """In-progress multipart upload item"""

    key: str = Field(..., description="Object key")
    upload_id: str = Field(..., description="Upload session ID")
    initiated: datetime = Field(..., description="Creation time")


class MultipartUploadListResponse(BaseModel):
    """In-progress multipart upload list response"""

    uploads: list[MultipartUploadListItem]
    next_continuation_token: str | None = Field(None, description="Next page token")


class MultipartPartListItem(BaseModel):
    """Uploaded part item"""

    part_number: int = Field(..., description="Part number")
    size: int = Field(..., description="Part size (bytes)")
    etag: str = Field(..., description="Part ETag")
    last_modified: datetime = Field(..., description="Upload time")


class MultipartPartListResponse(BaseModel):
    """Uploaded parts list response"""

    parts: list[MultipartPartListItem]
    next_part_number_marker: int | None = Field(
        None, description="Next page part number marker"
    )
