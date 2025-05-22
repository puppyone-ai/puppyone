import logging
import warnings
from axiom_py import Client
from tools.puppy_utils.config import config, ENV, DEFAULT_LOG_LEVEL

# 将字符串日志级别转换为 logging 常量
LOG_LEVEL_CONST = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
    "CRITICAL": logging.CRITICAL
}

# 根据环境配置基本日志
logging.basicConfig(level=LOG_LEVEL_CONST.get(DEFAULT_LOG_LEVEL, logging.INFO))

class Logger:
    """
    优化的日志类，支持两种模式:
    - default: 同时记录到 Axiom 和终端
    - local: 仅记录到终端
    
    支持多个服务共享同一套日志代码，通过 service_name 区分
    """
    
    def __init__(self, service_name="puppy", mode="default", log_level=None):
        """
        初始化 Logger 实例
        
        Args:
            service_name: 服务名称
            mode: 日志模式 ('default' 或 'local')
            log_level: 日志级别，如果为 None 则使用根据环境确定的默认级别
        """
        self.mode = mode
        self.service_name = service_name
        self.logger = logging.getLogger(service_name)
        
        # 如果没有指定级别，使用根据环境确定的默认级别
        if log_level is None:
            log_level = LOG_LEVEL_CONST.get(DEFAULT_LOG_LEVEL, logging.INFO)
        
        self.logger.setLevel(log_level)
        
        # 根据环境添加额外的日志格式
        if ENV == "development":
            # 开发环境添加更详细的信息
            formatter = logging.Formatter('%(asctime)s [%(levelname)s] [%(name)s] %(message)s')
            for handler in self.logger.handlers:
                handler.setFormatter(formatter)
        
        # 根据模式设置日志处理程序
        if mode == "default":
            # 仅忽略特定警告类型
            warnings.simplefilter("ignore", DeprecationWarning)
            warnings.simplefilter("ignore", UserWarning)
            warnings.simplefilter("ignore", FutureWarning)

            # 初始化 Axiom 客户端
            self.axiom_token = config.get("AXIOM_TOKEN")
            self.axiom_org_id = config.get("AXIOM_ORG_ID")
            self.axiom_dataset = config.get("AXIOM_DATASET")
            
            if self.axiom_token and self.axiom_org_id and self.axiom_dataset:
                try:
                    self.axiom_client = Client(
                        self.axiom_token,
                        self.axiom_org_id
                    )
                    # 如果 Axiom 客户端初始化成功，使用远程日志处理程序
                    self._log_handler = self._log_with_axiom
                except Exception as e:
                    self.logger.error(f"Failed to initialize Axiom client: {e}")
                    self._log_handler = self._log_local
            else:
                self.logger.warning("Axiom configuration is incomplete, using local logging only")
                self._log_handler = self._log_local
        else:
            # 本地模式，仅使用本地日志记录
            self._log_handler = self._log_local
    
    def _log_local(self, level, message):
        """仅记录本地日志"""
        log_method = getattr(self.logger, level.lower())
        log_method(f"[{self.service_name}] {message}")
    
    def _log_with_axiom(self, level, message):
        """记录本地日志并发送到 Axiom"""
        # 首先记录本地日志
        log_method = getattr(self.logger, level.lower())
        formatted_message = f"[{self.service_name}] {message}"
        log_method(formatted_message)
        
        # 然后发送到 Axiom
        try:
            self.axiom_client.ingest_events(
                self.axiom_dataset, 
                [{
                    "level": level, 
                    "message": str(message),
                    "service": self.service_name
                }]
            )
        except Exception as e:
            self.logger.error(f"Failed to send logs to Axiom: {e}")
    
    def info(self, message):
        """记录 info 级别日志"""
        self._log_handler("INFO", message)
    
    def debug(self, message):
        """记录 debug 级别日志"""
        self._log_handler("DEBUG", message)
    
    def error(self, message):
        """记录 error 级别日志"""
        self._log_handler("ERROR", message)
    
    def warning(self, message):
        """记录 warning 级别日志"""
        self._log_handler("WARNING", message)


# 创建默认实例 (向后兼容)
default_logger = Logger("puppy", "default")
log_info = default_logger.info
log_error = default_logger.error
log_warning = default_logger.warning
log_debug = default_logger.debug

# 服务特定的日志器
def get_logger(service_name, mode="default", log_level=None):
    """
    获取特定服务的日志器实例
    
    Args:
        service_name: 服务名称
        mode: 日志模式
        log_level: 日志级别
        
    Returns:
        Logger 实例
    """
    return Logger(service_name, mode, log_level) 