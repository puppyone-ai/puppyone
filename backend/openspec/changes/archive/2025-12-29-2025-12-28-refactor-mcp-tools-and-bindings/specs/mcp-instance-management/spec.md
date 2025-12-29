# mcp-instance-management (delta)

## MODIFIED Requirements
### Requirement: MCP 实例数据持久化到 Supabase
系统 SHALL 支持将 MCP v2 实例数据持久化到 Supabase 数据库，使用 `mcp_v2` 表存储实例元数据；MCP v2 实例 SHALL 表示一个可被访问的“分发入口（AEI）”，而不是单一 Context 的绑定配置。

#### Scenario: 创建 MCP 实例并存储到 Supabase
- **GIVEN** 配置 `STORAGE_TYPE=supabase` 且 Supabase 连接正常
- **WHEN** 调用 `McpService.create_mcp_instance()` 创建新实例
- **THEN** 实例数据插入 Supabase `mcp_v2` 表
- **AND** 数据库自动生成 `id` 字段
- **AND** 返回的 `McpInstance` 对象包含转换后的 `mcp_instance_id`（字符串格式的 id）

#### Scenario: MCP 实例不包含 Context 绑定字段
- **GIVEN** 新版 MCP 实例模型采用“去 Context 化”设计
- **WHEN** 创建或更新 MCP 实例
- **THEN** `mcp` 表记录中 SHALL 不再依赖 `table_id/json_path/tools_definition/register_tools/preview_keys` 来驱动运行时工具列表
- **AND** MCP 暴露的工具列表 SHALL 由 `mcp_binding` 决定（见 `mcp-tool-management`）

#### Scenario: MCP v2 实例与旧 mcp 实例并存
- **GIVEN** 系统已存在历史 `mcp` 表与旧实例数据
- **WHEN** 系统启用 MCP v2
- **THEN** 系统 SHALL 保留旧 `mcp` 表用于兼容/迁移
- **AND** 新增的实例 SHALL 写入 `mcp_v2` 表

### Requirement: 字段映射和类型转换
系统 SHALL 在 Repository 层正确处理 `McpInstance` 模型与 Supabase 表结构的字段差异，并在升级后移除不再适用的字段映射逻辑。

#### Scenario: mcp_instance_id 与 id 的映射
- **GIVEN** 数据库 `mcp` 表的主键字段为 `id` (bigint)
- **WHEN** Repository 查询或插入数据
- **THEN** `id` (bigint) 转换为 `mcp_instance_id` (str)
- **AND** `mcp_instance_id` (str) 转换为 `id` (bigint) 用于数据库操作

#### Scenario: status 类型转换 (int ↔ boolean)
- **GIVEN** `McpInstance` 模型中 `status` 为 int 类型（0 表示关闭，1 表示开启）
- **AND** Supabase `mcp` 表中 `status` 为 boolean 类型
- **WHEN** Repository 执行数据库操作
- **THEN** 写入时 `status = 0` 转换为 `False`，`status = 1` 转换为 `True`
- **AND** 读取时 `False` 转换为 `status = 0`，`True` 转换为 `status = 1`

### Requirement: Supabase Schema 定义
系统 SHALL 定义与 `mcp` 表对应的 Pydantic 模型，用于数据验证和类型检查；新版 `mcp` 模型 SHALL 聚焦于 AEI 元数据字段。

#### Scenario: 定义 McpCreate schema（去 Context 化）
- **GIVEN** 需要创建新的 MCP 实例
- **WHEN** 使用 `McpCreate` 模型
- **THEN** 模型包含 MCP 实例元数据字段（例如：`api_key`, `user_id`, `name`, `status` 等）
- **AND** 模型 SHALL 不再要求 `table_id/json_path/tools_definition/register_tools/preview_keys`
- **AND** 不包含 `id` 和 `created_at`（由数据库生成）

#### Scenario: 定义 McpUpdate schema（去 Context 化）
- **GIVEN** 需要更新现有 MCP 实例
- **WHEN** 使用 `McpUpdate` 模型
- **THEN** 仅包含可更新的实例元数据字段
- **AND** SHALL 不再支持通过更新 MCP 实例字段来变更运行时工具列表

## REMOVED Requirements
### Requirement: 外键关联验证
**Reason**: MCP 实例不再直接绑定单一 `project/table/json_path`，其权限与可访问范围由绑定的 Tool 决定，因此该 requirement 的表述不再准确。
**Migration**: 将外键/权限校验迁移到 Tool/Binding 层（见 `mcp-tool-management`），对 `tool.table_id` 的归属做强校验。


