# TODO

## [x] Supabase table 导入

### 核心功能
- **双 Key 类型支持**：支持 `anon`（推荐）和 `service_role` 两种 API Key
- **新 Key 格式兼容**：支持 Supabase 新旧两种 Key 格式
- **手动表名输入**：自动列表受限时允许手动输入表名继续流程
- **RLS 引导**：0 rows 场景显示 Row Level Security 配置指南和可复制的 SQL 示例
- **详细错误提示**：连接失败时显示具体错误码和解决建议

---

## [ ] 安全存储用户的敏感信息

**背景**：`db_connections.config` JSONB 字段当前未加密存储以下内容：
- `project_url`
- `api_key`（anon key 或 service_role key）
- `key_type`

**需求**：实现应用层加密/脱敏
