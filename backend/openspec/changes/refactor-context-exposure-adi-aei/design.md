## Context
系统当前以 `mcp_instance` 为核心实体：`api_key` 既是鉴权凭据又隐含了 `table_id + json_path` 的数据作用域，MCP Server（`mcp_service`）基于该作用域动态返回 tools 并调用 Internal API 操作 `table.data`。

这个设计的问题不是"工具实现在哪里"，而是"数据操作"和"对外暴露"被绑定为同一个实体，导致：
- 新增暴露渠道（API/CLI/skills）会复制一套"工具到数据"的映射与鉴权/治理逻辑
- 一个入口无法聚合多个 Context 的操作（跨表/跨挂载点）

## Architecture Overview（整体架构）

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                  暴露层（对外服务）                                   │
│                                                                                      │
│          MCP Server          │          REST API          │      Sandbox CLI(对外)    │
│                                                                                      │
└──────────────────────────────────────────────┬───────────────────────────────────────┘
                                               │
                                               ▼
┌──────────────────────────────────────────────────────────────────┐  ┌────────────────────────────────┐
│                            Tools 层                              │  │                                │
│                                                                  │  │  对内 Sandbox CLI(用于右面的侧边栏)   │
│  ┌─────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────┐ ┌──────┐  │  │         （独立）               │
│  │  query  │ │ update │ │ create │ │ delete │ │ move │ │ copy │  │  │                                │
│  └─────────┘ └────────┘ └────────┘ └────────┘ └──────┘ └──────┘  │  │  - 内部 agent 使用             │
│                                                                  │  │  - 有人守着监督                │
│  ┌─────────┐ ┌─────────┐ ┌───────────────┐ ┌───────────────┐     │  │  - 可验证操作是否违规          │
│  │ get_all │ │ preview │ │ custom_tool_1 │ │ custom_tool_2 │ ... │  │  - 直接操作 Context            │
│  └─────────┘ └─────────┘ └───────────────┘ └───────────────┘     │  │                                │
│                                                                  │  │  ⚠️ 完全隔离                   │
│   ↑ 预制 Tools                  ↑ 用户自定义 Tools                 │  │  无法被暴露层访问              │
│                                                                  │  │                                │
└──────────────────────────────────┬───────────────────────────────┘  └───────────────┬────────────────┘
                                   │                                                  │
                                   ▼                                                  ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                                      │
│                                        数据层（Context）                                              │
│                                        JSON / 树形结构                                                │
│                                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 三层架构

| 层级 | 说明 | 数据模型 |
|------|------|----------|
| **暴露层** | 对外提供服务的入口（MCP / API / Sandbox对外） | `aei` 表 |
| **Tools 层** | 对数据的操作封装（query / update / create 等） | `adi` 表 |
| **数据层** | 底层数据存储（JSON / 树形结构） | `table.data` |

> **对内 Sandbox** 是独立模块，直接访问数据层，不经过 Tools 层，与暴露层完全隔离。

### 两条独立路径

| 路径 | 流程 | 特点 |
|------|------|------|
| **对外分发** | 暴露层 → Tools 层 → 数据层 | 有权限控制、审计、并发处理 |
| **对内 Sandbox** | Sandbox → 数据层 | 直接访问，有人监督 |

### 层级间的绑定关系

```
暴露层（aei）
  │
  ├── Binding 1 ──→ Tool 1 (query)   ──→ 数据 A
  ├── Binding 2 ──→ Tool 2 (update)  ──→ 数据 A  
  └── Binding 3 ──→ Tool 3 (query)   ──→ 数据 B
```

- 一个**暴露入口**可以绑定多个 **Tools**
- 每个 **Tool** 操作一个**数据节点**
- **Binding** 定义了工具名、描述、输入参数等

## Goals / Non-Goals
- **Goals**
  - 把 Tools 层和暴露层解耦，阶段 1 先落地暴露层的 MCP 类型
  - 支持一个暴露入口绑定多个 Tools，注册为 MCP tools
  - 给出清晰的兼容/迁移路径：现有 MCP 体验不被破坏，同时允许新能力并行上线
- **Non-Goals（阶段 1）**
  - 不实现 MCP 之外的暴露类型（API/CLI/skills 留到后续阶段）
  - 不实现对内 Sandbox（留到后续阶段）
  - 不一次性清理/替换所有旧概念（例如旧 `mcp_instance` 的完全消失）

## Key Concepts（术语对照）

| 功能性名词 | 技术术语 | 数据模型 | 定义 |
|-----------|---------|---------|------|
| **数据层 / 数据节点** | Context | `table.data` + `json_path` | 被操作的 JSON 子树 |
| **Tools 层 / Tool** | ADI (Agent Data Interface) | `adi` 表 | 对数据的一种操作封装 |
| **暴露层 / 暴露入口** | AEI (Agent Exposure Interface) | `aei` 表 | 把 Tools 对外暴露的接口 |
| **绑定** | Binding | `aei_binding` 表 | 暴露入口与 Tool 的关联关系 |

### 预制 Tools

| Tool 名 | 类型 | 说明 |
|---------|------|------|
| `query` | 读 | 使用 JMESPath 查询数据 |
| `get_all` | 读 | 获取全部数据 |
| `get_schema` | 读 | 获取数据结构 |
| `preview` | 读 | 预览数据 |
| `create` | 写 | 创建新条目 |
| `update` | 写 | 更新条目 |
| `delete` | 写 | 删除条目 |
| `move` | 写 | 移动节点 |
| `copy` | 写 | 复制节点 |

> 用户也可以定义自己的 Tools。

### 设计原则

1. **Tools 之间解耦**：各个 Tool 之间保持独立结构，修改单个 Tool 不影响其他 Tool 和整体架构。
2. **Tool 是核心实体**：Tool 运行在沙盒环境中，是最底层的执行单元；MCP Server / REST API 等只是对 Tool 的包装和暴露方式。

------------------------------------------------以上为已确认-------------------------------------------------


## Decisions
### Decision: 采用“并行引入”的兼容策略
- **做法**：阶段 1 引入 ADI/AEI/Binding 新数据模型与配置端点；现有 `mcp_instance` 与 proxy 不变；新增 v2 AEI(MCP) 使用独立入口。
- **原因**：最小化对现有使用方与已存在脚本/前端的破坏；允许逐步迁移。

### Decision: v2 的 api_key 鉴权边界=bindings（不再耦合 table/json_path）
- **做法**：v2 AEI(MCP) 的 `api_key` 作为“暴露入口”凭据，本身不编码 `table_id/json_path`。运行时所有权限/作用域来自该 api_key 关联的 bindings 列表（每个 binding 指向一个 ADI，ADI 指向 table/json_path）。
- **原因**：支持一个 MCP 入口聚合多个 Context；避免 token payload 与 DB 配置漂移问题。

### Decision: 工具路由由“tool -> ADI”绑定显式描述
对 MCP tools 的本质需求是：工具名（可自定义）+ 输入 schema + 描述 + 执行逻辑指向哪个 ADI。
因此 Binding 需要显式保存 tool 绑定信息，而不是隐式依赖 "单一 table_id/json_path"。

### Decision: 绑定粒度（Confirmed）
- **ADI 粒度**：一种操作 = 一个 ADI 实体（Confirmed）
- **跨 project/table**：允许一个 AEI(MCP) 绑定多个 project/table，但必须同一个 user_id（Confirmed）
- **tool 定义归属**：tool name/description/input schema 的覆盖归属在 binding 层（Confirmed）

### Decision: v2 使用独立入口（Confirmed）
- **做法**：v2 MCP proxy 使用独立入口（例如 ` /api/v2/mcp/server/{api_key}`），v1 legacy 入口保持不变。
- **原因**：避免 legacy/v2 api_key 混用造成误判；排障更直观；迁移更可控。

### Decision: 执行路径采用“后端统一 ADI executor internal endpoint”（Confirmed）
- **做法**：MCP Server 仅做 tool_name -> binding -> ADI 路由，并调用后端 internal 的 ADI executor 执行。
- **原因**：把 operation 映射、参数校验、审计/权限集中在后端；后续 AEI 扩展（CLI/API/skills）直接复用。

### Decision: 默认 tool_name 命名规则（Confirmed）
- **做法**：默认 `tool_name = "{op}_{short_hash}"`，其中 `short_hash` 由 `adi_id`（或 `table_id+json_path+op`）计算得到。
- **原因**：保证 AEI 内唯一且长度可控；避免泄露/暴露 table/json_path 细节；仍可通过描述展示可读信息。

## Proposed Data Model（概念层）
> 具体表名/字段名可在实现阶段落定；此处先明确关系与约束。

- `adi`
  - `id`
  - `user_id`
  - `project_id`（可选：若需要按 project 归档/治理）
  - `table_id`
  - `json_path`
  - `operation_type`（如 `query_data/create/...`）
  - `config`（如 preview_keys / 默认参数等）
- `aei`
  - `id`
  - `user_id`
  - `type`（阶段 1 只有 `mcp`）
  - `name`
  - `api_key`
  - `status`
- `aei_binding`
  - `id`
  - `aei_id`
  - `adi_id`
  - `tool_name`（MCP tool 名；AEI 内必须唯一）
  - `tool_description`（可选覆盖）
  - `input_schema`（可选覆盖；默认由 operation_type 推导）

约束：
- 一个 `aei` 只能绑定同一 `user_id` 下的 ADI
- `tool_name` 在同一个 `aei` 内唯一（避免 MCP tool 冲突）

## Proposed API Surface（概念层）
阶段 1 需要两个面：

1) **管理面（面向产品/前端）**
- CRUD：ADI
- CRUD：AEI(MCP)
- 绑定：将多个 ADI 绑定到一个 AEI，并生成 tools

2) **运行面（面向 MCP Server/代理）**
- internal config v2：给 MCP Server 返回一个 AEI 的完整 tool 列表 + 每个 tool 对应的 ADI 路由信息（binding -> ADI -> context）
- tool call：MCP Server 根据 binding 解析到 ADI，并调用后端内部 API（或服务层）执行对应 ADI

### 运行面建议实现（如何把 ADI 绑定成 MCP tools）
**核心思路**：MCP Server 不再假设“一个 api_key 对应单 table/json_path”，而是把 `api_key` 当作 AEI 凭据，拉取 bindings 后构建 tools 并路由执行。

- **internal config v2（示意）**：`GET /internal/aei/mcp/{api_key}/config`
  - 返回：`aei`（status、name、user_id）、`bindings[]`（tool_name、tool_description、input_schema、adi_ref）
  - 每个 binding 的 `adi_ref` 包含：`operation_type`、`table_id`、`json_path`、`adi_config`（如 preview_keys）
- **list_tools**：
  - 读取 v2 config
  - 按 bindings 生成 MCP tool 列表（tool_name/description/input_schema 均以 binding 为准；未提供则用 operation_type 的默认模板）
- **call_tool**：
  - tool_name -> binding -> ADI
  - 执行路径：MCP Server 调用后端新增的 “ADI 执行 internal endpoint”，由后端负责把 operation_type 映射到 table service/internal table endpoints


## Migration Plan（阶段 1）
- 先引入 ADI/AEI/Binding 与 internal config v2，不改动现有 `mcp_instance` 逻辑
- 新增"创建 AEI(MCP)"的入口：允许用户把多个 Context 的操作组合到一个 MCP api_key 下
- MCP Server 侧优先使用 v2 config；若 v2 不存在则回落到旧 `internal/mcp-instance`（兼容老实例）

## Risks / Trade-offs
- **复杂度上升**：多一层绑定会增加配置面复杂度 → 用默认命名/批量生成工具、提供校验与预览来降低成本
- **鉴权边界**：AEI api_key 不再隐含单一 table scope → 必须把“tool->ADI->context”关系做成可审计的显式绑定
- **工具命名冲突**：跨 Context 时同类操作（如多个 query）会冲突 → 提供默认命名策略（例如 `{table}/{path}:query`）或强制用户指定

## Open Questions（需要你确认）
- **input_schema 的归属**：ADI 是否需要保存 canonical input_schema（或仅由 operation_type 推导），binding 层只保存“覆盖/收敛/别名映射”？
  - 约束：tool 定义归属在 binding 层已确定，但 ADI 也需要对“可接受入参”形成稳定契约
  - 候选：ADI 保存 canonical schema（或 schema_id），binding 可选提供更严格的 schema + arg_mapping，并由后端做兼容性校验
- **hash 生成规则**：`short_hash` 是否以 `adi_id` 作为唯一来源（最稳），还是以 `{table_id,json_path,op}`（可迁移但存在重建 hash 变化风险）？
- **schema 版本化与缓存失效**：binding.tool_schema 更新后，MCP Server 侧缓存如何失效（沿用现有 `/cache/invalidate` 还是新增 AEI 维度失效）？


