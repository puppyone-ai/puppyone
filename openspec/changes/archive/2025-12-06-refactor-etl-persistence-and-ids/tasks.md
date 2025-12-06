## 1. 数据模型和Repository层

- [x] 1.1 更新 `src/etl/tasks/models.py`:
  - [x] 将 `ETLTask.task_id` 从 str 改为 int (Optional,创建时为None)
  - [x] 将 `ETLTask.user_id` 从 str 改为 int
  - [x] 将 `ETLTask.project_id` 从 str 改为 int
  - [x] 将 `ETLTask.rule_id` 从 str 改为 int
  - [x] 添加 `to_dict()` 和 `from_dict()` 方法供数据库映射使用

- [x] 1.2 创建 `src/etl/tasks/repository.py`:
  - [x] 定义 `ETLTaskRepositoryBase` 抽象基类
  - [x] 实现 `ETLTaskRepositorySupabase` 类
  - [x] 实现 `create_task()` 方法(返回带id的task)
  - [x] 实现 `get_task(task_id: int)` 方法
  - [x] 实现 `update_task()` 方法
  - [x] 实现 `list_tasks()` 方法(支持过滤)
  - [x] 实现 `delete_task()` 方法(可选)

- [x] 1.3 更新 `src/etl/rules/repository_supabase.py`:
  - [x] 将 `rule_id` 类型从 str 改为 int (注: 已在之前实现中处理)
  - [x] 更新所有相关方法签名

## 2. 队列和服务层集成

- [x] 2.1 更新 `src/etl/tasks/queue.py`:
  - [x] 添加 `task_repository: ETLTaskRepositoryBase` 参数到构造函数
  - [x] 修改 `submit()` 方法:先调用 `repository.create_task()` 获取id,再加入队列
  - [x] 修改 `_worker()` 方法:任务完成/失败时调用 `repository.update_task()`
  - [x] 保持内存中的 `self.tasks` 字典用于快速查询

- [x] 2.2 更新 `src/etl/service.py`:
  - [x] 更新构造函数签名,接收 `task_repository`
  - [x] 更新 `submit_etl_task()` 方法签名:user_id/project_id/rule_id改为int
  - [x] 更新 `_execute_etl_task()` 方法:使用int类型的ID
  - [x] 移除UUID生成逻辑,依赖数据库生成task_id

## 3. API和Schema层

- [x] 3.1 更新 `src/etl/schemas.py`:
  - [x] `ETLSubmitRequest`: user_id/project_id/rule_id改为int
  - [x] `ETLSubmitResponse`: task_id改为int
  - [x] `ETLTaskResponse`: task_id/user_id/project_id/rule_id改为int
  - [x] 新增 `ETLMountRequest`: table_id(int), json_path(str)
  - [x] 新增 `ETLMountResponse`: success(bool), message(str), mounted_path(str)

- [x] 3.2 更新 `src/etl/router.py`:
  - [x] 更新 `submit_etl_task()` 参数类型
  - [x] 更新 `get_etl_task_status()` 参数: task_id改为int
  - [x] 更新 `list_etl_tasks()` 查询参数: user_id/project_id改为int
  - [x] 新增 `mount_etl_result()` 接口:
    - [x] 路由: `POST /api/v1/etl/tasks/{task_id}/mount`
    - [x] 验证task存在且status为completed
    - [x] 从S3下载结果JSON
    - [x] 调用 `TableService.create_context_data()` 挂载
    - [x] key为filename(不含.json),value为完整JSON
  - [x] 更新 `get_etl_rule()` / `delete_etl_rule()`: rule_id改为int

- [x] 3.3 更新 `src/etl/dependencies.py`:
  - [x] 新增 `get_etl_task_repository()` 依赖函数
  - [x] 更新 `get_etl_service()` 注入 task_repository
  - [x] 更新 `get_rule_repository()` 适配int类型rule_id (注: 已在repository实现中处理)

## 4. 测试和验证

- [x] 4.1 单元测试
  - [x] 测试 `ETLTaskRepositorySupabase` CRUD操作
  - [x] 测试 `ETLQueue` 持久化集成
  - [x] 测试ID类型转换

- [x] 4.2 集成测试
  - [x] 测试完整ETL流程(提交、处理、查询)
  - [x] 测试JSON挂载接口
  - [x] 测试错误处理(任务失败时的持久化)

- [ ] 4.3 回归测试
  - [ ] 验证现有ETL功能正常工作
  - [ ] 验证MineRU集成正常
  - [ ] 验证LLM转换正常

## 5. 文档和部署

- [ ] 5.1 更新API文档
  - [ ] 标注Breaking Changes
  - [ ] 更新请求/响应示例
  - [ ] 添加JSON挂载接口文档

- [ ] 5.2 编写迁移指南
  - [ ] 说明ID类型变更
  - [ ] 提供客户端更新示例

- [ ] 5.3 部署验证
  - [ ] 确认etl_task表已创建
  - [ ] 验证服务正常启动
  - [ ] 执行冒烟测试

