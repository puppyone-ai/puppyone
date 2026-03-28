# Connector Architecture

## 核心设计

PuppyOne 通过 **Connector** 将各种外部数据源和交互方式统一接入 MUT tree。所有 connector 类型共享一张 `connections` 表，通过 `provider` 字段区分类型，最终都通过 **MutOps** 读写内容。

```
                    ┌──────────────────────────────────────────┐
                    │            External World                │
                    └──────────────────────────────────────────┘
                        │         │        │       │       │
                    Notion/    Local    Agent    MCP     Sandbox
                    Gmail/     Folder   Chat    Client   Exec
                    GitHub/
                    GDrive/...
                        │         │        │       │       │
                        ▼         ▼        ▼       ▼       ▼
┌───────────────────────────────────────────────────────────────────┐
│                     connections 表（统一管理）                      │
│                                                                   │
│  provider:   gmail│github│url│...│filesystem│agent│mcp│sandbox    │
│  direction:  inbound│outbound│bidirectional                       │
│  path:       MUT tree 中的绑定路径                                 │
│  access_key: 认证凭证（cli_xxx / mcp_xxx / sbx_xxx）              │
│  config:     各类型特有配置（scope、tools、OAuth ref 等）           │
│  status:     active│paused│error│syncing                          │
│                                                                   │
│  统一 CRUD: POST /api/v1/connections → 按 provider 路由到子服务    │
└───────────────────────────────────────────────────────────────────┘
                               │
                    所有写操作统一走
                               │
                               ▼
                    ┌─────────────────┐
                    │     MutOps      │
                    │  (统一写入入口)  │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │    MUT Tree     │
                    │   (S3 Merkle)   │
                    └─────────────────┘
```

---

## Connector 类型

### 1. Datasource（SaaS 数据源）

**方向**: 主要 inbound（pull），部分支持 push / bidirectional

**支持的 provider**: `gmail`, `github`, `google_drive`, `google_docs`, `google_sheets`, `google_calendar`, `google_search_console`, `url`

**架构模式**: 插件化

```
ConnectorRegistry
  ├── GmailConnector       (spec + fetch + OAuth)
  ├── GitHubConnector      (spec + fetch + OAuth)
  ├── GoogleDriveConnector (spec + fetch + OAuth)
  ├── UrlConnector         (spec + fetch, no OAuth)
  └── ...

每个 connector 实现:
  BaseConnector
    ├── spec() → ConnectorSpec (capabilities, auth, UI fields)
    └── fetch(config, credentials) → FetchResult (content + hash)
```

**数据流**:

```
SyncEngine.execute(sync_id)
  → connector.fetch(config, creds)        # 从外部拉取数据
  → compare content_hash vs remote_hash   # 变更检测
  → MutOps.write_file(project_id, path)   # 写入 MUT
  → update remote_hash, last_sync_version # 记录同步状态
```

**触发方式**: 手动、定时（scheduler）、CLI

### 2. Filesystem（本地文件夹同步 / OpenClaw）

**方向**: bidirectional

**架构模式**: CLI daemon + MUT protocol

```
本地文件夹 ←──watch/diff──→ CLI daemon ←──clone/push/pull──→ MUT Server
```

- **不走 `SyncEngine.execute()`**，而是通过 MUT 原生协议（clone/push/pull）同步
- CLI daemon 监听本地文件变更，diff 后通过 `push` 上传
- 服务端变更通过 `pull` 拉取到本地
- `connections` 行的 `access_key`（`cli_xxx`）用于 CLI 认证

### 3. Agent（AI Agent）

**方向**: bidirectional（读写 MUT 内容）

**核心概念**:
- **Scope**: `config.scope` 定义 Agent 可访问的 MUT 路径范围和权限（`rw` / `r`）
- **Tools**: 通过 `connection_tools` 表绑定可用工具
- Agent 通过 chat 接口与 MUT 交互，sandbox 中执行代码

**不做数据同步**——Agent 是 MUT 的消费者和生产者，按需读写。

### 4. MCP Endpoint

**方向**: bidirectional

- 对外暴露 MCP 协议接口，供 Claude Desktop / Cursor 等客户端连接
- `access_key`（`mcp_xxx`）用于认证
- `config` 中定义暴露的工具列表和内容访问范围

### 5. Sandbox Endpoint

**方向**: bidirectional

- 隔离执行环境（Docker / E2B），snapshot isolation + commit-time conflict resolution
- `access_key`（`sbx_xxx`）用于认证
- 通过 `MutOps.bulk_write()` 回写变更

### 6. Database Connector

**独立存储**: 使用 `db_connections` 表（非 `connections`）

- 连接外部数据库（PostgreSQL / MySQL 等），执行查询
- 查询结果通过 `MutOps.write_file()` 写入 MUT tree 的 JSON 文件
- 可通过 scheduler 定期刷新

---

## 统一管理（Manager）

`connectors/manager/router.py` 是所有 connector 的统一 CRUD 入口：

| 操作 | 路由 | 行为 |
|------|------|------|
| 创建 | `POST /connections` | 按 `provider` 路由到子服务 |
| 列表 | `GET /connections` | 按 project_id、provider、status 过滤 |
| 详情 | `GET /connections/{id}` | |
| 更新 | `PATCH /connections/{id}` | status、trigger、config |
| 删除 | `DELETE /connections/{id}` | |
| 重置 Key | `POST /connections/{id}/regenerate-key` | 按 provider 生成前缀 |

**创建路由**:

```
POST /connections { provider: "gmail", ... }    → SyncService.create_sync()
POST /connections { provider: "agent", ... }    → AgentConfigService.create_agent()
POST /connections { provider: "mcp", ... }      → McpEndpointService.create_endpoint()
POST /connections { provider: "sandbox", ... }  → SandboxEndpointService.create_endpoint()
POST /connections { provider: "filesystem" }    → OpenClawService.bootstrap()
```

---

## Datasource 插件接口

新增数据源只需在 `connectors/datasource/` 下创建目录，实现 `connector.py`:

```python
class MyConnector(BaseConnector):
    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="my_source",
            capabilities=[Capability.PULL],
            supported_directions=["inbound"],
            # OAuth config, UI fields, etc.
        )

    async def fetch(self, config, credentials) -> FetchResult:
        # 从外部获取数据
        return FetchResult(content=data, content_hash=hash)

def setup(deps) -> ConnectorSetup:
    return ConnectorSetup(connector=MyConnector(), oauth_service=...)
```

自动发现机制会扫描 `connectors/datasource/*/connector.py` 并注册。
