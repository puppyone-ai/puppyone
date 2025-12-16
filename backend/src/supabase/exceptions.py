"""
Supabase 异常处理

定义 Supabase 相关的自定义异常。
"""

from postgrest.exceptions import APIError
from src.exceptions import BusinessException, ErrorCode


class SupabaseException(BusinessException):
    """Supabase 基础异常"""

    def __init__(self, message: str, original_error: Exception = None):
        super().__init__(message=message, code=ErrorCode.BAD_REQUEST)
        self.original_error = original_error


class SupabaseDuplicateKeyError(SupabaseException):
    """主键冲突错误"""

    def __init__(self, table: str, key: str, value: any, original_error: Exception = None):
        message = f"记录已存在: 表 '{table}' 中已存在 {key}={value} 的记录"
        super().__init__(message=message, original_error=original_error)
        self.table = table
        self.key = key
        self.value = value


class SupabaseNotFoundError(SupabaseException):
    """记录不存在错误"""

    def __init__(self, table: str, key: str, value: any):
        message = f"记录不存在: 表 '{table}' 中不存在 {key}={value} 的记录"
        super().__init__(message=message)
        self.table = table
        self.key = key
        self.value = value


class SupabaseForeignKeyError(SupabaseException):
    """外键约束错误"""

    def __init__(self, message: str, original_error: Exception = None):
        super().__init__(message=message, original_error=original_error)


def handle_supabase_error(error: Exception, operation: str = "操作") -> SupabaseException:
    """
    处理 Supabase API 错误，转换为友好的异常

    Args:
        error: 原始异常
        operation: 操作描述

    Returns:
        转换后的异常
    """
    if isinstance(error, APIError):
        # APIError 的错误信息在 args[0] 中，是一个字典
        error_dict = error.args[0] if error.args and isinstance(error.args[0], dict) else {}
        error_code = error_dict.get("code", "")
        error_message = error_dict.get("message", str(error))
        details = error_dict.get("details", "") or ""
        hint = error_dict.get("hint", "") or ""

        # 处理主键冲突 (23505)
        if error_code == "23505":
            import re
            # 键信息通常在 details 字段中，格式: "Key (id)=(1) already exists."
            # 也可能在 error_message 中
            key_info = details if details else error_message
            
            # 尝试提取键名和值
            match = re.search(r'Key \(([^)]+)\)=\(([^)]+)\)', key_info)
            if match:
                key_name = match.group(1)
                key_value = match.group(2)
                
                # 从 error_message 中提取表名（通常在约束名称中）
                # 例如: 'duplicate key value violates unique constraint "table_pkey"'
                table_match = re.search(r'"([^"]+)_pkey"', error_message)
                if table_match:
                    table_name = table_match.group(1)
                else:
                    # 尝试从其他位置提取表名
                    table_match = re.search(r'table "([^"]+)"', error_message + details + hint)
                    table_name = table_match.group(1) if table_match else "unknown"
                
                return SupabaseDuplicateKeyError(
                    table=table_name,
                    key=key_name,
                    value=key_value,
                    original_error=error,
                )
            
            # 如果无法解析，返回通用错误
            return SupabaseDuplicateKeyError(
                table="unknown",
                key="id",
                value="unknown",
                original_error=error,
            )

        # 处理外键约束 (23503)
        if error_code == "23503":
            return SupabaseForeignKeyError(
                message=f"外键约束错误: {error_message}",
                original_error=error,
            )

        # 其他数据库错误
        return SupabaseException(
            message=f"{operation}失败: {error_message}",
            original_error=error,
        )

    # 非 APIError 异常，直接包装
    return SupabaseException(
        message=f"{operation}失败: {str(error)}",
        original_error=error,
    )
