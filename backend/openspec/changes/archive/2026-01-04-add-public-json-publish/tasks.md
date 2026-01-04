## 1. Implementation
- [x] 1.1 定义 Supabase 数据模型：新增 `context_publish` 表（字段、索引、唯一约束：`publish_key` 唯一）
- [x] 1.2 新增后端模块 `src/context_publish/`：schemas/models/repository/service/router
- [x] 1.3 管理端点（需登录）：
  - [x] `POST /api/v1/publishes` 创建 publish（校验 table 归属/权限；生成 publish_key；返回可访问 URL）
  - [x] `GET /api/v1/publishes` 列出当前用户 publish
  - [x] `PATCH /api/v1/publishes/{id}` 更新 status/expires_at（至少支持禁用）
  - [x] `DELETE /api/v1/publishes/{id}` 删除（或 revoke）
- [x] 1.4 公开读取端点（无需登录）：
  - [x] `GET /p/{publish_key}` 返回 raw JSON（`application/json`，短链接形态）
  - [x] 语义：disabled/expired/not found → NOT_FOUND；json_path 不存在 → NOT_FOUND
- [x] 1.5 缓存：对 `publish_key -> publish_record` 做进程内缓存（短 TTL），并在 update/revoke/delete 时失效
- [x] 1.6 路由注册：在 `src/main.py` include 新 router（保持与现有 `/api/v1` 结构一致）

## 2. Validation
- [x] 2.1 添加基础测试（至少覆盖：创建 publish、公开读取成功、禁用后 404）
- [x] 2.2 补充 API 文档说明（README 或 docs 中新增一段 curl 示例）


