"""S3 存储服务核心业务逻辑"""

import asyncio
import logging
from typing import AsyncIterator, Callable, TypeVar

import boto3
from botocore.exceptions import ClientError

from src.s3.config import s3_settings
from src.s3.exceptions import (
    S3Error,
    S3FileNotFoundError,
    S3FileSizeExceededError,
    S3MultipartError,
    S3OperationError,
)
from src.s3.schemas import (
    BatchDeleteResult,
    FileListItem,
    FileMetadata,
    FileUploadResponse,
    MultipartCompleteResponse,
    MultipartPartListItem,
    MultipartUploadListItem,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")


class S3Service:
    """S3 存储服务类"""

    def __init__(self):
        """初始化 S3 服务"""
        self.bucket_name = s3_settings.S3_BUCKET_NAME
        self.region = s3_settings.S3_REGION
        self.endpoint_url = s3_settings.S3_ENDPOINT_URL
        self.access_key_id = s3_settings.S3_ACCESS_KEY_ID
        self.secret_access_key = s3_settings.S3_SECRET_ACCESS_KEY

        # 文件大小限制配置
        self.max_file_size = s3_settings.S3_MAX_FILE_SIZE
        self.multipart_threshold = s3_settings.S3_MULTIPART_THRESHOLD
        self.multipart_chunksize = s3_settings.S3_MULTIPART_CHUNKSIZE

        # 创建 boto3 客户端（线程安全）
        from botocore.config import Config
        
        # 配置签名版本为 v4 (Supabase Storage 要求)
        config = Config(
            signature_version='s3v4',
            s3={
                'addressing_style': 'path'  # 使用路径样式 (bucket/key)
            },
            # 增加重试次数和超时时间，避免SSL错误
            retries={
                'max_attempts': 5,
                'mode': 'adaptive'
            },
            connect_timeout=60,
            read_timeout=300,
            # 禁用SSL验证（如果使用自签名证书或开发环境）
            # 注意：生产环境应该使用有效的SSL证书
            # verify=False
        )
        
        client_kwargs = {
            "service_name": "s3",
            "aws_access_key_id": self.access_key_id,
            "aws_secret_access_key": self.secret_access_key,
            "region_name": self.region,
            "config": config,
        }
        if self.endpoint_url:
            client_kwargs["endpoint_url"] = self.endpoint_url

        self.client = boto3.client(**client_kwargs)

    async def _run_sync(self, func: Callable[..., T], *args, **kwargs) -> T:
        """
        将同步函数包装为异步执行

        Args:
            func: 同步函数
            *args: 位置参数
            **kwargs: 关键字参数

        Returns:
            函数执行结果
        """
        return await asyncio.to_thread(func, *args, **kwargs)

    def _handle_client_error(self, error: ClientError, operation: str) -> None:
        """处理 boto3 ClientError"""
        error_code = error.response.get("Error", {}).get("Code", "Unknown")
        error_message = error.response.get("Error", {}).get("Message", str(error))
        http_status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0)

        logger.error(
            f"S3 {operation} failed: {error_code} - {error_message} (HTTP {http_status})",
            extra={"error_code": error_code, "operation": operation, "http_status": http_status},
        )

        # 处理各种错误码
        if error_code == "NoSuchKey" or error_code == "404" or http_status == 404:
            # 404 可能是文件不存在或 bucket 不存在
            if operation in ["upload_file", "create_multipart_upload"]:
                raise S3OperationError(f"Bucket '{self.bucket_name}' may not exist or is not accessible: {error_message}")
            else:
                raise S3FileNotFoundError(error_message)
        elif error_code == "NoSuchBucket":
            raise S3OperationError(f"Bucket '{self.bucket_name}' does not exist")
        elif error_code == "AccessDenied" or http_status == 403:
            raise S3OperationError(f"Access denied: {error_message}")
        else:
            raise S3OperationError(f"{operation} failed: {error_message}")

    # ============= 文件上传 =============

    async def upload_file(
        self,
        key: str,
        content: bytes,
        content_type: str | None = None,
        metadata: dict[str, str] | None = None,
    ) -> FileUploadResponse:
        """
        上传单个文件到 S3（智能选择单次上传或分片上传）

        Args:
            key: S3 对象键
            content: 文件内容
            content_type: 文件类型
            metadata: 自定义元数据

        Returns:
            FileUploadResponse: 上传结果

        Raises:
            S3FileSizeExceededError: 文件大小超限
            S3OperationError: 上传失败
        """
        # 检查文件大小
        file_size = len(content)
        if file_size > self.max_file_size:
            raise S3FileSizeExceededError(file_size, self.max_file_size)

        # 如果文件大小超过分片上传阈值，使用分片上传避免SSL错误
        if file_size > self.multipart_threshold:
            logger.info(
                f"File size ({file_size} bytes) exceeds threshold ({self.multipart_threshold} bytes), "
                f"using multipart upload for {key}"
            )
            return await self._upload_file_multipart(key, content, content_type, metadata)

        # 小文件使用单次上传
        try:
            extra_args = {}
            if content_type:
                extra_args["ContentType"] = content_type
            if metadata:
                extra_args["Metadata"] = metadata

            response = await self._run_sync(
                self.client.put_object,
                Bucket=self.bucket_name,
                Key=key,
                Body=content,
                **extra_args,
            )

            logger.info(f"File uploaded successfully: {key} ({file_size} bytes)")

            return FileUploadResponse(
                key=key,
                bucket=self.bucket_name,
                size=file_size,
                etag=response["ETag"].strip('"'),
                content_type=content_type,
            )

        except ClientError as e:
            self._handle_client_error(e, "upload_file")
            raise  # 永远不会执行,但类型检查器需要
    
    async def _upload_file_multipart(
        self,
        key: str,
        content: bytes,
        content_type: str | None = None,
        metadata: dict[str, str] | None = None,
    ) -> FileUploadResponse:
        """
        使用分片上传方式上传大文件

        Args:
            key: S3 对象键
            content: 文件内容
            content_type: 文件类型
            metadata: 自定义元数据

        Returns:
            FileUploadResponse: 上传结果
        """
        file_size = len(content)
        upload_id = None
        
        try:
            # 1. 创建分片上传
            upload_id = await self.create_multipart_upload(key, content_type, metadata)
            
            # 2. 分片上传
            parts = []
            part_number = 1
            offset = 0
            
            while offset < file_size:
                # 计算当前分片大小
                chunk_size = min(self.multipart_chunksize, file_size - offset)
                chunk_data = content[offset:offset + chunk_size]
                
                # 上传分片
                etag = await self.upload_part(key, upload_id, part_number, chunk_data)
                parts.append((part_number, etag))
                
                logger.info(
                    f"Uploaded part {part_number}/{(file_size + self.multipart_chunksize - 1) // self.multipart_chunksize} "
                    f"for {key} ({chunk_size} bytes)"
                )
                
                offset += chunk_size
                part_number += 1
            
            # 3. 完成分片上传
            result = await self.complete_multipart_upload(key, upload_id, parts)
            
            logger.info(f"Multipart upload completed for {key} ({file_size} bytes)")
            
            return FileUploadResponse(
                key=key,
                bucket=self.bucket_name,
                size=file_size,
                etag=result.etag,
                content_type=content_type,
            )
            
        except Exception as e:
            # 如果上传失败，取消分片上传
            if upload_id:
                try:
                    await self.abort_multipart_upload(key, upload_id)
                    logger.info(f"Aborted multipart upload for {key}: {upload_id}")
                except Exception as abort_error:
                    logger.error(f"Failed to abort multipart upload for {key}: {abort_error}")
            
            # 重新抛出原始错误
            raise S3OperationError(f"Multipart upload failed for {key}: {e}")

    async def upload_files_batch(
        self, files: list[tuple[str, bytes, str | None]]
    ) -> list[tuple[str, bool, str | None, FileUploadResponse | None]]:
        """
        批量上传文件

        Args:
            files: 文件列表 [(key, content, content_type), ...]

        Returns:
            list: 每个文件的结果 [(key, success, message, response), ...]
        """
        results = []

        for key, content, content_type in files:
            try:
                response = await self.upload_file(key, content, content_type)
                results.append((key, True, None, response))
            except S3Error as e:
                results.append((key, False, str(e), None))
            except Exception as e:
                logger.error(f"Unexpected error uploading {key}: {e}")
                results.append((key, False, f"Unexpected error: {e}", None))

        return results

    # ============= 文件下载 =============

    async def download_file(self, key: str) -> bytes:
        """
        下载文件并返回完整内容

        Args:
            key: S3 对象键

        Returns:
            bytes: 文件内容

        Raises:
            S3FileNotFoundError: 文件不存在
            S3OperationError: 下载失败
        """
        try:
            response = await self._run_sync(
                self.client.get_object,
                Bucket=self.bucket_name,
                Key=key
            )
            
            # 读取完整内容
            content = await self._run_sync(response["Body"].read)
            
            logger.info(f"File downloaded successfully: {key} ({len(content)} bytes)")
            return content

        except ClientError as e:
            self._handle_client_error(e, "download_file")
            raise

    async def download_file_stream(
        self, key: str, chunk_size: int = 8192
    ) -> AsyncIterator[bytes]:
        """
        流式下载文件

        Args:
            key: S3 对象键
            chunk_size: 每块大小

        Yields:
            bytes: 文件数据块

        Raises:
            S3FileNotFoundError: 文件不存在
            S3OperationError: 下载失败
        """

        def _get_response():
            """获取 S3 响应"""
            return self.client.get_object(Bucket=self.bucket_name, Key=key)

        try:
            # 在线程池中获取响应
            response = await self._run_sync(_get_response)
            stream = response["Body"]

            try:
                # 逐块读取数据
                while True:
                    chunk = await self._run_sync(stream.read, chunk_size)
                    if not chunk:
                        break
                    yield chunk
            finally:
                stream.close()

            logger.info(f"File downloaded successfully: {key}")

        except ClientError as e:
            self._handle_client_error(e, "download_file")
            raise

    # ============= 文件存在性检查 =============

    async def file_exists(self, key: str) -> bool:
        """
        检查文件是否存在

        Args:
            key: S3 对象键

        Returns:
            bool: 文件是否存在
        """
        try:
            await self._run_sync(
                self.client.head_object, Bucket=self.bucket_name, Key=key
            )
            return True
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            if error_code in ["404", "NoSuchKey"]:
                return False
            logger.error(f"Error checking file existence for {key}: {e}")
            return False

    # ============= 文件删除 =============

    async def delete_file(self, key: str) -> None:
        """
        删除单个文件

        Args:
            key: S3 对象键

        Raises:
            S3FileNotFoundError: 文件不存在
            S3OperationError: 删除失败
        """
        # 先检查文件是否存在
        if not await self.file_exists(key):
            raise S3FileNotFoundError(key)

        try:
            await self._run_sync(
                self.client.delete_object, Bucket=self.bucket_name, Key=key
            )
            logger.info(f"File deleted successfully: {key}")

        except ClientError as e:
            self._handle_client_error(e, "delete_file")
            raise

    async def delete_files_batch(self, keys: list[str]) -> list[BatchDeleteResult]:
        """
        批量删除文件

        Args:
            keys: 要删除的键列表

        Returns:
            list[BatchDeleteResult]: 每个文件的删除结果
        """
        results = []

        for key in keys:
            try:
                await self.delete_file(key)
                results.append(BatchDeleteResult(key=key, success=True, message=None))
            except S3FileNotFoundError:
                results.append(
                    BatchDeleteResult(key=key, success=False, message="File not found")
                )
            except S3Error as e:
                results.append(
                    BatchDeleteResult(key=key, success=False, message=str(e))
                )
            except Exception as e:
                logger.error(f"Unexpected error deleting {key}: {e}")
                results.append(
                    BatchDeleteResult(
                        key=key, success=False, message=f"Unexpected error: {e}"
                    )
                )

        return results

    # ============= 文件列表 =============

    async def list_files(
        self,
        prefix: str = "",
        delimiter: str | None = None,
        max_keys: int = 1000,
        continuation_token: str | None = None,
    ) -> tuple[list[FileListItem], list[str], str | None, bool]:
        """
        列出文件

        Args:
            prefix: 键前缀
            delimiter: 分隔符(用于模拟文件夹)
            max_keys: 最大返回数量
            continuation_token: 分页 token

        Returns:
            tuple: (文件列表, 公共前缀列表, 下一页token, 是否截断)
        """
        try:
            kwargs = {
                "Bucket": self.bucket_name,
                "Prefix": prefix,
                "MaxKeys": max_keys,
            }

            if delimiter:
                kwargs["Delimiter"] = delimiter
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token

            response = await self._run_sync(self.client.list_objects_v2, **kwargs)

            # 解析文件列表
            files = []
            for obj in response.get("Contents", []):
                files.append(
                    FileListItem(
                        key=obj["Key"],
                        size=obj["Size"],
                        last_modified=obj["LastModified"],
                        etag=obj["ETag"].strip('"'),
                    )
                )

            # 解析公共前缀(文件夹)
            common_prefixes = [
                cp["Prefix"] for cp in response.get("CommonPrefixes", [])
            ]

            # 分页信息
            next_token = response.get("NextContinuationToken")
            is_truncated = response.get("IsTruncated", False)

            return files, common_prefixes, next_token, is_truncated

        except ClientError as e:
            self._handle_client_error(e, "list_files")
            raise

    # ============= 文件元信息 =============

    async def get_file_metadata(self, key: str) -> FileMetadata:
        """
        获取文件元信息

        Args:
            key: S3 对象键

        Returns:
            FileMetadata: 文件元信息

        Raises:
            S3FileNotFoundError: 文件不存在
            S3OperationError: 获取失败
        """
        try:
            response = await self._run_sync(
                self.client.head_object, Bucket=self.bucket_name, Key=key
            )

            return FileMetadata(
                key=key,
                bucket=self.bucket_name,
                size=response["ContentLength"],
                etag=response["ETag"].strip('"'),
                last_modified=response["LastModified"],
                content_type=response.get("ContentType"),
                metadata=response.get("Metadata", {}),
            )

        except ClientError as e:
            self._handle_client_error(e, "get_file_metadata")
            raise

    # ============= 预签名 URL =============

    async def generate_presigned_upload_url(
        self, key: str, expires_in: int = 3600, content_type: str | None = None
    ) -> str:
        """
        生成上传预签名 URL

        Args:
            key: 目标对象键
            expires_in: 过期时间(秒)
            content_type: 限制的文件类型

        Returns:
            str: 预签名 URL
        """
        try:
            params = {"Bucket": self.bucket_name, "Key": key}

            if content_type:
                params["ContentType"] = content_type

            url = await self._run_sync(
                self.client.generate_presigned_url,
                ClientMethod="put_object",
                Params=params,
                ExpiresIn=expires_in,
            )

            logger.info(f"Generated presigned upload URL for: {key}")
            return url

        except ClientError as e:
            self._handle_client_error(e, "generate_presigned_upload_url")
            raise

    async def generate_presigned_download_url(
        self,
        key: str,
        expires_in: int = 3600,
        response_content_disposition: str | None = None,
    ) -> str:
        """
        生成下载预签名 URL

        Args:
            key: 对象键
            expires_in: 过期时间(秒)
            response_content_disposition: 响应的 Content-Disposition 头

        Returns:
            str: 预签名 URL
        """
        try:
            params = {"Bucket": self.bucket_name, "Key": key}

            if response_content_disposition:
                params["ResponseContentDisposition"] = response_content_disposition

            url = await self._run_sync(
                self.client.generate_presigned_url,
                ClientMethod="get_object",
                Params=params,
                ExpiresIn=expires_in,
            )

            logger.info(f"Generated presigned download URL for: {key}")
            return url

        except ClientError as e:
            self._handle_client_error(e, "generate_presigned_download_url")
            raise

    # ============= 分片上传 =============

    async def create_multipart_upload(
        self,
        key: str,
        content_type: str | None = None,
        metadata: dict[str, str] | None = None,
    ) -> str:
        """
        创建分片上传

        Args:
            key: 目标对象键
            content_type: 文件类型
            metadata: 自定义元数据

        Returns:
            str: 上传会话 ID

        Raises:
            S3OperationError: 创建失败
        """
        try:
            kwargs = {"Bucket": self.bucket_name, "Key": key}

            if content_type:
                kwargs["ContentType"] = content_type
            if metadata:
                kwargs["Metadata"] = metadata

            response = await self._run_sync(
                self.client.create_multipart_upload, **kwargs
            )
            upload_id = response["UploadId"]

            logger.info(f"Created multipart upload for {key}: {upload_id}")
            return upload_id

        except ClientError as e:
            self._handle_client_error(e, "create_multipart_upload")
            raise

    async def upload_part(
        self, key: str, upload_id: str, part_number: int, data: bytes
    ) -> str:
        """
        上传单个分片

        Args:
            key: 对象键
            upload_id: 上传会话 ID
            part_number: 分片编号
            data: 分片数据

        Returns:
            str: 分片 ETag

        Raises:
            S3InvalidPartSizeError: 分片大小无效
            S3MultipartError: 上传失败
        """
        part_size = len(data)

        # 分片大小验证(最后一个分片除外)
        min_part_size = 5 * 1024 * 1024  # 5MB
        if part_size < min_part_size:
            # 注意: 这里简化处理,实际应用中最后一个分片可以小于 5MB
            logger.warning(
                f"Part {part_number} size {part_size} is less than {min_part_size} bytes"
            )

        try:
            response = await self._run_sync(
                self.client.upload_part,
                Bucket=self.bucket_name,
                Key=key,
                UploadId=upload_id,
                PartNumber=part_number,
                Body=data,
            )

            etag = response["ETag"].strip('"')
            logger.info(f"Uploaded part {part_number} for {key}: {etag}")
            return etag

        except ClientError as e:
            logger.error(f"Failed to upload part {part_number} for {key}: {e}")
            raise S3MultipartError(f"Failed to upload part {part_number}: {e}")

    async def complete_multipart_upload(
        self, key: str, upload_id: str, parts: list[tuple[int, str]]
    ) -> MultipartCompleteResponse:
        """
        完成分片上传

        Args:
            key: 对象键
            upload_id: 上传会话 ID
            parts: 分片列表 [(part_number, etag), ...]

        Returns:
            MultipartCompleteResponse: 完成响应

        Raises:
            S3MultipartError: 完成失败
        """
        try:
            multipart_upload = {
                "Parts": [
                    {"PartNumber": part_num, "ETag": etag} for part_num, etag in parts
                ]
            }

            response = await self._run_sync(
                self.client.complete_multipart_upload,
                Bucket=self.bucket_name,
                Key=key,
                UploadId=upload_id,
                MultipartUpload=multipart_upload,
            )

            logger.info(f"Completed multipart upload for {key}")

            # 获取文件大小
            try:
                metadata = await self.get_file_metadata(key)
                file_size = metadata.size
            except Exception:
                file_size = None

            return MultipartCompleteResponse(
                key=key,
                bucket=self.bucket_name,
                etag=response["ETag"].strip('"'),
                size=file_size,
            )

        except ClientError as e:
            logger.error(f"Failed to complete multipart upload for {key}: {e}")
            raise S3MultipartError(f"Failed to complete multipart upload: {e}")

    async def abort_multipart_upload(self, key: str, upload_id: str) -> None:
        """
        取消分片上传

        Args:
            key: 对象键
            upload_id: 上传会话 ID

        Raises:
            S3MultipartError: 取消失败
        """
        try:
            await self._run_sync(
                self.client.abort_multipart_upload,
                Bucket=self.bucket_name,
                Key=key,
                UploadId=upload_id,
            )

            logger.info(f"Aborted multipart upload for {key}: {upload_id}")

        except ClientError as e:
            logger.error(f"Failed to abort multipart upload for {key}: {e}")
            raise S3MultipartError(f"Failed to abort multipart upload: {e}")

    async def list_multipart_uploads(
        self, prefix: str = "", max_uploads: int = 1000
    ) -> tuple[list[MultipartUploadListItem], str | None]:
        """
        列出进行中的分片上传

        Args:
            prefix: 键前缀
            max_uploads: 最大返回数量

        Returns:
            tuple: (上传列表, 下一页token)
        """
        try:
            response = await self._run_sync(
                self.client.list_multipart_uploads,
                Bucket=self.bucket_name,
                Prefix=prefix,
                MaxUploads=max_uploads,
            )

            uploads = []
            for upload in response.get("Uploads", []):
                uploads.append(
                    MultipartUploadListItem(
                        key=upload["Key"],
                        upload_id=upload["UploadId"],
                        initiated=upload["Initiated"],
                    )
                )

            next_token = response.get("NextKeyMarker")
            return uploads, next_token

        except ClientError as e:
            self._handle_client_error(e, "list_multipart_uploads")
            raise

    async def list_parts(
        self, key: str, upload_id: str, max_parts: int = 1000
    ) -> tuple[list[MultipartPartListItem], int | None]:
        """
        列出已上传的分片

        Args:
            key: 对象键
            upload_id: 上传会话 ID
            max_parts: 最大返回数量

        Returns:
            tuple: (分片列表, 下一页分片编号标记)
        """
        try:
            response = await self._run_sync(
                self.client.list_parts,
                Bucket=self.bucket_name,
                Key=key,
                UploadId=upload_id,
                MaxParts=max_parts,
            )

            parts = []
            for part in response.get("Parts", []):
                parts.append(
                    MultipartPartListItem(
                        part_number=part["PartNumber"],
                        size=part["Size"],
                        etag=part["ETag"].strip('"'),
                        last_modified=part["LastModified"],
                    )
                )

            next_marker = response.get("NextPartNumberMarker")
            return parts, next_marker

        except ClientError as e:
            self._handle_client_error(e, "list_parts")
            raise


# 创建全局服务实例
s3_service = S3Service()
