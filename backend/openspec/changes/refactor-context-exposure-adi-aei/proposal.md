# Change: 重构 Context 分发方式：引入 ADI/AEI 并支持多 Context 工具组合发布

## Why
当前系统把“数据操作工具”紧耦合在 MCP Instance/MCP Server 语义里，导致：
- 分发入口被锁死在 MCP（难以扩展到 API/CLI/agent skills 等其他渠道）
- 一个 MCP 实例只能绑定单个 Context（`table_id + json_path`），无法在一个入口里跨 Context 管理/操作
- 工具（create/query/get_schema 等）缺少独立实体与复用边界，难以组合、治理与演进

## What Changes
- 引入 **ADI（Agent Data Interface）**：将对 Context 的数据操作抽象为可复用的“数据接口单元”，与 MCP 解耦。
- 引入 **AEI（Agent Exposure Interface）**：将“对外暴露/分发方式”抽象出来，阶段 1 仅实现 **AEI=MCP Server**。
- 新增 **组合发布能力**：允许将多个 ADI 绑定到一个 AEI（MCP）并注册为工具集合（一个 MCP Server 暴露多个 Context/多个操作）。
- **兼容策略（阶段 1）**：保留现有 MCP Instance 管理与代理入口；新增 v2 能力以“并行方式”提供（不强行破坏现有调用方）。

## Impact
- **Affected specs（新增）**：
  - `agent-data-interface`
  - `agent-exposure-interface`
  - `context-exposure-bundles`
- **Potentially affected specs（后续阶段可能修改）**：
  - `mcp-instance-management`（若将旧 MCP Instance 完全迁移到 AEI/Bundle 体系）
- **Affected code（预计）**：
  - MCP 代理与 internal 配置加载：`src/mcp/*`、`src/internal/router.py`
  - MCP Server 实现：`mcp_service/*`
  - 数据层：新增 ADI/AEI/绑定相关持久化（Supabase 表/Repository/Service）


