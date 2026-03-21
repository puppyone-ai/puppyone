"""S3 存储模块的自定义异常类型"""


class S3Error(Exception):
    """S3 操作基础异常"""

    def __init__(self, message: str, details: dict | None = None):
        self.message = message
        self.details = details or {}
        super().__init__(self.message)


class S3FileNotFoundError(S3Error):
    """文件未找到异常"""

    def __init__(self, key: str):
        super().__init__(f"File not found: {key}", {"key": key})
        self.key = key


class S3OperationError(S3Error):
    """S3 操作失败异常"""

    pass


class S3FileSizeExceededError(S3Error):
    """文件大小超限异常"""

    def __init__(self, size: int, max_size: int):
        super().__init__(
            f"File size {size} bytes exceeds maximum allowed size {max_size} bytes",
            {"size": size, "max_size": max_size},
        )
        self.size = size
        self.max_size = max_size


class S3MultipartError(S3Error):
    """分片上传异常"""

    pass


class S3InvalidPartSizeError(S3MultipartError):
    """分片大小无效异常"""

    def __init__(self, part_number: int, size: int, min_size: int):
        super().__init__(
            f"Part {part_number} size {size} bytes is less than minimum {min_size} bytes",
            {"part_number": part_number, "size": size, "min_size": min_size},
        )
