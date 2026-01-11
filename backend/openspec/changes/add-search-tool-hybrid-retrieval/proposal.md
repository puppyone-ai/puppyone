# Change: 补齐 Search Tool（embedding + turbopuffer 混合检索）与创建时 chunking 触发

## Why

当前仓库已经具备 chunking 基建（`chunks` 表 + 幂等 ensure 入口）以及 turbopuffer 模块封装（write/query/multi_query）与 embedding 服务（litellm 懒加载）。但从 `docs/chunk-design.md` 的整体设计来看，真正可供 Agent 使用的 “Search Tool” 仍缺失：

- Agent 无法对超大字符串内容做语义/关键词检索，只能依赖 `query_data/get_all_data` 的结构化/全量读取（容易超出上下文且检索效率低）。
- 系统缺少“创建 Search Tool 时触发 chunking + indexing”的流程，导致 `chunks` 表虽然存在但未与检索引擎联动。
- `turbopuffer-search` 的当前 spec 仍声明“其它业务模块本版本不依赖 turbopuffer”，与要落地 Search Tool 的集成目标不一致，需要通过 OpenSpec 变更来显式允许依赖。

本变更将以最小可用为目标：让用户能够创建 `Tool.type=search` 并在 MCP（v2 绑定工具）中执行混合检索，返回命中 chunk 的完整信息与定位信息（并将返回的 `json_path` 适配为 Tool 视角下的路径）。

## What Changes

- 新增 capability：`context-search`
  - 定义 Search Tool 的创建/索引触发、混合检索算法、返回结构与权限边界
  - 明确 Search Tool 以 `(table_id, json_path/json_pointer)` 为 scope，对 scope 下的大字符串节点进行 chunking 与 indexing
- 修改 capability：`mcp-tool-management`
  - 扩展 Tool.type 支持 `search`
  - 约束 Search Tool 的输入参数与输出结构（面向 Agent 的可用性）
  - 明确 MCP v2 call_tool 对 `search` 的执行语义（通过主服务的检索能力，而非在 MCP service 内直接集成第三方 SDK）
- 修改 capability：`turbopuffer-search`
  - 移除“其它业务模块本版本不依赖 turbopuffer 模块”的限制，允许 Search 模块依赖 turbopuffer 服务
  - 保持“不新增 turbopuffer 对外 HTTP 路由”的约束不变
- 数据/SQL 设计（在 apply 阶段落地）：
  - 复用现有 `chunks` 表的 `turbopuffer_namespace/turbopuffer_doc_id` 字段（已有，可转为“本阶段实际使用”）
  - Search Tool 的配置与索引状态优先写入 `tool.metadata.search_index`（最小侵入；必要时再加列/索引）
  - turbopuffer 写入时配置 schema（启用 BM25 所需的 `full_text_search`）

## Non-Goals (本阶段不做)

- 不实现完整的数据变更监听（触发器 + 自动重建所有相关 Search Tool 的全量索引），仅定义最小一致性策略与手动/按需重建入口
- 不做大规模的性能工程（全量缓存、复杂队列编排、分布式锁等）；仅要求批量 embedding 与批量 upsert 以达成基本性能
- 不新增 turbopuffer 对外 HTTP API（仍通过主服务内部模块调用）

## Impact

- Affected specs:
  - 新增: `context-search`
  - 修改: `mcp-tool-management`, `turbopuffer-search`
- Affected code (planned in apply stage):
  - 主服务：新增/扩展 Search 相关模块与路由（内部使用），扩展 Tool create 流程触发 chunking + indexing
  - MCP service：支持 `tool.type=search` 的调用分发（v2 模式）以及默认 inputSchema 兜底
  - SQL：必要时补充 tool 表字段/索引与注释（并保持兼容）
- Breaking changes:
  - 无对外破坏性变更（新增 tool.type 与新接口；旧工具不受影响）

