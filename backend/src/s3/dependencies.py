"""S3 存储模块的依赖注入"""

from fastapi import Depends, HTTPException, Path
from typing import Annotated

from src.s3.service import S3Service, get_s3_service_instance
from src.s3.schemas import FileMetadata
from src.s3.exceptions import S3Error, S3FileNotFoundError


def get_s3_service() -> S3Service:
    """
    获取 S3 服务实例

    Returns:
        S3Service: S3 服务单例
    """
    return get_s3_service_instance()


async def valid_s3_key(
    key: Annotated[str, Path(description="S3 对象键")],
    service: S3Service = Depends(get_s3_service),
) -> str:
    """
    验证 S3 对象键格式

    Args:
        key: S3 对象键
        service: S3 服务实例

    Returns:
        str: 验证通过的 key

    Raises:
        HTTPException: key 格式无效时
    """
    # 基本格式验证
    if not key or key.startswith("/") or key.endswith("/"):
        raise HTTPException(
            status_code=400,
            detail={"error": "InvalidKey", "message": "Invalid S3 key format"},
        )

    return key


async def existing_s3_file(
    key: str = Depends(valid_s3_key),
    service: S3Service = Depends(get_s3_service),
) -> FileMetadata:
    """
    验证文件存在并返回元信息

    Args:
        key: S3 对象键
        service: S3 服务实例

    Returns:
        FileMetadata: 文件元信息

    Raises:
        HTTPException: 文件不存在或获取失败时
    """
    try:
        metadata = await service.get_file_metadata(key)
        return metadata
    except S3FileNotFoundError as e:
        raise HTTPException(
            status_code=404, detail={"error": "FileNotFound", "message": str(e)}
        )
    except S3Error as e:
        raise HTTPException(
            status_code=500, detail={"error": "S3Error", "message": str(e)}
        )


async def validate_file_size(
    file_size: int,
    service: S3Service = Depends(get_s3_service),
) -> int:
    """
    验证文件大小是否在限制内

    Args:
        file_size: 文件大小(字节)
        service: S3 服务实例

    Returns:
        int: 验证通过的文件大小

    Raises:
        HTTPException: 文件大小超限时
    """
    if file_size > service.max_file_size:
        raise HTTPException(
            status_code=413,
            detail={
                "error": "PayloadTooLarge",
                "message": f"File size {file_size} exceeds maximum {service.max_file_size} bytes",
                "max_size": service.max_file_size,
            },
        )

    return file_size


async def validate_batch_keys_count(
    keys: list[str],
    max_count: int = 1000,
) -> list[str]:
    """
    验证批量操作的键数量

    Args:
        keys: 键列表
        max_count: 最大允许数量

    Returns:
        list[str]: 验证通过的键列表

    Raises:
        HTTPException: 键数量超限时
    """
    if len(keys) > max_count:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum {max_count} keys allowed per batch, got {len(keys)}",
        )

    if not keys:
        raise HTTPException(status_code=400, detail="At least one key is required")

    return keys


async def validate_presigned_url_expiry(expires_in: int) -> int:
    """
    验证预签名 URL 过期时间

    Args:
        expires_in: 过期时间(秒)

    Returns:
        int: 验证通过的过期时间

    Raises:
        HTTPException: 过期时间无效时
    """
    if expires_in < 1 or expires_in > 86400:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "InvalidExpiryTime",
                "message": "Expiry time must be between 1 and 86400 seconds",
            },
        )

    return expires_in


async def validate_multipart_part_number(part_number: int) -> int:
    """
    验证分片编号

    Args:
        part_number: 分片编号

    Returns:
        int: 验证通过的分片编号

    Raises:
        HTTPException: 分片编号无效时
    """
    if part_number < 1 or part_number > 10000:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "InvalidPartNumber",
                "message": "Part number must be between 1 and 10000",
            },
        )

    return part_number
