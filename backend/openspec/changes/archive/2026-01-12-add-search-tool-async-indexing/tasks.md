## 1. Implementation
- [x] 1.1 定义对外异步创建 Search Tool 接口（快速返回 + 异步触发 indexing）
- [x] 1.2 定义索引任务状态表（例如 `search_index_task`）与对应的状态读写接口
- [x] 1.3 定义对外轮询接口（返回索引任务状态及统计字段）
- [x] 1.4 为 indexing 链路补齐日志（避免吞异常无日志）
- [x] 1.5 为异步 indexing 增加超时/错误落库策略（status=error + last_error）
- [ ] 1.6 增加最小集成测试（创建 async search tool → 轮询到 indexing/ready/error 的状态变化）

