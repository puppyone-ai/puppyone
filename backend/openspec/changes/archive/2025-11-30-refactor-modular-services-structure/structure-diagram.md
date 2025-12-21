# 重构后的目标结构示意图

## 完整目录结构

```
ContextBase/backend/
├── src/                          # 源代码根目录（重命名自 app/）
│   ├── auth/                     # 认证服务模块
│   │   ├── __init__.py
│   │   ├── router.py             # FastAPI路由定义
│   │   ├── schemas.py            # Pydantic请求/响应模型
│   │   ├── models.py             # 数据库模型
│   │   ├── service.py            # 业务逻辑层
│   │   ├── repository.py         # 数据访问层
│   │   ├── dependencies.py       # FastAPI依赖注入
│   │   ├── config.py             # 模块级配置（可选）
│   │   ├── constants.py          # 模块级常量（可选）
│   │   ├── exceptions.py         # 模块特定异常（可选）
│   │   └── utils.py              # 模块级工具函数（可选）
│   │
│   ├── user_context/             # 用户上下文服务模块
│   │   ├── __init__.py
│   │   ├── router.py
│   │   ├── schemas.py
│   │   ├── models.py
│   │   ├── service.py
│   │   ├── repository.py
│   │   └── dependencies.py
│   │
│   ├── mcp/                      # MCP服务器管理模块
│   │   ├── __init__.py
│   │   ├── router.py
│   │   ├── schemas.py
│   │   ├── models.py
│   │   ├── service.py
│   │   ├── repository.py
│   │   ├── dependencies.py
│   │   └── server/               # MCP服务器实现（原 mcp_server/）
│   │       ├── __init__.py
│   │       ├── server.py
│   │       ├── manager/
│   │       │   ├── base_backend.py
│   │       │   ├── manager.py
│   │       │   └── process_backend.py
│   │       ├── middleware/
│   │       │   ├── __init__.py
│   │       │   └── http_auth_middleware.py
│   │       ├── schema/
│   │       │   └── context.py
│   │       └── tools/
│   │           ├── __init__.py
│   │           ├── context_tool.py
│   │           ├── tool_provider.py
│   │           └── vector_tool.py
│   │
│   ├── __init__.py               # 包标识
│   ├── config.py                 # 全局应用配置
│   ├── models.py                 # 全局共享数据模型（如果需要）
│   ├── exceptions.py             # 全局异常基类
│   ├── exception_handler.py      # 全局异常处理器
│   ├── database.py               # 数据库连接和会话管理
│   ├── pagination.py             # 全局分页工具
│   ├── repositories.py           # 共享的repository基类
│   ├── schemas.py                # 全局共享的schemas（如ApiResponse）
│   ├── utils/                    # 全局工具函数
│   │   ├── __init__.py
│   │   ├── logger.py
│   │   └── exception.py
│   └── main.py                   # FastAPI应用入口
│
├── tests/                        # 测试目录（镜像src结构）
│   ├── __init__.py
│   ├── auth/                     # auth模块的测试
│   │   ├── test_router.py
│   │   ├── test_service.py
│   │   └── test_repository.py
│   ├── user_context/             # user_context模块的测试
│   │   ├── test_router.py
│   │   ├── test_service.py
│   │   └── test_repository.py
│   ├── mcp/                      # mcp模块的测试
│   │   ├── test_router.py
│   │   ├── test_service.py
│   │   └── test_repository.py
│   └── core/
│       ├── test_jsonpath.py
│       └── test_jmespath.py
│
├── data/                         # 数据文件（位置不变）
│   ├── userdata.json
│   ├── user_contexts.json
│   └── mcp_instances.json
│
├── logs/                         # 日志文件
│   └── mcp_instances/
│
├── docs/                         # 文档
│   └── fastmcp_doc/
│
├── openspec/                     # OpenSpec规范
│   ├── AGENTS.md
│   ├── project.md
│   ├── specs/
│   │   └── project-structure/    # 新增的项目结构规范
│   │       └── spec.md
│   └── changes/
│       ├── refactor-modular-services-structure/  # 当前变更提案
│       │   ├── README.md
│       │   ├── proposal.md
│       │   ├── design.md
│       │   ├── tasks.md
│       │   └── specs/
│       │       └── project-structure/
│       │           └── spec.md
│       └── archive/
│
├── client/                       # 客户端示例
│   ├── my_client.py
│   └── README.md
│
├── pyproject.toml                # 项目配置（需更新）
├── uv.lock                       # 依赖锁定文件
├── README.md                     # 项目README（需更新）
└── .git-blame-ignore-revs        # Git blame忽略文件（待创建）
```

## 模块依赖关系

```
┌─────────────────────────────────────────────────┐
│              src/main.py (应用入口)               │
│  - 创建FastAPI应用                                │
│  - 配置中间件                                     │
│  - 注册路由                                       │
│  - 注册异常处理器                                 │
└─────────────────┬───────────────────────────────┘
                  │
                  ├── 使用全局模块
                  │   ├── src/config.py
                  │   ├── src/exceptions.py
                  │   └── src/exception_handler.py
                  │
                  └── 注册服务模块路由
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ src/auth/    │ │src/user_     │ │  src/mcp/    │
│              │ │context/      │ │              │
│ - router     │ │              │ │ - router     │
│ - schemas    │ │ - router     │ │ - schemas    │
│ - models     │ │ - schemas    │ │ - models     │
│ - service    │ │ - models     │ │ - service    │
│ - repository │ │ - service    │ │ - repository │
│              │ │ - repository │ │ - server/    │
└──────────────┘ └──────────────┘ └──────────────┘
      │                 │                 │
      └─────────────────┴─────────────────┘
                        │
                共享基础设施
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
┌────────────┐  ┌────────────┐  ┌────────────┐
│ src/       │  │ src/       │  │ src/utils/ │
│ database.py│  │repositories│  │            │
│            │  │ .py        │  │ - logger   │
│(DB连接)    │  │            │  │ - exception│
│            │  │(基类)      │  │            │
└────────────┘  └────────────┘  └────────────┘
```

## 数据流组织

```
HTTP Request
     ↓
┌────────────────────────────────┐
│   router.py (路由层)            │
│   - 参数验证                     │
│   - 依赖注入                     │
│   - 响应封装                     │
└────────────┬───────────────────┘
             ↓ 使用 schemas.py (Pydantic模型)
┌────────────────────────────────┐
│   service.py (业务逻辑层)        │
│   - 业务逻辑处理                 │
│   - 跨repository协调             │
│   - 事务管理                     │
└────────────┬───────────────────┘
             ↓
┌────────────────────────────────┐
│   repository.py (数据访问层)     │
│   - CRUD操作                    │
│   - 数据持久化                   │
│   - 查询构建                     │
└────────────┬───────────────────┘
             ↓ 使用 models.py (数据模型)
┌────────────────────────────────┐
│   数据存储 (JSON/Database)      │
└────────────────────────────────┘
```

## 导入示例

### 绝对导入（跨模块）
```python
# 在 src/user_context/service.py 中导入 auth 模块
from src.auth.models import User
from src.auth.service import AuthService
from src.config import settings
from src.exceptions import NotFoundException
```

### 相对导入（模块内部）
```python
# 在 src/auth/router.py 中导入同模块的代码
from .schemas import UserCreate, UserUpdate, UserOut
from .service import UserService
from .dependencies import get_current_user
```

### 全局模块导入
```python
# 在任何模块中导入全局配置
from src.config import settings
from src.exceptions import AppException
from src.utils.logger import log_info, log_error
```

## 启动命令变化

### 旧命令
```bash
uvicorn app.main:app --host 0.0.0.0 --port 9090 --reload
```

### 新命令
```bash
uvicorn src.main:app --host 0.0.0.0 --port 9090 --reload
```

## 代码检查命令变化

### 旧命令
```bash
ruff check app/
ruff format app/
```

### 新命令
```bash
ruff check src/
ruff format src/
```

