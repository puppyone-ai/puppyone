"""
Supabase exception handling.

Defines custom exceptions related to Supabase.
"""

from postgrest.exceptions import APIError
from src.exceptions import BusinessException, ErrorCode


class SupabaseException(BusinessException):
    """Supabase base exception"""

    def __init__(self, message: str, original_error: Exception = None):
        super().__init__(message=message, code=ErrorCode.BAD_REQUEST)
        self.original_error = original_error


class SupabaseDuplicateKeyError(SupabaseException):
    """Primary key conflict error"""

    def __init__(
        self, table: str, key: str, value: any, original_error: Exception = None
    ):
        message = f"Record already exists: table '{table}' already has a record with {key}={value}"
        super().__init__(message=message, original_error=original_error)
        self.table = table
        self.key = key
        self.value = value


class SupabaseNotFoundError(SupabaseException):
    """Record not found error"""

    def __init__(self, table: str, key: str, value: any):
        message = f"Record not found: table '{table}' has no record with {key}={value}"
        super().__init__(message=message)
        self.table = table
        self.key = key
        self.value = value


class SupabaseForeignKeyError(SupabaseException):
    """Foreign key constraint error"""

    def __init__(self, message: str, original_error: Exception = None):
        super().__init__(message=message, original_error=original_error)


def handle_supabase_error(
    error: Exception, operation: str = "operation"
) -> SupabaseException:
    """
    Handle Supabase API errors and convert them to user-friendly exceptions.

    Args:
        error: Original exception
        operation: Operation description

    Returns:
        Converted exception
    """
    if isinstance(error, APIError):
        # APIError's error info is in args[0], which is a dict
        error_dict = (
            error.args[0] if error.args and isinstance(error.args[0], dict) else {}
        )
        error_code = error_dict.get("code", "")
        error_message = error_dict.get("message", str(error))
        details = error_dict.get("details", "") or ""
        hint = error_dict.get("hint", "") or ""

        # Handle primary key conflict (23505)
        if error_code == "23505":
            import re

            # Key info is usually in the details field, format: "Key (id)=(1) already exists."
            # It may also be in error_message
            key_info = details if details else error_message

            # Try to extract key name and value
            match = re.search(r"Key \(([^)]+)\)=\(([^)]+)\)", key_info)
            if match:
                key_name = match.group(1)
                key_value = match.group(2)

                # Extract table name from error_message (usually in constraint name)
                # e.g.: 'duplicate key value violates unique constraint "table_pkey"'
                table_match = re.search(r'"([^"]+)_pkey"', error_message)
                if table_match:
                    table_name = table_match.group(1)
                else:
                    # Try to extract table name from other locations
                    table_match = re.search(
                        r'table "([^"]+)"', error_message + details + hint
                    )
                    table_name = table_match.group(1) if table_match else "unknown"

                return SupabaseDuplicateKeyError(
                    table=table_name,
                    key=key_name,
                    value=key_value,
                    original_error=error,
                )

            # If unable to parse, return a generic error
            return SupabaseDuplicateKeyError(
                table="unknown",
                key="id",
                value="unknown",
                original_error=error,
            )

        # Handle foreign key constraint (23503)
        if error_code == "23503":
            return SupabaseForeignKeyError(
                message=f"Foreign key constraint error: {error_message}",
                original_error=error,
            )

        # Other database errors
        return SupabaseException(
            message=f"{operation} failed: {error_message}",
            original_error=error,
        )

    # Non-APIError exceptions, wrap directly
    return SupabaseException(
        message=f"{operation} failed: {str(error)}",
        original_error=error,
    )
