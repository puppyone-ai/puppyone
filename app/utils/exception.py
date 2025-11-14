import traceback
from functools import wraps
from app.utils.logger import log_error, log_info

class PuppyException(Exception):
    service_name = "contextbase"  
    
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
    error_message: str,
    log_at_root: bool = False
):
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
