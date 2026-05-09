# MUT Engine — 实现参考

> 本文档面向日常维护 `mut_engine` 的开发者，描述代码结构、路由表和请求数据流。
>
> 设计决策和架构哲学见 [`docs/architecture/01-mut-engine.md`](../../../docs/architecture/01-mut-engine.md)

---

## 1. 目录结构

```
mut_engine/
├── ARCHITECTURE.md        ← 本文档
├── schemas.py             # Pydantic 请求/响应模型
├── dependencies.py        # FastAPI DI 工厂
│
├── routers/               # HTTP 路由层（纯 HTTP 外壳，不含业务逻辑）
│   ├── content_router.py  #   Content API — REST 文件操作（前端 / 内部服务）
│   ├── protocol_router.py #   MUT 线协议（CLI daemon / 远程 MUT client）
│   ├── access_point.py    #   Access Point URL+Key 入口
│   └── audit_router.py    #   审计日志查询
│
├── services/              # 业务服务层（编排、转译、hook）
│   ├── ops.py             #   MutOps — 所有 channel 的统一操作入口
│   ├── ephemeral_client.py#   MutEphemeralClient — 进程内 clone→push
│   ├── tree_reader.py     #   MutTreeReader — 轻量 Merkle tree 直读
│   └── hooks.py           #   Post-commit hook（access_points 表一致性）
│
└── server/                # 服务端基础设施层（存储适配、认证、管理）
    ├── server_repo.py     #   PuppyOneServerRepo（mut 核心的 ServerRepo 实现）
    ├── repo_manager.py    #   MutRepoManager — per-project repo 工厂
    ├── admin.py           #   MutAdminService — init / 历史 / diff
    ├── auth.py            #   PuppyOneAuthenticator（JWT / Access Key → auth dict）
    ├── audit_repository.py#   审计日志 PG 查询
    └── backends/          #   存储后端适配器
        ├── s3_storage.py  #     S3StorageBackend（Merkle blobs）
        ├── supabase_history.py # SupabaseHistoryManager（版本历史 + root hash）
        ├── supabase_audit.py   # SupabaseAuditManager（审计日志写入）
        └── supabase_scope.py   # SupabaseScopeBackend（scope 权限）
```

---

## 2. 分层架构

```
  前端 Web UI              CLI daemon /             任意 MUT 客户端         前端审计面板
  (浏览文件、编辑)          远程 MUT 客户端           (只需 URL+Key)
       │                       │                        │                    │
       │ REST 语义              │ MUT 原生协议            │ MUT 原生协议        │
       │ (ls/cat/write/mv)      │ (clone/push/pull)      │ (clone/push/pull)  │
       ▼                       ▼                        ▼                    ▼
  ┌──────────────┐       ┌──────────────┐         ┌─────────────┐     ┌──────────┐
  │content_router│       │protocol_router│        │access_point │     │audit_router│   routers/
  │ Content API  │       │ MUT 线协议    │        │ URL+Key     │     │ 审计查询  │
  └──────┬───────┘       └──────┬────────┘        └──────┬──────┘     └─────┬─────┘
         │                      │                        │                  │
         ▼                      │                        │                  │
  ┌──────────┐                  │                        │                  │
  │ MutOps   │                  │                        │                  │   services/
  │(REST→MUT │                  │  (客户端自己实现协议，    │                  │
  │ 转译编排) │                  │   服务端只做协议处理)    │                  │
  └──────┬───┘                  │                        │                  │
         │                      │                        │                  │
         ▼                      ▼                        ▼                  ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  MutRepoManager → PuppyOneServerRepo → Backends                        │   server/
  │  (S3 存储 Merkle blobs ｜ Supabase/PG 存储版本历史、审计、权限)           │
  └──────────────────────────────────────────────────────────────────────────┘
```

### 各层职责

| 层 | 目录 | 职责 | 不做什么 |
|---|---|---|---|
| **Routers** | `routers/` | HTTP 解析、认证注入、`asyncio.to_thread` 调度、错误码映射、日志 | 不含业务逻辑 |
| **Services** | `services/` | 操作编排（clone→push）、读写转译、post-commit 一致性 hook | 不直接操作存储 |
| **Server** | `server/` | 存储适配（S3/PG）、MUT 协议认证、版本管理、repo 生命周期 | 不处理 HTTP |

---

## 3. 路由表

### Content Router — `/api/v1/content/{project_id}`

认证：JWT（`get_current_user`）+ 项目成员校验

```
GET  /ls             → MutOps.list_dir()
GET  /cat            → MutOps.read_file()
GET  /stat           → MutOps.stat()
GET  /tree           → MutOps.list_tree()
POST /write          → MutOps.write_file()
POST /mkdir          → MutOps.mkdir()
POST /mv             → MutOps.move()
POST /rm             → MutOps.delete() / MutOps.permanent_delete()
POST /bulk-write     → MutOps.bulk_write()
GET  /versions       → MutAdminService.get_version_history()
GET  /version-content→ MutAdminService.get_version_content()
GET  /diff           → MutAdminService.compute_diff()
POST /rollback       → mut.server.handlers.handle_rollback()
```

### Protocol Router — `/api/v1/mut/{project_id}`

认证：`PuppyOneAuthenticator`（JWT 或 Access Key）

```
POST /clone          → handle_clone(repo, auth, body)
POST /push           → handle_push(repo, auth, body)  + post-push hook
POST /pull           → handle_pull(repo, auth, body)
POST /negotiate      → handle_negotiate(repo, auth, body)
POST /rollback       → handle_rollback(repo, auth, body)
POST /pull-version   → handle_pull_version(repo, auth, body)
```

### Access Point Router — `/api/v1/mut/ap/{access_key}`

认证：access_key 路径参数 → 解析 access_points 表获取 project_id + scope

```
POST /clone | /push | /pull | /negotiate | /rollback | /pull-version
```

### Audit Router — `/api/v1/nodes/{path}/audit-logs`

认证：JWT

---

## 4. 请求数据流

### 4.1 前端文件写入

```
浏览器
  │  POST /api/v1/content/{project_id}/write
  │  Body: { path, content, message }
  │  Header: Authorization: Bearer <JWT>
  ▼
content_router.py
  │  1. get_current_user() → JWT 校验
  │  2. _ensure_project_access() → 项目成员校验
  │  3. who = "user:{uid}"
  ▼
MutOps.write_file(project_id, path, content, who)
  │
  ▼
MutEphemeralClient (进程内模拟 MUT 协议)
  │  1. clone() → handle_clone(repo, auth, {})
  │     → 从 S3 读取 Merkle tree + scope 内文件
  │  2. push(modified={path: content})
  │     → 构建新 tree snapshot
  │     → handle_negotiate() 确定需要上传的 blob
  │     → handle_push() 提交到 server
  ▼
PuppyOneServerRepo
  │  1. ObjectStore → S3 写入新 blob
  │  2. Merkle tree 更新 → S3 写入新 tree node
  │  3. HistoryManager → PG 记录 mut_commits (commit_id = 16-hex hash)
  │  4. AuditManager → PG 记录 audit_logs (commit_id 放在 metadata JSONB)
  │  5. CAS 原子更新 mut_scope_state.(scope_hash, head_commit_id) +
  │     graft 更新 projects.mut_root_hash
  ▼
返回 WriteResult(commit_id, merged, conflicts)
```

### 4.2 CLI 客户端推送

```
CLI daemon (本地文件变更)
  │  POST /api/v1/mut/{project_id}/push
  │  Body: { base_commit_id, objects, tree, ... }
  │  Header: Authorization: Bearer <access_key>
  ▼
protocol_router.py
  │  1. get_mut_auth() → PuppyOneAuthenticator
  │     → Access Key 查 access_points 表
  │     → scope = connections.config.scope
  │  2. _invoke(handle_push, repo_manager, project_id, auth, body)
  │     → 在 worker thread 中执行
  ▼
mut.server.handlers.handle_push(repo, auth, body)
  │  (mut 核心协议处理：scope 校验、三方合并、版本提交)
  ▼
PuppyOneServerRepo → S3 + PG
  ▼
protocol_router.py
  │  run_post_push_hook(project_id, repo_manager, result)
  │  → 检查是否有文件删除，更新 access_points 表一致性
  ▼
返回 push result JSON
```

### 4.3 Access Point 推送

```
任意 MUT 客户端
  │  POST /api/v1/mut/ap/{access_key}/push
  │  Body: { base_commit_id, objects, tree, ... }
  ▼
access_point.py
  │  1. resolve_access_point(access_key)
  │     → 查 access_points 表 → (project_id, auth_context)
  │  2. X-Mut-User identity binding 校验
  │  3. _invoke(handle_push, repo_manager, project_id, auth, body)
  ▼
(后续流程同 Protocol Router)
```

### 4.4 内部服务调用

```
AgentService / SyncEngine / IngestJob
  │  直接在代码中调用:
  │  ops = create_mut_ops()
  │  await ops.write_file(project_id, path, content, who="agent:{id}")
  ▼
MutOps → MutEphemeralClient → PuppyOneServerRepo → S3 + PG
```

---

## 5. DI 注入

```python
# FastAPI 路由中（请求上下文）
def get_mut_ops(repo_manager = Depends(get_repo_manager)) -> MutOps:
    return MutOps(repo_manager)

def get_mut_admin_service(repo_manager = Depends(get_repo_manager)) -> MutAdminService:
    return MutAdminService(repo_manager)

# Job / Worker 中（非请求上下文）
ops = create_mut_ops()
admin = create_mut_admin_service()
```

---

## 6. Post-commit Hooks

位于 `services/hooks.py`，由 protocol_router 和 access_point 的 push 成功后触发：

| Hook | 触发条件 | 动作 |
|------|---------|------|
| `_update_global_root` | 每次 push / rollback 成功 | 从 DB scope state 重建 `projects.mut_root_hash`（CAS + retry） |
| `post_commit_delete` | push 中包含文件删除 | 清理 `access_points` 表中引用已删除路径的记录 |
| `post_commit_move` | 文件/目录移动/重命名 | 重写 `access_points` 表中受影响的路径 |

### 6.1 `_update_global_root` —— DB-Authoritative Graft

> **架构**：`mut_scope_state` 是"每个 scope 当前指向哪个 hash"的唯一 SoT；
> `projects.mut_root_hash` 是从这些 scope 派生出来的 materialized view。
> 嫁接 = 从 SoT 重建 view。

每次 push/rollback 成功后，hook 调 `_build_root_from_scope_state(repo,
just_pushed_scope, just_pushed_hash)`，按下列步骤重建 root tree：

1. `SELECT scope_path, scope_hash FROM mut_scope_state WHERE project_id=P`
   —— 拿到所有 scope 的最新 hash 快照。
2. 用刚 push 的新 hash 显式覆盖 just_pushed_scope 的 entry（让重试逻辑幂等）。
3. base = root scope 的 tree（承载根目录非-scope 文件，如 README.md），
   或空 tree object（若 root scope 从未 push 过）。
4. 按 `scope_path` 深度从浅到深排序，依次 `graft_subtree(base, scope_path,
   scope_hash)`，父 scope 先落地，子 scope 才能 splice 到刚生成的父树上。
5. `cas_update_root_hash(old_root, new_root)`，失败则重试（最多 5 次）。

为什么这么设计 —— **不读派生数据作为派生输入**：旧版本嫁接读
`projects.mut_root_hash` 指向的 root tree 作为 splice base，使得 S3 上一份
派生产物同时充当了下一版的输入。任何静默的 S3 部分读失败（旧
`_safe_flatten` 的 bug 类）都会构造出"结构合法但数据丢失"的新 root，CAS
还是会接受它（P0-5）。

新版完全切断了这条数据流：嫁接的输入只有 DB 行 + 各 scope 自己 push 时
写入 S3 的 immutable tree object。任何读失败立即抛异常 → retry → 仍失败
则 ERROR 日志 + 不污染 DB。

详见 `docs/design/mut-scope-concurrency.md` §3.2、§5.4。

---

## 7. 模块职责速查

| 模块 | 职责 | 不做什么 |
|---|---|---|
| `MutOps` | 所有 channel 的读写统一入口，REST→MUT 转译 | 不管认证、不管 HTTP |
| `MutEphemeralClient` | 进程内 clone→push 协议模拟 | 不对外暴露，仅被 MutOps 使用 |
| `MutTreeReader` | 轻量读取 Merkle tree（S3 直读） | 不做写入 |
| `MutAdminService` | init_tree / 版本历史 / diff | 不做常规写入 |
| `PuppyOneServerRepo` | `mut` 核心 ServerRepo 的云适配 | 不含业务逻辑 |
| `MutRepoManager` | per-project repo 工厂 + 缓存 | 不含业务逻辑 |
| `PuppyOneAuthenticator` | JWT/AccessKey → MUT auth dict | 只做认证 |
| `content_router` | Content API — MutOps 的 REST HTTP 外壳 | 不含业务逻辑 |
| `protocol_router` | MUT 线协议的 HTTP 外壳（直调 handlers） | 不含业务逻辑，不经过 MutOps |
| `access_point` | URL+Key 的 MUT 协议入口 | 不含业务逻辑 |
| `hooks.py` | push 后的 access_points 表一致性维护 | 不做核心写入 |

---

## 8. 扩展指南

### 新增一种 Channel

```python
from src.mut_engine.dependencies import create_mut_ops

ops = create_mut_ops()
await ops.write_file(
    project_id=project_id,
    path="data/result.json",
    content=json.dumps(data).encode(),
    who=f"my_channel:{channel_id}",
    scope="data/",
)
```

### 新增一种存储后端

实现 `mut` 核心库定义的 Backend 抽象接口（`StorageBackend` / `HistoryBackend` 等），
在 `server/repo_manager.py` 中替换对应的 Backend 实现。

### 新增 HTTP 入口

在 `routers/` 下创建新的 FastAPI Router，注入 `MutRepoManager`（协议级）或 `MutOps`（编排级）。
