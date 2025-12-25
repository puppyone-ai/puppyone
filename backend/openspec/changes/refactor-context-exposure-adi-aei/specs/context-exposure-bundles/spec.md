## ADDED Requirements
### Requirement: 将多个 ADI 组合发布为一个 AEI(MCP) 的工具集合
系统 SHALL 支持将多个 ADI 绑定到同一个 AEI(MCP)，并把每个绑定发布为一个 MCP tool，使单个 MCP 入口可跨 Context 操作。

#### Scenario: 绑定多个 ADI 到一个 AEI(MCP)
- **GIVEN** 用户拥有 AEI(MCP) 与多个 ADI
- **WHEN** 用户为该 AEI 创建 bindings，分别绑定不同的 ADI
- **THEN** AEI 的 tool 集合包含这些 bindings

#### Scenario: 同一 AEI 内 tool_name 必须唯一
- **GIVEN** AEI(MCP) 已存在 binding `tool_name="query"`
- **WHEN** 用户尝试创建另一个 binding 且 `tool_name="query"`
- **THEN** 系统 MUST 拒绝该请求并返回可诊断的错误

#### Scenario: 绑定必须满足权限与归属约束
- **GIVEN** AEI 归属用户 A
- **AND** ADI 归属用户 B
- **WHEN** 用户 A 尝试把该 ADI 绑定到自己的 AEI
- **THEN** 系统 MUST 拒绝该绑定（403 或等价的权限错误）

### Requirement: tool 定义归属在 binding 层（阶段 1）
系统 SHALL 将 MCP tool 的定义（至少包括 `tool_name`、`tool_description`、`input_schema`）归属在 binding 层，以便同一个 ADI 可在不同 AEI 中以不同工具形态暴露。

#### Scenario: 同一个 ADI 可被不同 AEI 以不同 tool_name 暴露
- **GIVEN** 一个 ADI（例如 `operation_type="query_data"`）
- **WHEN** 用户将该 ADI 分别绑定到两个不同的 AEI(MCP)，并设置不同的 `tool_name`
- **THEN** 两个 AEI 的 list_tools 返回各自 binding 定义的 tool_name/description/schema

### Requirement: 默认工具生成策略（阶段 1）
系统 SHALL 支持为 bindings 提供默认工具命名与描述生成策略，以降低用户手工配置成本。

#### Scenario: 未提供 tool_name 时生成默认名称
- **GIVEN** 用户创建 binding 时未提供 `tool_name`
- **WHEN** 系统根据 ADI 的 `operation_type + table_id + json_path` 生成默认工具名
- **THEN** 生成的 `tool_name` 在 AEI 内唯一
- **AND** 默认格式为 `{op}_{short_hash}`


