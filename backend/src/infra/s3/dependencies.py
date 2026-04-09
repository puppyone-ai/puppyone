"""S3 storage module dependency injection"""

from fastapi import Depends, HTTPException, Path
from typing import Annotated

from src.infra.s3.service import S3Service, get_s3_service_instance
from src.infra.s3.schemas import FileMetadata
from src.infra.s3.exceptions import S3Error, S3FileNotFoundError


def get_s3_service() -> S3Service:
    """
    Get S3 service instance.

    Returns:
        S3Service: S3 service singleton
    """
    return get_s3_service_instance()


async def valid_s3_key(
    key: Annotated[str, Path(description="S3 object key")],
    service: S3Service = Depends(get_s3_service),
) -> str:
    """
    Validate S3 object key format.

    Args:
        key: S3 object key
        service: S3 service instance

    Returns:
        str: Validated key

    Raises:
        HTTPException: When key format is invalid
    """
    # Basic format validation
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
    Verify file exists and return its metadata.

    Args:
        key: S3 object key
        service: S3 service instance

    Returns:
        FileMetadata: File metadata

    Raises:
        HTTPException: When file does not exist or retrieval fails
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
    Validate that file size is within limits.

    Args:
        file_size: File size in bytes
        service: S3 service instance

    Returns:
        int: Validated file size

    Raises:
        HTTPException: When file size exceeds the limit
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
    Validate the number of keys in a batch operation.

    Args:
        keys: List of keys
        max_count: Maximum allowed count

    Returns:
        list[str]: Validated list of keys

    Raises:
        HTTPException: When key count exceeds the limit
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
    Validate presigned URL expiration time.

    Args:
        expires_in: Expiration time in seconds

    Returns:
        int: Validated expiration time

    Raises:
        HTTPException: When expiration time is invalid
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
    Validate multipart part number.

    Args:
        part_number: Part number

    Returns:
        int: Validated part number

    Raises:
        HTTPException: When part number is invalid
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
