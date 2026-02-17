"""
L2: Collaboration 协同层

产品核心壁垒。所有数据写入最终经过此层。

主要组件：
- CollaborationService: 统一入口（checkout / commit / history / rollback）
- ConflictService: 三方合并引擎（JSON key-merge / MD line-merge / LWW）
- VersionService: 版本快照管理
- LockService: 乐观锁
- AuditService: 审计日志

依赖关系：
- 依赖 L1（content_node, s3）
- 被 L2.5（sync）、L3（API/SDK）、编排器（agent）调用
- 不依赖 L2.5、L3、L4
"""
