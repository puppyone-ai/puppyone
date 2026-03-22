"""S3 storage module custom exception types"""


class S3Error(Exception):
    """S3 operation base exception"""

    def __init__(self, message: str, details: dict | None = None):
        self.message = message
        self.details = details or {}
        super().__init__(self.message)


class S3FileNotFoundError(S3Error):
    """File not found exception"""

    def __init__(self, key: str):
        super().__init__(f"File not found: {key}", {"key": key})
        self.key = key


class S3OperationError(S3Error):
    """S3 operation failure exception"""

    pass


class S3FileSizeExceededError(S3Error):
    """File size exceeded exception"""

    def __init__(self, size: int, max_size: int):
        super().__init__(
            f"File size {size} bytes exceeds maximum allowed size {max_size} bytes",
            {"size": size, "max_size": max_size},
        )
        self.size = size
        self.max_size = max_size


class S3MultipartError(S3Error):
    """Multipart upload exception"""

    pass


class S3InvalidPartSizeError(S3MultipartError):
    """Invalid part size exception"""

    def __init__(self, part_number: int, size: int, min_size: int):
        super().__init__(
            f"Part {part_number} size {size} bytes is less than minimum {min_size} bytes",
            {"part_number": part_number, "size": size, "min_size": min_size},
        )
