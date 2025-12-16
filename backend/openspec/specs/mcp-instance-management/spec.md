# mcp-instance-management Specification

## Purpose
TBD - created by archiving change refactor-migrate-mcp-storage-to-supabase. Update Purpose after archive.
## Requirements
### Requirement: MCP 实例数据持久化到 Supabase
系统 SHALL 支持将 MCP 实例数据持久化到 Supabase 数据库，使用 `mcp` 表存储实例元数据。

#### Scenario: 创建 MCP 实例并存储到 Supabase
- **GIVEN** 配置 `STORAGE_TYPE=supabase` 且 Supabase 连接正常
- **WHEN** 调用 `McpService.create_mcp_instance()` 创建新实例
- **THEN** 实例数据插入 Supabase `mcp` 表
- **AND** 数据库自动生成 `id` 字段
- **AND** 返回的 `McpInstance` 对象包含转换后的 `mcp_instance_id`（字符串格式的 id）

#### Scenario: 通过 ID 查询 MCP 实例
- **GIVEN** Supabase `mcp` 表中存在 ID 为 123 的实例
- **WHEN** 调用 `repository.get_by_id("123")`
- **THEN** 从数据库查询 `id = 123` 的记录
- **AND** 返回映射后的 `McpInstance` 对象
- **AND** 字段正确转换（`json_path` → `json_pointer`, `status` boolean → int）

#### Scenario: 通过 API Key 查询 MCP 实例
- **GIVEN** Supabase `mcp` 表中存在 `api_key = "xxx"` 的实例
- **WHEN** 调用 `repository.get_by_api_key("xxx")`
- **THEN** 从数据库查询 `api_key = "xxx"` 的记录
- **AND** 返回映射后的 `McpInstance` 对象

#### Scenario: 更新 MCP 实例
- **GIVEN** Supabase `mcp` 表中存在 ID 为 123 的实例
- **WHEN** 调用 `repository.update_by_id("123", ...)` 更新字段
- **THEN** 更新数据库记录
- **AND** 字段映射正确（`json_pointer` → `json_path`, `status` int → boolean）
- **AND** 返回更新后的 `McpInstance` 对象

#### Scenario: 删除 MCP 实例
- **GIVEN** Supabase `mcp` 表中存在 ID 为 123 的实例
- **WHEN** 调用 `repository.delete_by_id("123")`
- **THEN** 从数据库删除 `id = 123` 的记录
- **AND** 返回 `True` 表示删除成功

#### Scenario: 实例不存在时的处理
- **GIVEN** Supabase `mcp` 表中不存在 ID 为 999 的实例
- **WHEN** 调用 `repository.get_by_id("999")`
- **THEN** 返回 `None`

### Requirement: 字段映射和类型转换
系统 SHALL 在 Repository 层正确处理 `McpInstance` 模型与 Supabase 表结构的字段差异。

#### Scenario: mcp_instance_id 与 id 的映射
- **GIVEN** 数据库 `mcp` 表的主键字段为 `id` (bigint)
- **WHEN** Repository 查询或插入数据
- **THEN** `id` (bigint) 转换为 `mcp_instance_id` (str)
- **AND** `mcp_instance_id` (str) 转换为 `id` (bigint) 用于数据库操作

#### Scenario: json_pointer 与 json_path 的映射
- **GIVEN** `McpInstance` 模型使用字段 `json_pointer`
- **AND** Supabase `mcp` 表使用字段 `json_path`
- **WHEN** Repository 执行数据库操作
- **THEN** 写入时 `json_pointer` 映射为 `json_path`
- **AND** 读取时 `json_path` 映射为 `json_pointer`

#### Scenario: status 类型转换 (int ↔ boolean)
- **GIVEN** `McpInstance` 模型中 `status` 为 int 类型（0 表示关闭，1 表示开启）
- **AND** Supabase `mcp` 表中 `status` 为 boolean 类型
- **WHEN** Repository 执行数据库操作
- **THEN** 写入时 `status = 0` 转换为 `False`，`status = 1` 转换为 `True`
- **AND** 读取时 `False` 转换为 `status = 0`，`True` 转换为 `status = 1`

#### Scenario: JSONB 字段的序列化
- **GIVEN** `McpInstance` 包含字段 `docker_info`, `tools_definition`, `register_tools`, `preview_keys` (Dict/List 类型)
- **WHEN** Repository 写入数据到 Supabase
- **THEN** 字典和列表自动序列化为 JSONB 格式
- **AND** 读取时自动反序列化为 Python 对象

### Requirement: 外键关联验证
系统 SHALL 依赖 Supabase 数据库的外键约束，确保 MCP 实例关联的 user、project、table 存在。

#### Scenario: 创建实例时关联的 user_id 不存在
- **GIVEN** Supabase `user_temp` 表中不存在 `user_id = 999`
- **WHEN** 调用 `repository.create(user_id="999", ...)`
- **THEN** 数据库返回外键约束错误
- **AND** Repository 捕获并转换为 `SupabaseException`
- **AND** 错误信息包含 "外键约束" 相关描述

#### Scenario: 创建实例时关联的 project_id 不存在
- **GIVEN** Supabase `project` 表中不存在 `project_id = 999`
- **WHEN** 调用 `repository.create(project_id="999", ...)`
- **THEN** 数据库返回外键约束错误
- **AND** Repository 捕获并转换为 `SupabaseException`

#### Scenario: 创建实例时关联的 table_id 不存在
- **GIVEN** Supabase `table` 表中不存在 `table_id = 999`
- **WHEN** 调用 `repository.create(table_id="999", ...)`
- **THEN** 数据库返回外键约束错误
- **AND** Repository 捕获并转换为 `SupabaseException`

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
系统 SHALL 定义与 `mcp` 表对应的 Pydantic 模型，用于数据验证和类型检查。

#### Scenario: 定义 McpCreate schema
- **GIVEN** 需要创建新的 MCP 实例
- **WHEN** 使用 `McpCreate` 模型
- **THEN** 模型包含所有必需字段：`api_key`, `user_id`, `project_id`, `table_id`, `json_path`, `status`, `port`, `docker_info`
- **AND** 可选字段：`tools_definition`, `register_tools`, `preview_keys`
- **AND** 不包含 `id` 和 `created_at`（由数据库生成）

#### Scenario: 定义 McpUpdate schema
- **GIVEN** 需要更新现有 MCP 实例
- **WHEN** 使用 `McpUpdate` 模型
- **THEN** 所有字段均为可选（`Optional`）
- **AND** 支持部分更新（只更新提供的字段）

#### Scenario: 定义 McpResponse schema
- **GIVEN** 需要返回 MCP 实例数据
- **WHEN** 使用 `McpResponse` 模型
- **THEN** 模型包含所有字段，包括 `id` 和 `created_at`
- **AND** 支持从数据库记录自动映射（`from_attributes = True`）

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

