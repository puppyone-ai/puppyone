"""
Mut Engine — PuppyOne 的版本管理内核

三层架构:
  上层 Channels → 中层 MutOps → 底层 MUT Server Handlers

模块结构:
  ops.py              MutOps — 所有 channel 的统一读写入口
  ephemeral_client.py MutEphemeralClient — MutOps 内部的 clone→push 封装
  tree_reader.py      MutTreeReader — MutOps 内部的轻量级读取
  tree_router.py      MutOps 的 REST HTTP 外壳 (Web UI / internal)
  protocol_router.py  MutOps 的 MUT 线协议 HTTP 外壳 (CLI daemon)
  write_service.py    MutWriteService — 仅 admin: init_tree / rollback / 版本历史
  repo_manager.py     per-project Mut repo 工厂
  dependencies.py     FastAPI DI 工厂 (get_mut_ops / create_mut_ops)
  audit_router.py     审计日志 API
  backends/           S3 + Supabase 后端实现
"""
