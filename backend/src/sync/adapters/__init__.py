"""
L2.5 Sync Adapters

每种外部系统一个 Adapter，实现 pull + push 接口。

注意：
  本地文件夹同步已迁移到 folder_sync 引擎 + handlers/folder_source.py，
  不再使用 SyncAdapter 模式。

  SaaS 导入使用 handlers/ 下的 BaseHandler 模式。
"""
