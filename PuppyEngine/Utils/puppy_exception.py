"""
Exception Handling

Custom exception classes and decorators for PuppyEngine error handling.
"""

import traceback
from functools import wraps

from Utils.logger import log_error


class PuppyException(Exception):
    """
    Custom exception class for PuppyEngine error handling
    
    Usage:
        raise PuppyException(6001, "Invalid Input", "Parameter 'x' is missing")
    
    Attributes:
        error_code (int): Error code identifier
        error_message (str): Error message description
        cause (str, optional): Underlying cause of the error
        
    Note:
        For API convenience, supports both attribute access patterns:
        - e.error_code / e.error_message (full names)
        - e.code / e.message (aliases)
    """
    
    service_name = "puppyengine"  
    
    def __init__(
        self,
        error_code: int,
        error_message: str,
        cause: str = None
    ):
        self.error_code = error_code
        self.error_message = error_message
        self.cause = cause
        
        self.raise_message = f"[{self.service_name.upper()}_ERROR_{self.error_code}]: {self.error_message}!"
        if self.cause:
            self.raise_message += f"\nCause: {self.cause}"
        super().__init__(self.raise_message)
    
    # Property decorators for alias access
    @property
    def code(self):
        return self.error_code
    
    @code.setter
    def code(self, value):
        self.error_code = value
    
    @property
    def message(self):
        return self.error_message
    
    @message.setter
    def message(self, value):
        self.error_message = value


def global_exception_handler(
    error_code: int,
    error_message: str,
    log_at_root: bool = False
):
    """
    Global exception handling decorator
    
    Usage:
        @global_exception_handler(6001, "Process failed")
        def some_function():
            ...
    
    Args:
        error_code: Error code to use when catching non-PuppyException errors
        error_message: Error message to use when catching non-PuppyException errors
        log_at_root: Whether to log exception at this level (typically True only at top level)
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except PuppyException as e:
                # Propagate the error without re-logging
                if not log_at_root:
                    raise
                tb_str = traceback.format_exc()
                full_error_message = f"{str(e)}\nTraceback:\n{tb_str}"
                log_error(full_error_message)
                raise
            except Exception as e:
                # Wrap and propagate the exception, logging only at root level
                if not log_at_root:
                    raise PuppyException(error_code, error_message, str(e))
                tb_str = traceback.format_exc()
                full_error_message = f"[{PuppyException.service_name.upper()}_ERROR_{error_code}]: {error_message}\nCause: {str(e)}\nTraceback:\n{tb_str}"
                log_error(full_error_message)
                raise PuppyException(error_code, error_message, str(e))
        return wrapper
    return decorator