# Change: 重构迁移 user_context 模块到 Supabase

## Why

当前 `user_context` 模块使用 JSON 文件存储，需要迁移到 Supabase 数据库的 `table` 表，以实现：
1. 数据持久化和可靠性提升
2. 与 Supabase 的 `user_temp` 和 `project` 表建立外键关系
3. 统一数据存储层，简化架构
4. 支持更好的查询和事务能力

同时，需要将 auth 层也迁移到 Supabase 的 `user_temp` 表，确保整个系统的数据存储一致性。

## What Changes

**BREAKING** - 本次重构不考虑版本兼容性，直接全面迁移：

1. **user_context 模块重构**：
   - 将 `UserContext` 模型改为对应 Supabase `table` 表结构
   - 去掉 `metadata` 字段
   - `context_data` 对应 `table.data` (jsonb 类型)
   - `context_id` 改为 `table.id` (bigint 类型)
   - `user_id` 和 `project_id` 改为 bigint 类型，对应 `user_temp.id` 和 `project.id`
   - Repository 层从 `UserContextRepositoryJSON` 改为 `TableRepositorySupabase`
   - 内部命名从 `UserContext` 改为 `Table`（模型、服务、schemas）

2. **MCP 服务依赖更新**：
   - `src/mcp/server/server.py` 中的 `get_user_context_service()` 改为从 Supabase 获取数据
   - `src/mcp/server/tools/context_tool.py` 中的 `get_user_context_service()` 改为从 Supabase 获取数据

3. **Auth 层迁移**：
   - `src/auth/repository.py` 从 `UserRepositoryJSON` 改为 `UserRepositorySupabase`
   - 使用 Supabase 的 `user_temp` 表存储用户数据

4. **保持不变**：
   - ETL 层和 S3 层不需要修改
   - API 路由路径保持不变（向后兼容）

## Impact

- **Affected specs**: 需要新增 `table-management` 能力规范
- **Affected code**:
  - `src/user_context/` - 全面重构
  - `src/mcp/server/server.py` - 更新依赖
  - `src/mcp/server/tools/context_tool.py` - 更新依赖
  - `src/auth/repository.py` - 迁移到 Supabase
  - `src/supabase/repository.py` - 可能需要扩展 Table 相关方法
- **Database**: 使用 Supabase 的 `table` 表，需要确保表结构已创建
- **Breaking changes**: 
  - 数据存储格式从 JSON 文件改为 Supabase 数据库
  - ID 类型从字符串改为 bigint
  - 去掉 `metadata` 字段
  - 所有相关 API 的响应格式可能变化（ID 类型）
