# Context分发方式重构（重大更新）

## 现状说明（避免误解）

- **Context 是逻辑概念**：Context = `Table.data` 的某个子 JSON 子树，由 `(table_id, json_path)`（JSON Pointer；根路径 `""`）标识。
- **数据库实现没有单独的 Context 表**：系统核心实体是 `tool`（对某个 Context 的操作定义，ADI）以及 `mcp_v2/mcp_binding`（暴露入口与绑定，AEI）；公开只读发布使用 `context_publish` 表引用 `(table_id, json_path)`。
- **MCP v2 已“去 Context 化”**：一个 MCP v2 实例可以绑定多个 Tool，从而跨多个 Context 组合暴露能力；不再是“一个 Context 对应一个 MCP 实例”。

## 背景

PuppyOne的核心价值是：托管用户的数据，然后用agent friendly的方式进行分发。这个产品扮演了Connector的角色，将用户在各种平台散落的数据源进行统一的分发。

被分发的Context = Table表中的data字段的一个子JSON（json_path定位）

## 目前的分发方式为
- （历史描述）被分发的Context唯一对应一个数据库中的Mcp Server实例 @sql/mcp.sql
- Tools直接绑定到了MCP Server上面，作为附庸而不是独立实体。
- 平台的分发方式受限，无法通过Api、CLI等其他方式分发，因为分发方法绑定到了MCP上面。

### 现有架构（历史）

```
┌─────────────────────────────────────────────────────────────────┐
│                     Access Channel (唯一入口)                    │
│                      ┌─────────────┐                            │
│                      │ MCP Server  │                            │
│                      │   Proxy     │                            │
│                      └──────┬──────┘                            │
└─────────────────────────────┼───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MCP Instance (核心实体)                       │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  api_key (JWT)                                             │ │
│  │  user_id, project_id, table_id, json_pointer               │ │
│  │                                                            │ │
│  │  tools_definition: {        ← 工具是 JSONB 配置，不是实体   │ │
│  │    "query_data": {...},                                    │ │
│  │    "create": {...},                                        │ │
│  │  }                                                         │ │
│  │  register_tools: ["query_data", "create"]                  │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              远程 MCP Server (外部服务)                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  接收 api_key → 查询 mcp_instance → 执行工具               │ │
│  │  工具逻辑硬编码在 MCP Server 里                             │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Data Layer (数据层)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   project   │  │context_table│  │mcp_instance │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                           │                     │
│                                    tools_definition (JSONB)     │
└─────────────────────────────────────────────────────────────────┘
```

**请求流程：**
```
Client
  │
  │ POST /mcp/server/{mcp_api_key}/mcp
  ▼
Backend (Proxy)
  │ 1. 验证 mcp_api_key 存在
  │ 2. 检查 mcp_instance.status == 1
  │ 3. 转发请求到远程 MCP Server
  ▼
Remote MCP Server (settings.MCP_SERVER_URL)
  │ 1. 解析 X-API-KEY header
  │ 2. 回调 Backend 获取 mcp_instance 信息
  │ 3. 根据 tools_definition 执行工具
  ▼
Response
```

## 重构目标
1. `ADI` 数据的操作方式应该单独抽象为一层`Agent Data Interface`(ADI)，独立于MCP Server。即将原先的create_element, query_data, get_schema等Tools方法抽象出来。
   1. 一个ADI实体 ==对应== 对一个Context的一种分发方式。例如：对某个Context的query_data操作可以认为是一个ADI实体。
2. `AEI` 数据的分发层后续可能不仅有mcp server，还包括agent skills, CLI等，所以应该抽象一层`Agent Exposure Interface`(AEI)
   1. 目前仅支持MCP Server层，但是要做到Tools和 ADI的解耦。
3. ADI和AEI之间能高效对接
   1. 支持将不同的ADI组合到一起，发布为一个MCP Server：即将不同的ADI注册为MCP Server的工具。
   2. 这可以在MCP Server中实现跨Context的管理，而原先一个MCP Server仅能对一个Context进行管理。

## 阶段目标
1. 抽象出ADI和AEI。
2. 仅支持MCP Server一种AEI。
3. 支持将不同的ADI组合到一起，作为mcp server的工具，发布为一个MCP Server。