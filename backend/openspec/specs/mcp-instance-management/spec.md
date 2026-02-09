# mcp-instance-management Specification

## Purpose
TBD - created by archiving change refactor-migrate-mcp-storage-to-supabase. Update Purpose after archive.
## Requirements
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

### Requirement: 存储后端切换支持
系统 SHALL 通过配置项 `STORAGE_TYPE` 支持在 JSON 文件存储和 Supabase 存储之间切换。

#### Scenario: 使用 JSON 存储后端
- **GIVEN** 环境变量 `STORAGE_TYPE=json`
- **WHEN** 应用启动并初始化依赖注入
- **THEN** `get_mcp_instance_service()` 返回使用 `McpInstanceRepositoryJSON` 的服务实例
- **AND** 所有 MCP 实例数据读写操作使用 `./data/mcp_instances.json` 文件

#### Scenario: 使用 Supabase 存储后端
- **GIVEN** 环境变量 `STORAGE_TYPE=supabase`
- **WHEN** 应用启动并初始化依赖注入
- **THEN** `get_mcp_instance_service()` 返回使用 `McpInstanceRepositorySupabase` 的服务实例
- **AND** 所有 MCP 实例数据读写操作使用 Supabase `mcp` 表

#### Scenario: 配置不支持的存储类型
- **GIVEN** 环境变量 `STORAGE_TYPE=redis`（不支持）
- **WHEN** 应用启动并调用 `get_mcp_instance_service()`
- **THEN** 抛出 `ValueError` 异常
- **AND** 错误信息为 "Unsupported storage type: redis"

### Requirement: Supabase Repository 扩展
`SupabaseRepository` 类 SHALL 提供 MCP 表的 CRUD 操作方法，遵循与 user、project、table 一致的命名和实现模式。

#### Scenario: 通过 SupabaseRepository 创建 MCP 记录
- **GIVEN** 初始化 `SupabaseRepository` 实例
- **WHEN** 调用 `repository.create_mcp(mcp_data: McpCreate)`
- **THEN** 数据插入 `mcp` 表
- **AND** 返回 `McpResponse` 对象，包含自动生成的 `id` 和 `created_at`

#### Scenario: 通过 SupabaseRepository 查询单个 MCP 记录
- **GIVEN** `mcp` 表中存在 ID 为 123 的记录
- **WHEN** 调用 `repository.get_mcp(mcp_id=123)`
- **THEN** 返回 `McpResponse` 对象
- **AND** 包含完整的 MCP 实例数据

#### Scenario: 通过 SupabaseRepository 查询 MCP 列表
- **GIVEN** `mcp` 表中存在多条记录
- **WHEN** 调用 `repository.get_mcps(user_id=1, skip=0, limit=10)`
- **THEN** 返回 `List[McpResponse]`，包含指定 user_id 的所有记录
- **AND** 支持分页查询（skip 和 limit）

#### Scenario: 通过 SupabaseRepository 更新 MCP 记录
- **GIVEN** `mcp` 表中存在 ID 为 123 的记录
- **WHEN** 调用 `repository.update_mcp(mcp_id=123, mcp_data: McpUpdate)`
- **THEN** 更新数据库记录
- **AND** 返回更新后的 `McpResponse` 对象

#### Scenario: 通过 SupabaseRepository 删除 MCP 记录
- **GIVEN** `mcp` 表中存在 ID 为 123 的记录
- **WHEN** 调用 `repository.delete_mcp(mcp_id=123)`
- **THEN** 删除数据库记录
- **AND** 返回 `True` 表示删除成功

### Requirement: 错误处理和异常转换
系统 SHALL 在 Repository 层捕获 Supabase 特定异常，并转换为项目统一的异常类型。

#### Scenario: Supabase 连接失败
- **GIVEN** Supabase 服务不可达或凭据错误
- **WHEN** Repository 执行任何数据库操作
- **THEN** 捕获 Supabase 客户端异常
- **AND** 转换为 `SupabaseException`
- **AND** 错误信息包含操作描述（如 "创建 MCP 实例"）

#### Scenario: 数据验证失败
- **GIVEN** 插入数据违反数据库约束（如非空字段为空）
- **WHEN** Repository 执行 `create()` 或 `update()` 操作
- **THEN** 捕获数据库约束错误
- **AND** 转换为 `SupabaseException`
- **AND** 错误信息描述具体的验证失败原因

#### Scenario: 记录不存在时的更新或删除
- **GIVEN** 尝试更新或删除不存在的记录
- **WHEN** Repository 执行 `update_by_id()` 或 `delete_by_id()`
- **THEN** 操作返回 `None` 或 `False`
- **AND** 不抛出异常（由上层 Service 决定如何处理）

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

### Requirement: 向后兼容性保证
系统 SHALL 保持现有 API 接口和业务逻辑不变，迁移对调用方透明。

#### Scenario: API 端点行为不变
- **GIVEN** 切换存储后端从 JSON 到 Supabase
- **WHEN** 客户端调用任何 MCP API 端点（`POST /mcp/`, `GET /mcp/{api_key}`, 等）
- **THEN** 请求和响应格式保持完全一致
- **AND** 业务逻辑行为无变化
- **AND** 客户端无需修改任何代码

#### Scenario: McpInstance 模型接口不变
- **GIVEN** 现有代码依赖 `McpInstance` 模型
- **WHEN** 切换存储后端
- **THEN** `McpInstance` 模型字段和类型保持不变
- **AND** Service 层代码无需修改

#### Scenario: 进程管理逻辑不变
- **GIVEN** MCP 服务器进程管理逻辑（创建、启动、停止、状态监控）
- **WHEN** 切换存储后端
- **THEN** 进程管理逻辑完全不受影响
- **AND** 端口分配、Docker 容器管理等行为保持一致

### Requirement: 创建 MCP v2 并批量绑定 Tool（原子）
系统 SHALL 提供一个原子化接口，用于在创建 MCP v2 实例的同时批量绑定多个 Tool；当任一 Tool 绑定失败时，系统 SHALL 回滚本次创建的 MCP v2 实例与已创建的绑定关系，避免产生“空入口/半绑定”的中间态。

#### Scenario: 创建 MCP v2 并批量绑定成功
- **GIVEN** 当前用户已创建多个 Tool，且这些 Tool 均归属于该用户
- **WHEN** 用户调用 `POST /mcp_v2/with_bindings` 并提供 `name` 以及 `bindings=[{tool_id,status}, ...]`
- **THEN** 系统创建一条新的 `mcp_v2` 记录（含 `api_key`）
- **AND** 系统为列表中的每个 `tool_id` 创建或更新 `mcp_binding(mcp_id, tool_id)` 记录并设置对应 `status`
- **AND** 返回包含 `mcp_v2.id` 与 `api_key` 的响应

#### Scenario: Tool 不存在或不属于当前用户时整体失败并回滚
- **GIVEN** 请求的 `bindings` 中包含一个不存在的 `tool_id`，或包含一个归属其他用户的 `tool_id`
- **WHEN** 用户调用 `POST /mcp_v2/with_bindings`
- **THEN** 系统返回 NOT_FOUND（或等价的业务错误）
- **AND** 系统 SHALL 不保留本次创建的 `mcp_v2` 记录
- **AND** 系统 SHALL 不保留本次已创建的任何 `mcp_binding` 记录

#### Scenario: 同一 MCP v2 内 Tool.name 冲突时整体失败并回滚
- **GIVEN** 请求的 `bindings` 中包含两个 Tool 且它们的 `tool.name` 相同
- **WHEN** 用户调用 `POST /mcp_v2/with_bindings`
- **THEN** 系统返回 VALIDATION_ERROR（或等价的业务错误，包含冲突的 `tool.name`）
- **AND** 系统 SHALL 不保留本次创建的 `mcp_v2` 记录
- **AND** 系统 SHALL 不保留本次已创建的任何 `mcp_binding` 记录

### Requirement: MCP v2 通过代理端点访问共享 MCP Service
系统 SHALL 提供 MCP v2 的代理访问端点，使客户端可仅凭 `mcp_v2.api_key` 访问共享 `mcp_service` 的 MCP 协议接口（如 `tools/list`、`tools/call`）；代理端点 SHALL 负责基本拦截与转发，并注入 `X-API-KEY` 以实现多租户隔离。

#### Scenario: 通过 mcp_v2 代理端点访问 tools/list
- **GIVEN** 存在启用状态的 `mcp_v2` 实例，且已绑定至少一个启用的 Tool
- **WHEN** 客户端调用 `POST /api/v1/mcp_v2/server/{api_key}` 并发送 MCP JSON-RPC `tools/list`
- **THEN** 代理端点将请求转发到共享 `mcp_service`（下游 `/mcp/*`）
- **AND** 代理端点在下游请求头中注入 `X-API-KEY={api_key}`
- **AND** 客户端获得由绑定 Tool 生成的工具列表

#### Scenario: mcp_v2 被禁用时代理端点拒绝访问
- **GIVEN** `mcp_v2.status=false`
- **WHEN** 客户端调用 `POST /api/v1/mcp_v2/server/{api_key}`
- **THEN** 系统返回 NOT_FOUND（或等价的“实例不可用”错误）
- **AND** 请求不会被转发到下游 `mcp_service`

