# ContextBase Backend

## Quick start

### Prerequisites

1. **Install uv**

`uv` is a fast Python package manager and project management tool. Please select the installation method according to your operating system:

Please refer to the [uv official documentation](https://github.com/astral-sh/uv) for the installation process.

2. **Download dependencies**

Run the following command in the backend directory to install all dependencies:

```bash
uv sync
```

### Usage

Run the following command in the backend directory to start the server:

```bash
uv run uvicorn src.main:app --host 0.0.0.0 --port 9090 --reload --log-level info
```

### MCP Config Example

Here is a example of the MCP config, you can use it in Cursor or other MCP clients.

Notice: You should first create a mcp server instance through `/api/v1/mcp/` entrypoint, and get the url and api_key.

```json
{
  "mcpServers": {
    "contextbase-mcp": {
      "command": "npx -y mcp-remote url/mcp?api_key=xxx",
      "env": {},
      "args": []
    }
  }
}
```

## Project structure

```
backend/
├── src/                      # 源代码目录（重构后采用模块化服务架构）
│   ├── __init__.py
│   ├── main.py               # FastAPI应用入口
│   │
│   ├── auth/                 # 认证服务模块
│   │   ├── __init__.py
│   │   ├── router.py         # 路由定义
│   │   ├── schemas.py        # Pydantic模型
│   │   ├── models.py         # 数据模型
│   │   ├── service.py        # 业务逻辑
│   │   ├── repository.py     # 仓储接口
│   │   ├── repository_impl.py # 仓储实现
│   │   └── dependencies.py   # 依赖注入
│   │
│   ├── user_context/         # 用户上下文服务模块
│   │   ├── __init__.py
│   │   ├── router.py
│   │   ├── schemas.py
│   │   ├── models.py
│   │   ├── service.py
│   │   ├── repository.py
│   │   ├── repository_impl.py
│   │   └── dependencies.py
│   │
│   ├── mcp/                  # MCP服务器管理模块
│   │   ├── __init__.py
│   │   ├── router.py
│   │   ├── schemas.py
│   │   ├── models.py
│   │   ├── service.py
│   │   ├── repository.py
│   │   ├── repository_impl.py
│   │   ├── dependencies.py
│   │   └── server/           # MCP服务器实现
│   │       ├── server.py
│   │       ├── manager/
│   │       ├── middleware/
│   │       └── tools/
│   │
│   ├── config.py             # 全局配置
│   ├── exceptions.py         # 全局异常
│   ├── exception_handler.py  # 异常处理器
│   ├── common_schemas.py     # 通用Schemas
│   └── utils/                # 工具函数
│       ├── exception.py
│       └── logger.py
│
├── client/                   # MCP客户端
│   ├── my_client.py         # 客户端实现
│   └── README.md            # 客户端说明
│
├── data/                     # 数据存储目录
│   ├── chroma_db/           # ChromaDB数据
│   ├── mcp_instances.json   # MCP实例配置
│   ├── mockdata.json        # 模拟数据
│   ├── user_contexts.json   # 用户上下文数据
│   └── userdata.json        # 用户数据
│
├── docs/                     # 文档目录
│   ├── 开发文档.md
│   ├── 开发架构.md
│   └── ...
│
├── fastmcp_doc/             # FastMCP文档
│   ├── docs/                # 文档内容
│   └── examples/            # 示例代码
│
├── logs/                    # 日志目录
│   └── mcp_instances/       # MCP实例日志
│
├── tests/                   # 测试目录
│   ├── __init__.py
│   ├── api/                 # API测试
│   └── core/                # 核心功能测试
│
├── pyproject.toml           # 项目配置
├── uv.lock                  # 依赖锁定文件
└── README.md                # 项目说明
```

## 开发规范

1. All exceptions should be raised only in the `service` layer. Lower layers such as the `repository` layer should not raise exceptions, except for cases like database connection failures.