import traceback
from functools import wraps
from Utils.logger import log_error, log_info

class PuppyException(Exception):
    """自定义异常类，用于PuppyEngine服务中的错误处理
    
    用法:
        raise PuppyException(6001, "Invalid Input", "Parameter 'x' is missing")
    
    属性:
        error_code (int): 错误代码
        error_message (str): 错误消息
        cause (str, optional): 错误原因
        
    注意:
        为了API便利性，同时支持以下两种属性访问方式:
        - e.error_code / e.error_message (完整名称)
        - e.code / e.message (简化别名)
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
        
        # 移除直接赋值，防止与属性装饰器冲突,属性访问会通过下面定义的装饰器方法自动处理
        
        self.raise_message = f"[{self.service_name.upper()}_ERROR_{self.error_code}]: {self.error_message}!"
        if self.cause:
            self.raise_message += f"\nCause: {self.cause}"
        super().__init__(self.raise_message)
    
    # 使用属性装饰器提供别名访问
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
    """全局异常处理装饰器
    
    用法:
        @global_exception_handler(6001, "Process failed")
        def some_function():
            ...
    
    参数:
        error_code (int): 当捕获非PuppyException时要使用的错误代码
        error_message (str): 当捕获非PuppyException时要使用的错误消息
        log_at_root (bool): 是否在此级别记录异常，通常只在顶层调用处设为True
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