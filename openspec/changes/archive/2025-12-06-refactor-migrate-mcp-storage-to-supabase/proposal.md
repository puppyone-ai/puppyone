# Change: 将 MCP 模块存储从磁盘 JSON 迁移到 Supabase

## Why

当前 MCP 实例数据存储在本地 JSON 文件 (`./data/mcp_instances.json`) 中，存在以下问题：
- **可扩展性限制**：多实例部署时无法共享状态，导致实例间数据不一致
- **并发安全问题**：高并发下文件读写可能导致数据损坏或丢失
- **运维复杂度**：需要额外的文件系统备份和恢复机制
- **架构不一致**：项目其他模块（user、project、table）已使用 Supabase，MCP 模块使用 JSON 造成架构分裂

迁移到 Supabase 将实现：
- 统一的数据存储架构
- 更好的并发控制和事务支持
- 自动化的备份和恢复
- 支持分布式部署

## What Changes

- 创建 `McpInstanceRepositorySupabase` 实现类，使用 Supabase 的 `mcp` 表
- 新增 Supabase schemas：`McpCreate`、`McpUpdate`、`McpResponse`
- 更新 `get_mcp_instance_service()` 依赖注入，支持 Supabase 存储后端
- 调整字段映射：
  - `mcp_instance_id` (str) → `id` (bigint，数据库自动生成)
  - `json_pointer` (str) → `json_path` (text)
  - `status` (int) → `status` (boolean)
- 保持现有 `McpInstanceRepositoryJSON` 实现作为兼容选项
- 保持所有公共 API 接口不变

## Impact

### 影响的 specs
- **新增能力**：`mcp-instance-management`（新增 spec）

### 影响的代码
- `src/mcp/repository.py`：新增 `McpInstanceRepositorySupabase` 类
- `src/mcp/dependencies.py`：更新依赖注入逻辑，支持 `supabase` 存储类型
- `src/supabase/schemas.py`：新增 MCP 相关 Pydantic 模型
- `src/supabase/repository.py`：新增 MCP 表 CRUD 操作方法
- `src/config.py`：配置项 `STORAGE_TYPE` 支持新值 `supabase`
- `sql/mcp.sql`：数据库表结构已存在，无需修改

### Breaking Changes
无。通过配置开关实现平滑迁移，默认保持 JSON 存储以保证向后兼容。

### Migration Path
1. 确保 Supabase 的 `mcp` 表已创建（使用 `sql/mcp.sql`）
2. 设置环境变量 `STORAGE_TYPE=supabase`
3. （可选）运行数据迁移脚本将现有 JSON 数据导入 Supabase
4. 验证功能正常后，可移除 JSON 文件
