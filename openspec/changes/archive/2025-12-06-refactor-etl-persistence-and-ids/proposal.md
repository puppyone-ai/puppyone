# Change: ETL模块持久化和ID类型统一

## Why

当前ETL模块存在以下问题:

1. **ID类型不一致**: ETL模块的 `user_id`、`project_id`、`rule_id`、`task_id` 都使用 `str` 类型,而项目其他模块(user、project、table、mcp)都统一使用 `int` 类型的ID,造成架构不一致
2. **内存存储风险**: ETL任务状态当前仅存储在内存中(`ETLQueue.tasks` 字典),服务重启会丢失所有任务历史和状态
3. **缺乏持久化查询**: 用户无法查询历史任务,无法追溯已完成的任务结果
4. **结果集成缺失**: ETL处理完成后的JSON结果存储在S3中,但缺乏将结果挂载到Table数据结构的能力,需要手动处理

改进后将实现:
- 统一的ID类型规范(int),提升代码一致性
- 任务状态持久化到Supabase,提供可靠的任务历史记录
- 支持JSON结果自动挂载到Table的data字段,简化工作流

## What Changes

### 1. ID类型统一 (**BREAKING**)
- `user_id`: str → int (对应 user_temp.id)
- `project_id`: str → int (对应 project.id)
- `rule_id`: str → bigint (对应 etl_rule.id)
- `task_id`: str → bigint (对应 etl_task.id, 数据库自动生成)

### 2. 任务持久化到Supabase
- 创建 `ETLTaskRepositorySupabase` 类,实现任务CRUD操作
- 任务创建时同时保存到内存和Supabase
- 中间状态更新仅更新内存,除非任务出错或完成
- 完成/失败时更新数据库记录
- 服务启动时从数据库恢复未完成任务(可选)

### 3. 新增JSON挂载接口
- 新增 `POST /api/v1/etl/tasks/{task_id}/mount` 接口
- 参数: `table_id` (int), `json_path` (str)
- 验证任务状态为 "completed"
- 从S3下载结果JSON文件
- 调用 `TableService.create_context_data()` 挂载到指定路径
- key为原文件名(不含扩展名),value为完整JSON内容

### 4. 数据库表结构调整
- 利用现有 `sql/etl_task.sql` 表结构
- 字段映射:
  - `id` (bigint) ← task_id
  - `user_id` (bigint) ← user_id
  - `project_id` (bigint) ← project_id
  - `rule_id` (bigint) ← rule_id
  - `filename` (text) ← filename
  - `status` (text) ← status
  - `progress` (bigint) ← progress
  - `result` (jsonb) ← result
  - `error` (text) ← error
  - `metadata` (jsonb) ← metadata
  - `created_at` / `updated_at` ← 时间戳

## Impact

### 影响的 specs
- **修改能力**: `etl-core` (修改现有spec)

### 影响的代码
- `src/etl/tasks/models.py`: 更新 `ETLTask` 模型的ID字段类型
- `src/etl/tasks/repository.py`: 新增 `ETLTaskRepository` 接口和 `ETLTaskRepositorySupabase` 实现
- `src/etl/tasks/queue.py`: 集成任务持久化逻辑
- `src/etl/service.py`: 更新ID类型,集成持久化
- `src/etl/router.py`: 更新ID类型,新增挂载接口
- `src/etl/schemas.py`: 更新ID类型
- `src/etl/rules/repository_supabase.py`: 更新 rule_id 类型
- `src/etl/dependencies.py`: 新增 `get_etl_task_repository` 依赖

### Breaking Changes
- **API请求字段类型变更**: `user_id`、`project_id`、`rule_id` 从字符串改为整数
- **响应字段类型变更**: `task_id`、`user_id`、`project_id`、`rule_id` 返回整数

### Migration Path
1. 数据库表已存在(`sql/etl_task.sql`),无需额外创建
2. 更新API客户端,将ID字段从字符串改为整数
3. 如有现有内存中的任务数据,服务重启后将丢失(可接受,因当前就是内存存储)

