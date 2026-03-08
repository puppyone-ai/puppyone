"""
L3-Folder: Workspace 文件接口层

给 Agent 提供本地文件夹形式的数据访问方式。

负责：
- 为每个 Agent 创建隔离的工作区（APFS Clone / 全量复制 / OverlayFS）
- 检测 Agent 的改动（diff）
- 提供 /api/v1/workspace/* API 端点

不再负责（已迁移）：
- 同步 PG/S3 → 本地 → 迁移到 src/sync/ (L2.5)
- 冲突解决 / 三方合并 → 迁移到 src/collaboration/ (L2)
"""
