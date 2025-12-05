# Implementation Tasks

## 1. 数据模型和 Schema 定义
- [ ] 1.1 在 `src/supabase/schemas.py` 中定义 MCP 相关的 Pydantic 模型（`McpBase`、`McpCreate`、`McpUpdate`、`McpResponse`）
- [ ] 1.2 确保字段映射正确处理类型转换（`status: int → boolean`，`json_pointer → json_path`）

## 2. Repository 层实现
- [ ] 2.1 在 `src/mcp/repository.py` 创建 `McpInstanceRepositorySupabase` 类，实现 `McpInstanceRepositoryBase` 接口
- [ ] 2.2 实现 `get_by_id()`：通过数据库 ID 查询
- [ ] 2.3 实现 `get_by_api_key()`：通过 api_key 字段查询
- [ ] 2.4 实现 `get_by_user_id()`：通过 user_id 字段查询并返回列表
- [ ] 2.5 实现 `create()`：插入新记录，处理 ID 自动生成
- [ ] 2.6 实现 `update_by_id()`：通过 ID 更新记录
- [ ] 2.7 实现 `update_by_api_key()`：通过 api_key 更新记录
- [ ] 2.8 实现 `delete_by_id()`：通过 ID 删除记录
- [ ] 2.9 实现 `delete_by_api_key()`：通过 api_key 删除记录

## 3. Supabase Repository 扩展
- [ ] 3.1 在 `src/supabase/repository.py` 的 `SupabaseRepository` 类中添加 MCP 相关操作方法
- [ ] 3.2 实现 `create_mcp()`, `get_mcp()`, `get_mcps()`, `update_mcp()`, `delete_mcp()` 方法
- [ ] 3.3 添加适当的异常处理和错误信息

## 4. 依赖注入更新
- [ ] 4.1 修改 `src/mcp/dependencies.py` 的 `get_mcp_instance_service()` 函数
- [ ] 4.2 当 `STORAGE_TYPE == "supabase"` 时返回使用 `McpInstanceRepositorySupabase` 的服务实例
- [ ] 4.3 确保 JSON 存储模式仍可正常工作

## 5. 配置和文档
- [ ] 5.1 在 `src/config.py` 中确认 `STORAGE_TYPE` 配置项支持 `supabase` 值
- [ ] 5.2 更新 `.env.example` 文件，添加 Supabase 配置说明
- [ ] 5.3 更新项目 README 或相关文档，说明存储后端切换方式

## 6. 测试验证
- [ ] 6.1 编写单元测试：测试 `McpInstanceRepositorySupabase` 的所有 CRUD 方法
- [ ] 6.2 编写集成测试：测试完整的 MCP 实例创建、查询、更新、删除流程
- [ ] 6.3 测试字段类型转换：验证 `status` 和 `json_path` 的正确映射
- [ ] 6.4 测试 JSON/JSONB 字段：验证 `docker_info`、`tools_definition`、`register_tools`、`preview_keys` 的序列化
- [ ] 6.5 测试外键约束：验证 `user_id`、`project_id`、`table_id` 的关联关系
- [ ] 6.6 端到端测试：使用 Supabase 后端完整测试所有 MCP API 端点

## 7. 数据迁移（可选）
- [ ] 7.1 创建数据迁移脚本 `scripts/migrate_mcp_to_supabase.py`
- [ ] 7.2 脚本功能：读取 `./data/mcp_instances.json`，将数据导入 Supabase `mcp` 表
- [ ] 7.3 处理字段映射和类型转换
- [ ] 7.4 添加迁移验证逻辑，确保数据完整性

## 8. 部署准备
- [ ] 8.1 确保生产环境的 Supabase `mcp` 表已创建
- [ ] 8.2 更新部署文档，说明环境变量配置
- [ ] 8.3 准备回滚方案（切换回 JSON 存储）
