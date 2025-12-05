## 1. 模型层重构
- [x] 1.1 创建新的 `Table` 模型（`src/user_context/models.py`），对应 Supabase `table` 表结构
- [x] 1.2 移除 `metadata` 字段
- [x] 1.3 将 `context_id` 改为 `id` (bigint)
- [x] 1.4 将 `user_id` 和 `project_id` 改为 bigint 类型
- [x] 1.5 将 `context_data` 映射到 `data` 字段（jsonb）

## 2. Repository 层迁移
- [x] 2.1 创建 `TableRepositorySupabase` 类，实现 `TableRepositoryBase` 接口
- [x] 2.2 实现 `get_by_user_id` 方法（通过 project_id 关联查询）
- [x] 2.3 实现 `get_by_id` 方法
- [x] 2.4 实现 `create` 方法
- [x] 2.5 实现 `update` 方法（去掉 metadata 参数）
- [x] 2.6 实现 `delete` 方法
- [x] 2.7 实现 `update_context_data` 方法（更新 data 字段）
- [x] 2.8 检查并扩展 `SupabaseRepository` 的 Table 相关方法（如需要）

## 3. Service 层重构
- [x] 3.1 将 `UserContextService` 重命名为 `TableService`
- [x] 3.2 更新所有方法签名（ID 类型改为 bigint，去掉 metadata 参数）
- [x] 3.3 更新 `get_by_user_id` 方法以使用新的 Repository
- [x] 3.4 更新 `get_by_id` 方法
- [x] 3.5 更新 `create` 方法（去掉 metadata 参数）
- [x] 3.6 更新 `update` 方法（去掉 metadata 参数）
- [x] 3.7 更新 `delete` 方法
- [x] 3.8 更新所有 `context_data` 相关方法（使用新的 data 字段）

## 4. Schemas 层更新
- [x] 4.1 更新 `TableCreate` schema（去掉 metadata，ID 改为 bigint）
- [x] 4.2 更新 `TableUpdate` schema（去掉 metadata）
- [x] 4.3 更新 `TableOut` schema（去掉 metadata，ID 改为 bigint）
- [x] 4.4 更新 `ContextDataElement`、`ContextDataCreate`、`ContextDataUpdate`、`ContextDataDelete`、`ContextDataGet` schemas（如需要）

## 5. Router 层更新
- [x] 5.1 更新所有路由处理函数以使用 `TableService`
- [x] 5.2 更新路径参数类型（ID 从 str 改为 int）
- [x] 5.3 更新请求和响应模型
- [x] 5.4 验证 API 路径保持不变

## 6. 依赖注入更新
- [x] 6.1 更新 `get_user_context_service` 函数（改为 `get_table_service`）
- [x] 6.2 更新依赖注入以使用 `TableRepositorySupabase`
- [x] 6.3 移除对 JSON repository 的依赖

## 7. MCP 服务依赖更新
- [x] 7.1 更新 `src/mcp/server/server.py` 中的 `_init_table_info_and_tool_definition_provider` 函数
- [x] 7.2 更新 `get_user_context_service` 调用为 `get_table_service`
- [x] 7.3 更新 context 对象的使用（从 `UserContext` 改为 `Table`）
- [x] 7.4 更新 `src/mcp/server/tools/table_tool.py` 中的所有调用（已从context_tool.py重命名为table_tool.py）
- [x] 7.5 更新工具方法中的 service 调用（ID 类型改为 bigint）
- [x] 7.6 将所有context相关命名改为table（包括文件名、类名、变量名、prompt描述）

## 8. Auth 层迁移
- [x] 8.1 创建 `UserRepositorySupabase` 类，实现 `UserRepositoryBase` 接口
- [x] 8.2 实现所有必需的方法（get_all, get_by_id, create, update, delete）
- [x] 8.3 更新 `UserService` 以使用新的 Repository（如需要）
- [x] 8.4 更新 `get_user_service` 依赖注入函数
- [x] 8.5 更新 `User` 模型以匹配 Supabase `user_temp` 表结构（如需要）

## 9. 测试和验证
- [x] 9.1 测试 Table CRUD 操作
- [x] 9.2 测试 context_data 相关操作（create, get, update, delete）
- [x] 9.3 测试 JMESPath 查询功能
- [x] 9.4 测试 MCP 服务中的 context 获取
- [x] 9.5 测试 Auth 层的用户操作
- [x] 9.6 验证所有 API 端点正常工作
- [x] 9.7 检查类型转换和错误处理

## 10. 清理工作
- [x] 10.1 删除 `UserContextRepositoryJSON` 类（已完成，包名已从user_context改为table）
- [x] 10.2 删除 `UserRepositoryJSON` 类（已完成）
- [ ] 10.3 删除旧的 JSON 数据文件（可选，建议保留作为备份）
- [x] 10.4 更新导入语句和类型注解（已完成，所有context相关命名已改为table）
- [x] 10.5 运行代码检查工具（ruff）确保代码质量
