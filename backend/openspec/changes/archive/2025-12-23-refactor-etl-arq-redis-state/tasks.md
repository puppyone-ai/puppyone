## 1. Spec / Design
- [x] 1.1 在 `etl-core` delta spec 中明确：Redis 运行态、Supabase 终态/历史、读取优先级与持久化策略
- [x] 1.2 在 `etl-core` delta spec 中明确：ARQ 链式 job（OCR → PostProcess）的职责边界与状态机
- [x] 1.3 在 `etl-core` delta spec 中新增：取消/从阶段重试控制面端点与权限规则
- [x] 1.4 在 `etl-core` delta spec 中新增：`OCRProvider`/`PostProcessor` 的输入输出接口要求（实现可替换）
- [x] 1.5 在 `etl-core` delta spec 中修改：ETL 规则支持“跳过大模型阶段”，并定义后处理策略选择（大 markdown 分块等）
- [x] 1.6 `openspec validate refactor-etl-arq-redis-state --strict` 通过

## 2. Implementation (after approval)
- [x] 2.1 增加 Redis 配置（连接、前缀、TTL、开关）并提供依赖注入
- [x] 2.2 增加 ETL Redis 状态仓库（get/set/merge、TTL、幂等更新）
- [x] 2.3 增加 ARQ worker 与 job 定义：`etl_ocr_job`、`etl_postprocess_job`（链式 enqueue）
- [x] 2.4 重构 `ETLService`：submit 仅入队；执行逻辑迁移到 job；对外查询从 Redis/Supabase 聚合
- [x] 2.5 增加 `POST /etl/tasks/{task_id}/cancel`（仅 queued/pending 可取消）
- [x] 2.6 增加 `POST /etl/tasks/{task_id}/retry`（支持 from_stage；OCR 完成时仅重试后处理）
- [x] 2.7 任务失败语义调整：保留阶段信息与可重试指针；必要时把可重试最小指针写入 Supabase metadata
- [x] 2.8 重构 ETL rule 模型：支持跳过 LLM，支持指定/自动选择后处理策略（如分块总结/分块提取）
- [x] 2.9 增加全局默认 ETL 规则：无需用户配置即可提交任务；默认 skip-llm 并产出 markdown→JSON 包装结果
- [x] 2.9 增加单元/集成测试：状态机、cancel/retry、Redis 缓存命中/回退逻辑、权限校验、skip-llm 与 chunked 策略

## 3. Validation
- [x] 3.1 本地启动 API + ARQ worker，跑一条完整链路（upload → submit → status → completed）
- [x] 3.2 验证 LLM 失败场景：状态可见、可重试且不重复跑 MineRU
- [x] 3.3 验证 cancel 场景：queued 可取消、running 不可取消（返回冲突或明确错误）

