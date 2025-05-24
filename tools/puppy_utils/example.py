"""
Puppy Utils 示例用法

这个文件展示了如何在 PuppyEngine 和 PuppyStorage 项目中使用 puppy_utils 工具包。
"""

# 导入必要的模块
import os
import sys
import time

# 确保项目根目录在 Python 路径中
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(project_root)

# 从 puppy_utils 导入工具
from tools.puppy_utils import log_info, log_error, log_warning, log_debug
from tools.puppy_utils import config, paths
from tools.puppy_utils import PuppyException, global_exception_handler
from tools.puppy_utils.puppy_exception import PuppyEngineException, PuppyStorageException
from tools.puppy_utils.logger import get_logger

# -----------------------------------------------------------------------------
# 示例一：如何修改 PuppyEngine/Server/WorkFlow.py
# -----------------------------------------------------------------------------

"""
原始导入:
from Utils.logger import log_info, log_warning, log_error
from Utils.puppy_exception import global_exception_handler, PuppyException

修改为:
from tools.puppy_utils import log_info, log_warning, log_error
from tools.puppy_utils import global_exception_handler, PuppyException
"""

# 获取 PuppyEngine 专用日志器
engine_logger = get_logger("puppyengine")
engine_log_info = engine_logger.info
engine_log_error = engine_logger.error

# 使用装饰器处理异常
@global_exception_handler(5200, "Error Initializing Workflow", service_name="puppyengine")
def initialize_workflow(data):
    """示例：工作流初始化函数"""
    engine_log_info("初始化工作流")
    
    # 使用配置
    debug_mode = config.get("DEBUG", "false").lower() == "true"
    if debug_mode:
        engine_log_info("调试模式已启用")
    
    # 使用路径
    storage_path = paths.STORAGE_ROOT
    engine_log_info(f"存储路径: {storage_path}")
    
    # 抛出异常
    if not data:
        raise PuppyEngineException(5201, "Empty Workflow Data", "Workflow data cannot be empty")
    
    return {"status": "initialized"}

# -----------------------------------------------------------------------------
# 示例二：如何修改 PuppyStorage 代码
# -----------------------------------------------------------------------------

"""
原始导入:
from utils.logger import log_info, log_warning, log_error
from utils.puppy_exception import global_exception_handler, PuppyException

修改为:
from tools.puppy_utils import log_info, log_warning, log_error
from tools.puppy_utils import global_exception_handler, PuppyException
"""

# 获取 PuppyStorage 专用日志器
storage_logger = get_logger("puppystorage")
storage_log_info = storage_logger.info
storage_log_error = storage_logger.error

@global_exception_handler(3001, "Storage Operation Failed", service_name="puppystorage")
def store_data(key, value):
    """示例：存储数据函数"""
    storage_log_info(f"存储数据: {key}")
    
    # 使用配置
    encryption = config.get("STORAGE_ENCRYPTION", "false").lower() == "true"
    if encryption:
        storage_log_info("数据加密已启用")
    
    # 抛出异常
    if not key:
        raise PuppyStorageException(3002, "Invalid Key", "Storage key cannot be empty")
    
    return {"status": "stored"}

# -----------------------------------------------------------------------------
# 运行示例
# -----------------------------------------------------------------------------

def run_examples():
    """运行所有示例代码"""
    print("\n--- 运行工具包示例 ---\n")
    
    # 测试日志
    print("\n1. 测试日志记录:")
    log_info("这是一条普通信息日志")
    log_warning("这是一条警告日志")
    log_debug("这是一条调试日志")
    engine_log_info("这是一条来自 PuppyEngine 的日志")
    storage_log_info("这是一条来自 PuppyStorage 的日志")
    
    # 测试配置
    print("\n2. 测试配置管理:")
    print(f"项目根目录: {paths.PROJECT_ROOT}")
    print(f"存储根目录: {paths.STORAGE_ROOT}")
    print(f"API密钥: {config.get('API_KEY', '未设置')}")
    
    # 测试异常处理
    print("\n3. 测试异常处理:")
    try:
        # 使用装饰器函数
        initialize_workflow({})
        print("工作流初始化成功")
    except PuppyException as e:
        print(f"捕获到异常: {e}")
        print(f"错误代码: {e.code}")
        print(f"错误消息: {e.message}")
        print(f"服务名称: {e.service}")
    
    try:
        # 直接抛出异常
        print("\n测试直接抛出异常:")
        raise PuppyException(9999, "通用错误", "这是一个测试异常", "testservice")
    except PuppyException as e:
        print(f"捕获到异常: {e}")
    
    print("\n--- 示例运行完成 ---")

if __name__ == "__main__":
    run_examples() 