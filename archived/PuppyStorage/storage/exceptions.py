"""
存储相关的自定义异常定义
"""

class StorageException(Exception):
    """存储操作的基础异常类"""
    pass

class ConditionFailedError(StorageException):
    """
    当条件写入操作因ETag不匹配而失败时抛出
    用于实现乐观锁机制
    """
    pass

class FileNotFoundError(StorageException):
    """文件不存在时抛出"""
    pass

class MultipartUploadError(StorageException):
    """分块上传相关错误"""
    pass
 