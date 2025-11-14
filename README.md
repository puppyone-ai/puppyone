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
cd backend
uv run uvicorn app.main:app --host 0.0.0.0 --port 9090 --reload --log_level info
```

## Project structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI应用入口
│   ├── config.py              # 配置文件
│   ├── dependencies.py        # 依赖注入
│   │
│   ├── api/                   # API路由模块
│   │   ├── __init__.py
│   │   ├── v1/
│   │   │   ├── __init__.py
│   │   │   ├── projects.py    # 项目管理API
│   │   │   ├── json_data.py   # JSON数据管理API
│   │   │   ├── rules.py       # 规则配置API
│   │   │   ├── mcp.py         # MCP导出API
│   │   │   └── auth.py        # 认证API(预留)
│   │   └── router.py          # 路由汇总
│   │
│   ├── core/                  # 核心业务逻辑
│   │   ├── __init__.py
│   │   ├── project_manager.py # 项目管理逻辑
│   │   ├── json_handler.py    # JSON数据处理
│   │   ├── rule_engine.py     # 规则引擎
│   │   └── mcp_exporter.py    # MCP导出逻辑
│   │
│   ├── storage/               # 存储抽象层
│   │   ├── __init__.py
│   │   ├── base.py           # 存储接口定义
│   │   ├── local_storage.py  # 本地文件存储实现
│   │   └── models.py         # 数据模型
│   │
│   ├── schemas/              # Pydantic数据模型
│   │   ├── __init__.py
│   │   ├── project.py
│   │   ├── json_data.py
│   │   ├── rule.py
│   │   └── mcp.py
│   │
│   └── utils/                # 工具函数
│       ├── __init__.py
│       ├── json_path.py     # JSON路径处理
│       ├── validators.py    # 验证器
│       └── exceptions.py    # 自定义异常
│
├── data/                     # 数据存储目录
│   ├── projects/
│   └── mcp_exports/
│
├── tests/                    # 测试目录
│   ├── __init__.py
│   ├── api/
│   └── core/
│
├── main.py                   # 应用启动入口
├── requirements.txt          # 依赖列表
├── pyproject.toml           # 项目配置
└── README.md                # 项目说明
```
