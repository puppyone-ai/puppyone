"""
Mut Core — PuppyOne 的版本管理内核

基于 Mut 框架，PuppyOne 在其之上构建平台功能（类似 GitHub 之于 Git）。

模块结构:
  backends/         S3 + Supabase 后端实现
  repo_manager.py   per-project Mut repo 工厂
  write_service.py  MutWriteService（唯一写入入口）
  index_sync.py     Mut tree → content_nodes 同步
"""
