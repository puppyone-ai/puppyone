"""S3 存储模块的 Pydantic schemas"""

from datetime import datetime
from pydantic import BaseModel, Field


# ============= 基础上传/下载 Schemas =============


class FileUploadResponse(BaseModel):
    """文件上传响应"""

    key: str = Field(..., description="S3 对象键")
    bucket: str = Field(..., description="存储桶名称")
    size: int = Field(..., description="文件大小(字节)")
    etag: str = Field(..., description="ETag 哈希值")
    content_type: str | None = Field(None, description="文件类型")


class BatchFileUploadRequest(BaseModel):
    """批量文件上传请求"""

    files: list[tuple[str, bytes]] = Field(..., description="文件列表 (key, content)")


class BatchFileUploadResult(BaseModel):
    """单个文件上传结果"""

    key: str
    success: bool
    message: str | None = None
    data: FileUploadResponse | None = None


class BatchFileUploadResponse(BaseModel):
    """批量文件上传响应"""

    results: list[BatchFileUploadResult]
    total: int
    successful: int
    failed: int


# ============= 文件信息 Schemas =============


class FileMetadata(BaseModel):
    """文件元信息"""

    key: str = Field(..., description="S3 对象键")
    bucket: str = Field(..., description="存储桶名称")
    size: int = Field(..., description="文件大小(字节)")
    etag: str = Field(..., description="ETag 哈希值")
    last_modified: datetime = Field(..., description="最后修改时间")
    content_type: str | None = Field(None, description="文件类型")
    metadata: dict[str, str] = Field(default_factory=dict, description="自定义元数据")


class FileListItem(BaseModel):
    """文件列表项"""

    key: str
    size: int
    last_modified: datetime
    etag: str


class FileListResponse(BaseModel):
    """文件列表响应"""

    files: list[FileListItem]
    common_prefixes: list[str] = Field(
        default_factory=list, description="公共前缀(文件夹)"
    )
    next_continuation_token: str | None = Field(None, description="下一页的 token")
    is_truncated: bool = Field(False, description="是否有更多结果")


# ============= 批量删除 Schemas =============


class BatchDeleteRequest(BaseModel):
    """批量删除请求"""

    keys: list[str] = Field(
        ..., min_length=1, max_length=1000, description="要删除的键列表"
    )


class BatchDeleteResult(BaseModel):
    """单个文件删除结果"""

    key: str
    success: bool
    message: str | None = None


class BatchDeleteResponse(BaseModel):
    """批量删除响应"""

    results: list[BatchDeleteResult]
    total: int
    successful: int
    failed: int


# ============= 预签名 URL Schemas =============


class PresignedUploadUrlRequest(BaseModel):
    """生成上传预签名 URL 请求"""

    key: str = Field(..., description="目标对象键")
    expires_in: int = Field(3600, ge=1, le=86400, description="过期时间(秒)")
    content_type: str | None = Field(None, description="限制的文件类型")


class PresignedUploadUrlResponse(BaseModel):
    """生成上传预签名 URL 响应"""

    url: str = Field(..., description="预签名 URL")
    key: str = Field(..., description="对象键")
    expires_in: int = Field(..., description="有效期(秒)")


class PresignedDownloadUrlRequest(BaseModel):
    """生成下载预签名 URL 请求"""

    key: str = Field(..., description="对象键")
    expires_in: int = Field(3600, ge=1, le=86400, description="过期时间(秒)")
    response_content_disposition: str | None = Field(
        None, description="响应的 Content-Disposition 头"
    )


class PresignedDownloadUrlResponse(BaseModel):
    """生成下载预签名 URL 响应"""

    url: str = Field(..., description="预签名 URL")
    key: str = Field(..., description="对象键")
    expires_in: int = Field(..., description="有效期(秒)")


# ============= 分片上传 Schemas =============


class MultipartCreateRequest(BaseModel):
    """创建分片上传请求"""

    key: str = Field(..., description="目标对象键")
    content_type: str | None = Field(None, description="文件类型")
    metadata: dict[str, str] = Field(default_factory=dict, description="自定义元数据")


class MultipartCreateResponse(BaseModel):
    """创建分片上传响应"""

    upload_id: str = Field(..., description="上传会话 ID")
    key: str = Field(..., description="对象键")


class MultipartUploadPartRequest(BaseModel):
    """上传单个分片请求"""

    upload_id: str = Field(..., description="上传会话 ID")
    part_number: int = Field(..., ge=1, le=10000, description="分片编号")


class MultipartUploadPartResponse(BaseModel):
    """上传单个分片响应"""

    part_number: int = Field(..., description="分片编号")
    etag: str = Field(..., description="分片 ETag")


class MultipartPart(BaseModel):
    """分片信息"""

    part_number: int = Field(..., ge=1, le=10000, description="分片编号")
    etag: str = Field(..., description="分片 ETag")


class MultipartCompleteRequest(BaseModel):
    """完成分片上传请求"""

    upload_id: str = Field(..., description="上传会话 ID")
    parts: list[MultipartPart] = Field(..., description="所有分片信息列表")


class MultipartCompleteResponse(BaseModel):
    """完成分片上传响应"""

    key: str = Field(..., description="对象键")
    bucket: str = Field(..., description="存储桶名称")
    etag: str = Field(..., description="完整文件的 ETag")
    size: int | None = Field(None, description="文件大小(字节)")


class MultipartAbortRequest(BaseModel):
    """取消分片上传请求"""

    upload_id: str = Field(..., description="上传会话 ID")


class MultipartUploadListItem(BaseModel):
    """进行中的分片上传项"""

    key: str = Field(..., description="对象键")
    upload_id: str = Field(..., description="上传会话 ID")
    initiated: datetime = Field(..., description="创建时间")


class MultipartUploadListResponse(BaseModel):
    """进行中的分片上传列表响应"""

    uploads: list[MultipartUploadListItem]
    next_continuation_token: str | None = Field(None, description="下一页的 token")


class MultipartPartListItem(BaseModel):
    """已上传分片项"""

    part_number: int = Field(..., description="分片编号")
    size: int = Field(..., description="分片大小(字节)")
    etag: str = Field(..., description="分片 ETag")
    last_modified: datetime = Field(..., description="上传时间")


class MultipartPartListResponse(BaseModel):
    """已上传分片列表响应"""

    parts: list[MultipartPartListItem]
    next_part_number_marker: int | None = Field(
        None, description="下一页的分片编号标记"
    )
