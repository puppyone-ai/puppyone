import logging
import traceback
from functools import wraps


class PuppyException(Exception):
    service_name = "puppystorage"  
    
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


def global_exception_handler(
    error_code: int,
    error_message: str
):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except puppy_exception as e:
                tb_str = traceback.format_exc()
                full_error_message = f"{str(e)}\nTraceback:\n{tb_str}"
                logging.error(full_error_message)
                raise
            except Exception as e:
                tb_str = traceback.format_exc()
                full_error_message = f"[{puppy_exception.service_name.upper()}_ERROR_{error_code}]: {error_message}\nCause: {str(e)}\nTraceback:\n{tb_str}"
                logging.error(full_error_message)
                raise puppy_exception(error_code, error_message, str(e))
        return wrapper
    return decorator
