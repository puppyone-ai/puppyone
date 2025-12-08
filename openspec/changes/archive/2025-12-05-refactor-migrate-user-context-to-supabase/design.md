# Design: 迁移 user_context 到 Supabase

## Context

当前系统使用 JSON 文件存储 `user_context` 数据，需要迁移到 Supabase 数据库。Supabase 中已有 `table` 表结构，对应原先的 `user_context` 概念。

数据库表结构：
- `table` 表：id (bigint), name (text), project_id (bigint), description (text), data (jsonb), created_at (timestamp)
- `user_temp` 表：id (bigint), name (text), created_at (timestamp)
- `project` 表：id (bigint), name (text), description (text), user_id (bigint), created_at (timestamp)

## Goals / Non-Goals

### Goals
- 将 `user_context` 模块完全迁移到 Supabase `table` 表
- 将 `auth` 模块迁移到 Supabase `user_temp` 表
- 保持 API 接口路径不变（向后兼容）
- 更新所有依赖 `user_context` 服务的代码（主要是 MCP 服务）

### Non-Goals
- 不提供数据迁移脚本（用户明确说明不考虑版本兼容性）
- 不修改 ETL 层和 S3 层
- 不修改 API 路由路径

## Decisions

### Decision 1: 模型命名策略
**决定**: 内部模型和服务类从 `UserContext` 改为 `Table`，但模块目录保持 `user_context` 名称以保持 API 路径不变。

**理由**: 
- 与 Supabase 表名 `table` 保持一致
- 模块目录名保持不变可以避免修改路由注册
- 内部实现可以清晰反映数据源

**替代方案考虑**:
- 完全重命名模块：需要修改所有路由注册，影响更大
- 保持 `UserContext` 命名：与数据库表名不一致，容易混淆

### Decision 2: ID 类型转换
**决定**: 将 `context_id`、`user_id`、`project_id` 从字符串类型改为 bigint 类型。

**理由**:
- Supabase 表使用 bigint 作为主键
- 数据库外键关系需要类型一致
- 减少类型转换开销

**影响**:
- API 请求和响应中的 ID 需要改为整数类型
- 需要更新所有使用这些 ID 的地方

### Decision 3: metadata 字段移除
**决定**: 完全移除 `metadata` 字段，不提供迁移路径。

**理由**:
- 用户明确要求去掉 metadata
- `table` 表结构中没有 metadata 字段
- 简化数据模型

### Decision 4: Repository 实现策略
**决定**: 创建 `TableRepositorySupabase` 实现，使用现有的 `SupabaseRepository` 作为基础。

**理由**:
- `SupabaseRepository` 已经提供了 `table` 表的 CRUD 操作
- 可以复用现有代码，减少重复
- 保持代码一致性

### Decision 5: Service 层重构
**决定**: 将 `UserContextService` 重命名为 `TableService`，但保持相同的业务逻辑方法。

**理由**:
- 反映新的数据模型
- 业务逻辑（如 JSON 指针操作、JMESPath 查询）保持不变
- 只需要更新 Repository 依赖

### Decision 6: MCP 服务依赖更新
**决定**: MCP 服务继续使用 service 层，不直接访问 Repository。

**理由**:
- 保持分层架构
- Service 层提供业务逻辑封装
- 便于未来扩展和维护

## Risks / Trade-offs

### Risk 1: 数据类型不匹配
**风险**: API 客户端可能期望字符串类型的 ID，现在改为 bigint 可能导致类型错误。

**缓解**: 
- 这是明确的 breaking change，需要更新客户端代码
- 在 API 文档中明确说明 ID 类型变化

### Risk 2: 数据丢失
**风险**: 迁移过程中如果现有 JSON 数据没有备份，可能丢失数据。

**缓解**:
- 用户明确说明不考虑版本兼容性
- 建议在迁移前备份现有数据

### Risk 3: 性能影响
**风险**: 从文件系统改为数据库查询，可能有性能差异。

**缓解**:
- Supabase 提供索引和查询优化
- 对于大多数场景，数据库查询性能更好
- 可以监控性能指标

## Migration Plan

### Phase 1: 模型和 Repository 层
1. 创建新的 `Table` 模型（对应 `table` 表）
2. 创建 `TableRepositorySupabase` 实现
3. 更新 `SupabaseRepository` 以支持 Table 操作（如需要）

### Phase 2: Service 层
1. 将 `UserContextService` 重构为 `TableService`
2. 更新所有方法以使用新的 Repository
3. 更新方法签名（ID 类型改为 bigint）

### Phase 3: Schemas 和 API 层
1. 更新所有 schemas（去掉 metadata，ID 改为 bigint）
2. 更新 router 以使用新的 service
3. 保持 API 路径不变

### Phase 4: 依赖更新
1. 更新 MCP 服务的依赖注入
2. 更新 MCP server 中的 context 初始化逻辑
3. 更新 MCP tools 中的 service 调用

### Phase 5: Auth 层迁移
1. 创建 `UserRepositorySupabase` 实现
2. 更新 `UserService` 以使用新的 Repository
3. 更新依赖注入

## Open Questions

- [ ] 是否需要添加数据库迁移脚本？
- [ ] 是否需要保留旧的 JSON 文件作为备份？
- [ ] API 文档是否需要更新？
