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
uv run uvicorn app.main:app --host 0.0.0.0 --port 9090 --reload --log-level info
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
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI应用入口
│   │
│   ├── api/                   # API路由模块
│   │   ├── __init__.py
│   │   ├── router.py          # 路由汇总
│   │   └── v1/                # API v1版本
│   │       ├── __init__.py
│   │       ├── router.py      # v1路由汇总
│   │       └── endpoints/      # API端点
│   │           ├── mcp.py      # MCP管理API
│   │           ├── user.py    # 用户管理API
│   │           └── user_context.py  # 用户上下文API
│   │
│   ├── core/                  # 核心配置和依赖
│   │   ├── config.py          # 配置文件
│   │   └── dependencies.py    # 依赖注入
│   │
│   ├── mcp_server/            # MCP服务器模块
│   │   ├── __init__.py
│   │   ├── server.py          # MCP服务器实现
│   │   ├── manager/           # MCP管理器
│   │   │   ├── base_backend.py    # 后端基类
│   │   │   ├── manager.py         # 管理器实现
│   │   │   └── process_backend.py # 进程后端实现
│   │   ├── middleware/        # 中间件
│   │   │   └── http_auth_middleware.py  # HTTP认证中间件
│   │   └── tools/             # MCP工具
│   │       ├── context_tool.py    # 上下文工具
│   │       ├── llm_tool.py        # LLM工具
│   │       └── vector_tool.py     # 向量检索工具
│   │
│   ├── models/                # 数据模型
│   │   ├── mcp.py            # MCP模型
│   │   ├── user.py           # 用户模型
│   │   └── user_context.py   # 用户上下文模型
│   │
│   ├── repositories/          # 数据访问层
│   │   ├── base.py           # 仓储基类
│   │   ├── mcp_repo.py       # MCP仓储
│   │   ├── user_repo.py      # 用户仓储
│   │   ├── user_context_repo.py  # 用户上下文仓储
│   │   └── vector/           # 向量数据库
│   │       ├── __init__.py
│   │       ├── embedder.py       # 嵌入器
│   │       ├── vdb_base.py       # 向量数据库基类
│   │       ├── vdb_chroma.py     # ChromaDB实现
│   │       ├── vdb_pgv.py        # PGVector实现
│   │       └── vdb_factory.py    # 向量数据库工厂
│   │
│   ├── schemas/              # Pydantic数据模型
│   │   ├── mcp.py           # MCP Schema
│   │   ├── response.py      # 响应Schema
│   │   ├── user.py          # 用户Schema
│   │   └── user_context.py  # 用户上下文Schema
│   │
│   ├── service/             # 业务逻辑层
│   │   ├── mcp_service.py          # MCP服务
│   │   ├── user_service.py         # 用户服务
│   │   └── user_context_service.py # 用户上下文服务
│   │
│   └── utils/                # 工具函数
│       ├── exception.py     # 自定义异常
│       └── logger.py        # 日志工具
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