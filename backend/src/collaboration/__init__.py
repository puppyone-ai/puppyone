"""
Collaboration 协同层

所有数据写入通过 MutCompatService（Mut 内核 + 旧接口兼容层）。
版本管理、冲突解决、乐观锁均由 Mut 内核处理。

主要组件：
- MutCompatService: 统一写入入口（commit / checkout / history / rollback）
- AuditRepository: 审计日志读取（audit_logs 表）
- audit_router: 审计日志 API

依赖关系：
- 依赖 mut_core（MutWriteService, MutRepoManager）
- 依赖 L1（content_node, s3）
- 被 sync、API、agent 调用
"""
