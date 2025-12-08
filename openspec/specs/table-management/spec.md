# table-management Specification

## Purpose
TBD - created by archiving change refactor-migrate-user-context-to-supabase. Update Purpose after archive.
## Requirements
### Requirement: Table 数据模型
系统 SHALL 提供 `Table` 数据模型，对应 Supabase 数据库的 `table` 表。

#### Scenario: Table 模型结构
- **WHEN** 创建 Table 实例
- **THEN** 模型包含以下字段：
  - `id` (bigint): 主键，对应数据库表的 id
  - `name` (str, optional): 表名称，对应数据库表的 name
  - `project_id` (int, optional): 项目ID，外键关联 project 表的 id
  - `description` (str, optional): 表描述，对应数据库表的 description
  - `data` (dict, optional): JSON 数据，对应数据库表的 data (jsonb 类型)
  - `created_at` (datetime): 创建时间，对应数据库表的 created_at

#### Scenario: 字段类型映射
- **WHEN** Table 模型与数据库交互
- **THEN** ID 字段使用 bigint 类型，data 字段使用 jsonb 类型存储

### Requirement: Table Repository Supabase 实现
系统 SHALL 提供 `TableRepositorySupabase` 类，实现基于 Supabase 的数据访问层。

#### Scenario: 通过用户ID查询 Tables
- **WHEN** 调用 `get_by_user_id(user_id: int)` 方法
- **THEN** 返回该用户下所有项目关联的 Table 列表（通过 project.user_id 关联）

#### Scenario: 通过ID查询 Table
- **WHEN** 调用 `get_by_id(table_id: int)` 方法
- **THEN** 返回对应的 Table 对象，如果不存在则返回 None

#### Scenario: 创建 Table
- **WHEN** 调用 `create` 方法，提供 name, project_id, description, data
- **THEN** 在 Supabase table 表中创建新记录，返回包含 id 和 created_at 的 Table 对象

#### Scenario: 更新 Table
- **WHEN** 调用 `update` 方法，提供 table_id, name, description, data
- **THEN** 更新 Supabase table 表中对应记录，返回更新后的 Table 对象

#### Scenario: 删除 Table
- **WHEN** 调用 `delete(table_id: int)` 方法
- **THEN** 从 Supabase table 表中删除对应记录，返回删除是否成功

#### Scenario: 更新 Table 的 data 字段
- **WHEN** 调用 `update_context_data(table_id: int, data: dict)` 方法
- **THEN** 更新 Supabase table 表中对应记录的 data 字段（jsonb），返回更新后的 Table 对象

### Requirement: Table Service 业务逻辑层
系统 SHALL 提供 `TableService` 类，封装 Table 相关的业务逻辑。

#### Scenario: 获取用户的所有 Tables
- **WHEN** 调用 `get_by_user_id(user_id: int)` 方法
- **THEN** 返回该用户下所有 Tables 的列表

#### Scenario: 获取单个 Table
- **WHEN** 调用 `get_by_id(table_id: int)` 方法
- **THEN** 返回对应的 Table 对象，如果不存在则返回 None

#### Scenario: 创建 Table
- **WHEN** 调用 `create` 方法，提供 user_id, project_id, name, description, data
- **THEN** 验证 user_id 和 project_id 的有效性，创建新的 Table，返回创建的 Table 对象

#### Scenario: 更新 Table
- **WHEN** 调用 `update` 方法，提供 table_id, name, description, data
- **THEN** 如果 Table 不存在则抛出 NotFoundException，否则更新并返回更新后的 Table 对象

#### Scenario: 删除 Table
- **WHEN** 调用 `delete(table_id: int)` 方法
- **THEN** 如果 Table 不存在则抛出 NotFoundException，否则删除 Table

#### Scenario: 在 data 字段中创建数据
- **WHEN** 调用 `create_context_data` 方法，提供 table_id, mounted_json_pointer_path, elements
- **THEN** 在 Table 的 data 字段的指定 JSON 指针路径下创建新数据项，返回创建后的数据

#### Scenario: 从 data 字段获取数据
- **WHEN** 调用 `get_context_data` 方法，提供 table_id, json_pointer_path
- **THEN** 从 Table 的 data 字段的指定 JSON 指针路径获取数据，返回数据内容

#### Scenario: 更新 data 字段中的数据
- **WHEN** 调用 `update_context_data` 方法，提供 table_id, json_pointer_path, elements
- **THEN** 更新 Table 的 data 字段的指定 JSON 指针路径下的数据项，返回更新后的数据

#### Scenario: 删除 data 字段中的数据
- **WHEN** 调用 `delete_context_data` 方法，提供 table_id, json_pointer_path, keys
- **THEN** 从 Table 的 data 字段的指定 JSON 指针路径下删除指定的 keys，返回删除后的数据

#### Scenario: 使用 JMESPath 查询 data 字段
- **WHEN** 调用 `query_context_data_with_jmespath` 方法，提供 table_id, json_pointer_path, query
- **THEN** 在 Table 的 data 字段的指定路径上执行 JMESPath 查询，返回查询结果

#### Scenario: 获取 data 字段结构
- **WHEN** 调用 `get_context_structure` 方法，提供 table_id, json_pointer_path
- **THEN** 返回 Table 的 data 字段的指定路径的数据结构（不包含实际值），只包含类型信息

