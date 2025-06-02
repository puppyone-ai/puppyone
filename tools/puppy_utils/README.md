# Puppy Utils 工具包

这个工具包提供了 PuppyAgent 项目中的公共工具函数和类，包括日志记录、配置管理和异常处理等功能。

## 功能特性

- **统一日志系统**：支持本地和远程（Axiom）日志记录，区分不同服务
- **集中配置管理**：统一环境变量加载和访问，支持路径管理
- **标准化异常处理**：提供服务特定的异常类和异常处理装饰器

## 使用方法

### 安装

此包为项目内部包，无需安装，直接导入即可。确保项目根目录在 Python 路径中。

### 导入

```python
# 导入所有工具
from tools.puppy_utils import log_info, log_error, config, PuppyException

# 或者按需导入
from tools.puppy_utils.logger import log_info, get_logger
from tools.puppy_utils.config import config, paths
from tools.puppy_utils.puppy_exception import PuppyException, global_exception_handler
```

### 日志记录

```python
# 使用默认日志器
from tools.puppy_utils import log_info, log_error, log_warning

log_info("这是一条信息日志")
log_error("这是一条错误日志")
log_warning("这是一条警告日志")

# 创建特定服务的日志器
from tools.puppy_utils.logger import get_logger
import logging

# 创建一个名为 "myservice" 的日志器，使用本地模式和 DEBUG 级别
logger = get_logger("myservice", "local", logging.DEBUG)
logger.info("这是一条来自 myservice 的日志")
logger.debug("这是一条调试信息")
```

### 配置管理

```python
# 获取环境变量
from tools.puppy_utils import config

api_key = config.get("API_KEY", "default_key")
debug_mode = config.get("DEBUG", "false").lower() == "true"

# 访问路径
from tools.puppy_utils import paths

project_root = paths.PROJECT_ROOT
storage_path = paths.STORAGE_ROOT
```

### 异常处理

```python
# 使用基本异常类
from tools.puppy_utils import PuppyException

try:
    # 一些操作
    if error_condition:
        raise PuppyException(1001, "操作失败", "无效的输入参数")
except PuppyException as e:
    print(f"错误代码: {e.code}")
    print(f"错误消息: {e.message}")

# 使用服务特定的异常类
from tools.puppy_utils.puppy_exception import PuppyEngineException

raise PuppyEngineException(6001, "引擎处理失败", "无效的配置")

# 使用异常处理装饰器
from tools.puppy_utils import global_exception_handler

@global_exception_handler(1002, "处理失败", service_name="myservice")
def process_data():
    # 处理逻辑
    pass
```

## 为新服务扩展

### 创建服务特定的日志器

```python
from tools.puppy_utils.logger import get_logger

# 创建名为 "newservice" 的日志器
new_service_logger = get_logger("newservice")
log_info = new_service_logger.info
log_error = new_service_logger.error
```

### 创建服务特定的异常类

```python
from tools.puppy_utils.puppy_exception import PuppyException

class NewServiceException(PuppyException):
    """NewService 服务专用异常类"""
    service_name = "newservice"
```

## 最佳实践

1. **分级日志**: 使用适当的日志级别，避免过多的 INFO 级别日志
2. **异常粒度**: 为不同类型的错误使用不同的错误代码
3. **配置优先级**: 使用环境变量而非硬编码配置
4. **路径标准化**: 通过路径管理器访问项目路径 