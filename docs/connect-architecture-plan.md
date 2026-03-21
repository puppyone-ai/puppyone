# Connect 模块架构重构计划

> 状态：Phase 0–3 主体完成
> 日期：2026-03-10
> 背景：[Sync connector 重构讨论](77c07e5a-e05e-40f8-8a67-ee9465e51b05)

## 核心原则

1. **按数据源分，不按同步模式分** — 同步方向（inbound/bidirectional）和触发方式（定时/手动/实时）是用户配置，不是架构分类依据
2. **每个数据源是一个 connector** — Gmail、GitHub、Filesystem、Sandbox 都是 connector，走同一套引擎
3. **ConnectorSpec 是唯一 source of truth** — 前端、CLI 全部从 API 动态获取，不维护本地副本
4. **Connector 只负责 fetch/push** — 版本管理、冲突解决、审计日志全在 Mut 内核

## 系统两层架构

```
Connector（连接层）              Mut 内核（写入层）
"数据从哪来、往哪去"              "数据怎么存、怎么管"

fetch() → 拿数据                 MutCompatService.commit() → 唯一写入入口
push()  → 推数据                   └→ MutWriteService
                                       ├→ three_way_merge()    冲突合并
ConnectorSpec 声明能力：               ├→ mut_commits 表        版本历史
  capabilities (PULL|PUSH|...)        └→ audit_logs 表         审计日志
  supported_directions
  default_trigger
  config_fields
```

## 目标目录结构

```
src/
├── connect/                      ← 所有数据源（统一引擎 + 统一 API）
│   ├── connectors/               ← 每个数据源一个目录（自包含）
│   │   ├── _base.py              ← BaseConnector + ConnectorSpec
│   │   ├── gmail/connector.py
│   │   ├── github/connector.py
│   │   ├── filesystem/           ← 从 src/filesystem/ 合并进来
│   │   │   ├── connector.py      ← spec + fetch/push
│   │   │   ├── service.py        ← OpenClaw 生命周期
│   │   │   └── router.py         ← filesystem 专属路由（CLI daemon 用）
│   │   ├── sandbox/              ← 从 src/sandbox/ 的同步部分合并进来
│   │   │   ├── connector.py      ← spec + fetch/push (write-back)
│   │   │   └── service.py        ← 容器生命周期
│   │   ├── url/connector.py
│   │   ├── google_calendar/connector.py
│   │   ├── google_docs/connector.py
│   │   ├── google_sheets/connector.py
│   │   ├── google_drive/connector.py     (ui_visible=False)
│   │   └── google_search_console/connector.py
│   │
│   ├── engine.py                 ← 统一执行引擎（根据 spec 决定 pull/push）
│   ├── registry.py               ← connector 字典 + 自动发现
│   ├── service.py                ← 生命周期（create/pause/resume/delete）
│   ├── repository.py             ← connections 表 CRUD
│   ├── router.py                 ← 统一 API 入口
│   ├── schemas.py                ← 数据模型
│   └── dependencies.py           ← DI（自动扫描，不手动注册）
│
├── agent/                        ← AI Agent（独立模块，不是数据源）
│   ├── chat/                     ← SSE 对话
│   ├── config/                   ← Agent CRUD + 权限
│   └── mcp/                      ← Agent 的 MCP tool 代理
│
├── mcp/                          ← MCP 服务（合并 mcp + mcp_endpoint + mcp_v2）
│
├── content_node/                 ← 内容空间
├── collaboration/                ← Mut 兼容层 + 审计日志 API
├── table/                        ← 结构化数据
├── project/                      ← 项目管理
├── organization/                 ← 组织管理
├── auth/                         ← 认证
├── oauth/                        ← OAuth 服务
├── upload/                       ← 文件上传 ETL
├── s3/                           ← 存储
├── supabase/                     ← 数据库客户端
├── llm/                          ← LLM 服务
├── search/                       ← 搜索
├── scheduler/                    ← 定时任务
└── ...
```

## Connector 自注册机制

每个 connector 暴露标准工厂函数，消灭 dependencies.py 的手动注册：

```python
# connect/connectors/gmail/connector.py
def setup(deps: ConnectorDeps) -> ConnectorSetup:
    from src.oauth.gmail_service import GmailOAuthService
    oauth_svc = GmailOAuthService()
    return ConnectorSetup(
        connector=GmailConnector(
            node_service=deps.node_service,
            gmail_service=oauth_svc,
            s3_service=deps.s3_service,
        ),
        oauth_bindings={"gmail": oauth_svc},
    )
```

Registry 启动时自动扫描 connectors/ 目录，调用每个 `setup()`。
增加 connector = 新建目录。删除 = 删目录。其他文件零改动。

## 统一 API 入口

前端只调两个 API：

```
GET  /api/v1/connections/types     → 所有可用连接类型（含 config_fields、icon_url）
POST /api/v1/connections           → 创建任意类型的连接
```

后端根据 provider 内部路由到对应 service。

## ConnectorSpec 扩展字段

```python
ConnectorSpec(
    provider="sandbox",
    display_name="Sandbox",
    capabilities=Capability.PULL | Capability.PUSH | Capability.BOOTSTRAP,
    supported_directions=["inbound", "bidirectional"],
    default_trigger=TriggerMode.MANUAL,
    config_fields=(...),
    icon_url="...",           # 前端直接用，不维护 PROVIDER_ICONS
    ui_visible=True,          # 控制是否在 Web UI 展示
    creation_mode="direct",   # direct | bootstrap
)
```

## 实施顺序

### Phase 0：清理（低风险）✅ 已完成
- [x] mcp_config/、sandbox_config/、access/ 已确认不存在，无需删除
- [x] Connector 自动发现：每个 connector 暴露 setup(deps)，dependencies.py 扫描目录自动注册
- [x] ConnectorSpec 加 icon_url，前端 SyncConfigPanel 删除 PROVIDER_ICONS 改为 API 驱动

### Phase 1：合并碎片（中等风险）✅ 已完成
- [x] 删除死 MCP 代码：mcp/router.py（orphaned）、service_old.py、supabase/mcp_v2/、supabase/mcp_binding/
- [x] connectors/sandbox/ 合并进 sandbox/（endpoint_router/service/repository/schemas/dependencies）
- [x] filesystem/ 已在 connectors/filesystem/，无需移动
- [ ] MCP 合并（connectors/mcp + src/mcp → 统一 mcp 模块）— 推迟到 Phase 2

### Phase 2：统一架构（较高风险）— 部分完成
- [x] MCP 合并：connectors/mcp/ 合并进 src/mcp/（endpoint_router/service/repository/schemas/dependencies）
- [x] 统一 GET /api/v1/connections/types — 单一 API 返回所有连接类型（datasource + agent + mcp + sandbox），带 category 字段
- [ ] 目录重组（connectors/datasource → connect，connectors/agent → agent）— 推迟（170+ import，风险高）
- [ ] sandbox write-back 重构为 connector push() — 推迟到 Phase 3
- [ ] 统一 POST /api/v1/connections — 推迟到 Phase 3

### Phase 3：引擎统一（长期）— 部分完成
- [x] Engine 支持 PUSH 方向：`SyncEngine.push_execute()` 实现（节点级 push，run 记录，能力检查）
- [x] `POST /sync/push/{node_id}` 路由改为走 Engine
- [x] Agent/MCP/Sandbox 创建走统一入口 `POST /api/v1/connections`
- [ ] Filesystem 走 Engine — 推迟（后端无法读取本地文件，fetch() 不可实现；push 是文件级但 sync 绑定是文件夹级）
- [ ] Sandbox 走 Engine — 推迟（无 sync 概念，write-back 是 session 级直接走 MutCompatService）

## 不变的部分

- mut_core/ 的 Mut Protocol（版本/冲突/审计）— 唯一写入内核
- content_node/ 的树结构 — 不需要改
- Router → Service → Repository 三层架构 — FastAPI 标准做法
- connections 表作为所有连接类型的统一存储 — 已经是对的
