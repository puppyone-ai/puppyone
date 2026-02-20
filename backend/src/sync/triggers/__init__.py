"""
L2.5 Sync — Triggers

变更检测触发器。

注意：
  本地文件系统监听已迁移到 folder_sync/watcher.py (FolderWatcher)，
  由 handlers/folder_source.py 和 access/folder_access.py 管理生命周期。

未来扩展：
  - PollingTrigger: 定时轮询 (SaaS adapters)
  - WebhookTrigger: 接收 webhook 回调 (GitHub/Notion)
"""
