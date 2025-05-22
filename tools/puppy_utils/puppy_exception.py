import traceback
from functools import wraps
from tools.puppy_utils.logger import log_error, log_info

class PuppyException(Exception):
    """自定义异常类，用于Puppy服务中的错误处理
    
    用法:
        raise PuppyException(6001, "Invalid Input", "Parameter 'x' is missing", service_name="puppyengine")
    
    属性:
        error_code (int): 错误代码
        error_message (str): 错误消息
        cause (str, optional): 错误原因
        service_name (str): 服务名称，用于区分不同服务的错误
    """
    
    # 默认服务名称
    service_name = "puppy"  
    
    def __init__(
        self,
        error_code: int,
        error_message: str,
        cause: str = None,
        service_name: str = None
    ):
        self.error_code = error_code
        self.error_message = error_message
        self.cause = cause
        
        # 如果提供了服务名称，则使用它，否则使用类的默认值
        self._service_name = service_name or self.__class__.service_name
        
        self.raise_message = f"[{self._service_name.upper()}_ERROR_{self.error_code}]: {self.error_message}!"
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
        
    @property
    def service(self):
        return self._service_name
    
    @service.setter
    def service(self, value):
        self._service_name = value


def global_exception_handler(
    error_code: int,
    error_message: str,
    log_at_root: bool = False,
    service_name: str = None
):
    """全局异常处理装饰器
    
    用法:
        @global_exception_handler(6001, "Process failed", service_name="puppyengine")
        def some_function():
            ...
    
    参数:
        error_code (int): 当捕获非PuppyException时要使用的错误代码
        error_message (str): 当捕获非PuppyException时要使用的错误消息
        log_at_root (bool): 是否在此级别记录异常，通常只在顶层调用处设为True
        service_name (str): 服务名称，用于标识异常来源
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except PuppyException as e:
                # 不重新记录，直接传播错误
                if not log_at_root:
                    raise
                tb_str = traceback.format_exc()
                full_error_message = f"{str(e)}\nTraceback:\n{tb_str}"
                log_error(full_error_message)
                raise
            except Exception as e:
                # 包装并传播异常，仅在根级别记录
                if not log_at_root:
                    raise PuppyException(error_code, error_message, str(e), service_name)
                tb_str = traceback.format_exc()
                service = service_name or PuppyException.service_name
                full_error_message = f"[{service.upper()}_ERROR_{error_code}]: {error_message}\nCause: {str(e)}\nTraceback:\n{tb_str}"
                log_error(full_error_message)
                raise PuppyException(error_code, error_message, str(e), service_name)
        return wrapper
    return decorator


# 为特定服务创建异常类
class PuppyEngineException(PuppyException):
    """PuppyEngine 服务专用异常类"""
    service_name = "puppyengine"
    
    
class PuppyStorageException(PuppyException):
    """PuppyStorage 服务专用异常类"""
    service_name = "puppystorage" 