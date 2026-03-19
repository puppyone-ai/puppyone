"""
Mut Core — PuppyOne 的版本管理内核

基于 Mut 框架，PuppyOne 在其之上构建平台功能（类似 GitHub 之于 Git）。

模块结构:
  backends/            S3 + Supabase 后端实现
  repo_manager.py      per-project Mut repo 工厂
  ephemeral_client.py  MutEphemeralClient（in-process MUT 协议客户端）
  write_service.py     MutWriteService（底层写入 + post-commit hooks）
  tree_reader.py       MutTreeReader（轻量级读取入口）
  tree_router.py       Tree API（REST 端点，写入通过 EphemeralClient）
  audit_router.py      审计日志 API
"""
