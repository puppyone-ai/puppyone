# Design: MCP 存储迁移到 Supabase

## Context

MCP (Model Context Protocol) 模块负责管理 MCP 服务器实例的生命周期，包括创建、启动、状态管理、更新和删除。每个 MCP 实例关联到特定的 user、project、table，并维护服务器进程信息（端口、PID、工具定义等）。

当前实现使用本地 JSON 文件存储实例数据，在单机环境下运行良好，但在以下场景存在局限：
- 多实例部署（水平扩展）
- 高并发场景
- 需要持久化和备份
- 与其他模块（user、project、table）的数据关联查询

项目已有成熟的 Supabase 基础设施，user、project、table 等模块均已迁移。

## Goals / Non-Goals

### Goals
- 将 MCP 实例数据从 JSON 文件迁移到 Supabase 数据库
- 统一项目的数据存储架构
- 支持通过配置切换存储后端（JSON / Supabase）
- 保持所有现有 API 接口和业务逻辑不变
- 处理字段类型和命名的差异

### Non-Goals
- 不改变 MCP 服务器进程管理逻辑
- 不修改 MCP API 端点的请求/响应格式
- 不强制迁移现有 JSON 数据（提供可选脚本）
- 不移除 JSON 存储实现（保留向后兼容）

## Decisions

### 1. Repository 模式
**决策**：新增 `McpInstanceRepositorySupabase` 类，实现相同的 `McpInstanceRepositoryBase` 接口。

**理由**：
- 符合项目已有的 Repository 模式（参考 `UserRepositorySupabase`、`TableRepositorySupabase`）
- 通过接口隔离，Service 层无需修改
- 支持运行时切换存储后端

**替代方案**：
- 直接修改现有 `McpInstanceRepositoryJSON` 实现 → 放弃，破坏向后兼容
- 使用适配器模式包装 → 过度设计，Repository 模式已足够

### 2. 字段映射策略
**决策**：在 Repository 层处理字段映射和类型转换。

数据库表结构 (`sql/mcp.sql`) 与 `McpInstance` 模型的差异：

| McpInstance 模型    | Supabase 表字段 | 类型映射       | 处理方式               |
|---------------------|----------------|----------------|------------------------|
| mcp_instance_id (str) | id (bigint)    | str ↔ int      | Repository 层转换      |
| json_pointer (str)  | json_path (text) | 字段重命名      | 映射时重命名字段       |
| status (int)        | status (boolean) | int ↔ bool     | 0/1 转换为 True/False  |
| docker_info (dict)  | docker_info (jsonb) | 直接映射       | Supabase 自动处理      |
| tools_definition (dict) | tools_definition (jsonb) | 直接映射 | Supabase 自动处理      |

**理由**：
- 数据库表已存在，不能修改结构
- Service 层和业务逻辑不应感知存储细节
- Repository 是数据映射的天然边界

### 3. ID 生成策略
**决策**：
- Supabase：使用数据库自动生成的 `id` (bigint)，在返回时转换为 `str` 给 `mcp_instance_id`
- JSON：保持现有的自增字符串 ID 逻辑

**理由**：
- 利用数据库的原子性和并发安全
- 简化实现，无需维护自定义 ID 生成器
- 两种后端的 ID 格式保持一致（都是数字字符串）

### 4. 依赖注入配置
**决策**：通过 `STORAGE_TYPE` 环境变量控制存储后端选择。

```python
# src/mcp/dependencies.py
def get_mcp_instance_service() -> McpService:
    if settings.STORAGE_TYPE == "json":
        return McpService(McpInstanceRepositoryJSON())
    elif settings.STORAGE_TYPE == "supabase":
        return McpService(McpInstanceRepositorySupabase())
    else:
        raise ValueError(f"Unsupported storage type: {settings.STORAGE_TYPE}")
```

**理由**：
- 符合项目现有模式
- 支持开发/测试环境使用 JSON，生产环境使用 Supabase
- 便于灰度发布和回滚

**替代方案**：
- 使用 Feature Flag 系统 → 过度设计，当前场景简单配置即可

### 5. 错误处理策略
**决策**：在 Repository 层捕获 Supabase 异常，转换为项目统一的异常类型。

```python
try:
    response = self._client.table("mcp").insert(data).execute()
except Exception as e:
    raise handle_supabase_error(e, "创建 MCP 实例")
```

**理由**：
- 保持与现有 Supabase Repository 实现一致
- 上层代码不需要处理特定于 Supabase 的异常

### 6. 外键约束处理
**决策**：依赖数据库外键约束（`user_id`, `project_id`, `table_id`），在 Python 层不做额外验证。

**理由**：
- 数据库层已有约束保证数据完整性
- 减少重复逻辑
- 如果引用不存在，Supabase 会返回明确错误

**风险**：外键约束错误不如业务层验证友好 → 可在后续优化中添加预检查

## Architecture

### 组件关系

```
┌─────────────────────────────────────────────────────────────┐
│ src/mcp/router.py (API 层)                                  │
│   - POST /mcp/                                              │
│   - GET /mcp/{api_key}                                      │
│   - PUT /mcp/{api_key}                                      │
│   - DELETE /mcp/{api_key}                                   │
└────────────────────┬────────────────────────────────────────┘
                     │ Depends(get_mcp_instance_service)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ src/mcp/service.py (业务逻辑层)                             │
│   - McpService                                              │
│   - create_mcp_instance()                                   │
│   - update_mcp_instance()                                   │
│   - delete_mcp_instance()                                   │
│   - get_mcp_instance_status()                               │
└────────────────────┬────────────────────────────────────────┘
                     │ 依赖 McpInstanceRepositoryBase
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ src/mcp/dependencies.py (依赖注入)                          │
│   - get_mcp_instance_service()                              │
│   - 根据 STORAGE_TYPE 选择 Repository 实现                  │
└─────────┬──────────────────────────────────────┬────────────┘
          │                                      │
          ▼                                      ▼
┌──────────────────────────┐    ┌─────────────────────────────┐
│ McpInstanceRepositoryJSON│    │ McpInstanceRepositorySupabase│
│ (现有实现)                │    │ (新增实现)                   │
│ - 读写 JSON 文件          │    │ - 操作 Supabase mcp 表       │
└──────────────────────────┘    └─────────────┬───────────────┘
                                              │
                                              ▼
                                ┌─────────────────────────────┐
                                │ src/supabase/client.py       │
                                │ - SupabaseClient (单例)      │
                                └──────────────────────────────┘
```

### 数据流

**创建 MCP 实例 (Supabase 模式)**：

1. API 请求 → `router.py::generate_mcp_instance()`
2. → `service.py::create_mcp_instance()`
3. → `repository.py::McpInstanceRepositorySupabase.create()`
4. → 字段映射：`json_pointer` → `json_path`, `status` (int) → (bool)
5. → `supabase_client.table("mcp").insert(data).execute()`
6. ← 返回数据库自动生成的 `id`
7. ← 字段映射：`id` → `mcp_instance_id`, `json_path` → `json_pointer`
8. ← 构造 `McpInstance` 对象返回

## Risks / Trade-offs

### Risk 1: 字段类型不匹配导致运行时错误
**影响**: 高  
**概率**: 中  
**缓解措施**:
- 在 Repository 层添加显式类型转换和验证
- 编写全面的单元测试覆盖所有字段映射场景
- 集成测试验证完整数据流

### Risk 2: 数据库外键约束导致操作失败
**影响**: 中  
**概率**: 低  
**缓解措施**:
- 捕获并友好化 Supabase 错误信息
- 在文档中明确说明外键依赖关系
- 后续可在 Service 层添加预检查逻辑

### Risk 3: JSON 到 Supabase 迁移时数据丢失
**影响**: 高  
**概率**: 低  
**缓解措施**:
- 提供可选的数据迁移脚本而非强制迁移
- 迁移脚本包含数据验证和回滚机制
- 迁移前备份 JSON 文件

### Risk 4: 并发更新导致数据不一致
**影响**: 中  
**概率**: 低（Supabase 已有事务支持）  
**缓解措施**:
- 依赖 Supabase 的事务和行锁机制
- 如需要可添加乐观锁（version 字段）

### Trade-off: 保留 JSON 实现增加维护成本
**决策**: 保留 JSON 实现以支持向后兼容  
**权衡**:
- 优点：降低迁移风险，支持灰度发布
- 缺点：需要维护两套 Repository 实现
- 计划：在 Supabase 稳定运行一段时间后标记 JSON 实现为 deprecated

## Migration Plan

### Phase 1: 开发和测试（当前提案）
1. 实现 `McpInstanceRepositorySupabase`
2. 更新依赖注入逻辑
3. 编写单元测试和集成测试
4. 在开发环境验证功能

### Phase 2: 数据迁移准备
1. 创建数据迁移脚本
2. 在测试环境验证迁移流程
3. 准备回滚方案文档

### Phase 3: 生产部署
1. 确保 Supabase `mcp` 表已创建
2. 配置 `STORAGE_TYPE=supabase`
3. 监控错误日志和性能指标
4. 如有问题，切换回 `STORAGE_TYPE=json`

### Phase 4: 清理（未来）
1. 在 Supabase 运行稳定 3 个月后
2. 标记 `McpInstanceRepositoryJSON` 为 deprecated
3. 计划在下一个大版本移除 JSON 支持

### 回滚方案
1. 设置 `STORAGE_TYPE=json`
2. 重启应用
3. 如已执行数据迁移，从备份恢复 JSON 文件

## Open Questions

1. **是否需要数据迁移工具？**
   - 决策：提供可选脚本，不强制执行
   - 理由：新部署可直接使用 Supabase；现有部署可选择迁移或重新创建实例

2. **是否需要同时写入两种存储以实现双写？**
   - 决策：不实现双写
   - 理由：增加复杂度，配置切换已足够灵活

3. **user_id、project_id、table_id 的类型是否需要统一？**
   - 现状：数据库中是 `bigint`，代码中传递 `str`
   - 决策：Repository 层统一转换，保持 API 层使用 `str`
   - 理由：API 层使用字符串更灵活，避免 JSON 大数精度问题
