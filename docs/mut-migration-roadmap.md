# PuppyOne → Mut 内核迁移路线图

> **设计原则：Mut 是 Git，PuppyOne 是 GitHub。**
>
> - **Mut 保持极简** — 纯文件操作，零数据库，零云端概念。就像 Git 不知道 GitHub 的存在。
> - **PuppyOne 负责云化** — 把 Mut 的文件操作桥接到 S3/PostgreSQL/Redis，就像 GitHub 在自己的基础设施上运行 Git。
> - **Mut 唯一的抽象** — `StorageBackend`（ObjectStore 可插拔后端），其余全部文件系统。
> - **PuppyOne 负责的云化组件** — S3StorageBackend、SupabaseHistoryManager、SupabaseAuditManager、IndexSync、MutWriteService。
>
> Mut repo 是 content 和 tree structure 的 source of truth。
> content_nodes 是 read-side index（类似 GitHub 数据库中的 repo metadata）。

## 1. 问题陈述

### 1.1 当前架构：PuppyOne-centric（错误的）

```
Source of truth: content_nodes 表 (PostgreSQL)
  ├── preview_json / preview_md — 内容直接存在 DB 字段里
  ├── id_path — UUID 路径管理树结构
  ├── current_version — per-node 版本号
  └── content_hash — 单节点 hash，无树级完整性

版本管理: file_versions 表 (PostgreSQL)
  └── 每个版本是 content_nodes 的快照

collaboration/ 模块（所谓的 "Mut Protocol"）
  ├── 混入了 ContentNodeService（树操作、DB CRUD）
  ├── 混入了 VersionService（PostgreSQL file_versions 表、S3 存储）
  ├── 混入了 LockService（基于 content_nodes.current_version 的乐观锁）
  ├── 混入了 ConflictService（简化的三方合并）
  ├── 混入了 AuditService → AuditRepository
  ├── 混入了 Changelog 通知
  └── 被 30+ 个调用点直接依赖，6 处手动构建实例
```

**根本问题：PuppyOne 自己实现了一个残缺的版本管理系统，然后把它和业务逻辑深度耦合。**

### 1.2 错误方案：MutBridge 适配器（渐进式，不彻底）

```
content_nodes 表（仍然是 source of truth）
    ↑
MutBridge（翻译层）
    ↑
Mut 库（被矮化为存储/合并工具）
```

这不是 GitHub 对 Git 的关系，这是"给旧系统打补丁"。Mut 的 Merkle tree、scope 权限、
clone/push/pull 协议都被浪费了。

### 1.3 正确方案：Mut-native（本文档）

```
Source of truth: Mut repo (per-project)
  ├── ObjectStore (S3) — content-addressable blobs + Merkle trees
  ├── Root hash — 整个项目的树级完整性
  ├── History — 全局版本链（commit chain）
  └── Scopes — 路径级 agent 权限

Read index: content_nodes 表 (PostgreSQL)
  ├── metadata only: id, name, type, project_id, created_by, mime_type
  ├── derived from Mut tree: id_path, content_hash, current_version
  └── 每次 Mut commit 后同步更新
```

---

## 2. 目标架构

### 2.1 Source of Truth 迁移

```
                          迁移前                              迁移后
                          ------                              ------

  Source of truth:        content_nodes 表          →  Mut repo (per-project)
  内容存储:               preview_json / preview_md  →  ObjectStore (S3, content-addressable)
  树结构:                 id_path (UUID 路径)        →  Merkle tree (可验证)
  版本历史:               file_versions 表           →  Mut history (commit chain)
  审计:                   audit_logs 表              →  Mut audit log
  权限:                   connection_accesses 表     →  Mut scopes (路径级 ACL)
  合并:                   ConflictService (290 行)   →  mut.core.merge (成熟引擎)
  Agent 协议:             REST API only              →  Clone/Push/Pull + REST API

  content_nodes 表:       source of truth            →  read index (从 Mut 同步)
```

### 2.2 数据流

```
写入流（Write Path）:

  Connector/API/Agent
        │
        ▼
  ┌─ PuppyOne Platform ──────────────────────────────┐
  │  1. 业务校验（权限、项目归属等）                   │
  │  2. 内容序列化 → bytes                             │
  └───────────────────┬──────────────────────────────┘
                      │
                      ▼
  ┌─ Mut Core ───────────────────────────────────────┐
  │  3. ObjectStore.put(bytes) → blob_hash            │
  │  4. 读取当前 tree → 修改 entry → 写新 tree        │
  │  5. graft_subtree() → new_root_hash               │
  │  6. 冲突检测 → three_way_merge() → 合并           │
  │  7. history.record(version, changes, root_hash)   │
  │  8. audit.record(event)                           │
  └───────────────────┬──────────────────────────────┘
                      │
                      ▼
  ┌─ PuppyOne Index Sync ────────────────────────────┐
  │  9. 根据 changeset 增量更新 content_nodes 表      │
  │  10. 触发 changelog / WebSocket 通知 UI           │
  └──────────────────────────────────────────────────┘


读取流（Read Path）:

  前端 / API
        │
        ├── 树浏览 → content_nodes 表 (PostgreSQL, 毫秒级)
        ├── 内容读取 → ObjectStore.get(hash) (S3)
        ├── 版本历史 → Mut history
        └── Diff → Mut diff_trees()


Agent 协议（Native Mut）:

  Agent CLI
        │
        ├── mut clone → 拿到 scope 内的文件 + 对象 + 历史
        ├── mut commit → 本地快照
        ├── mut push → 服务端合并 + graft → 新版本
        └── mut pull → 拉取增量更新
```

### 2.3 关键设计原则

| Mut 负责（Git 层） | PuppyOne 负责（GitHub 层） |
|-------|----------|
| 内容存储（content-addressable） | 用户/组织/项目管理 |
| Merkle tree 完整性 | 连接器同步（trigger/fetch） |
| 三方合并 + 冲突解决 | content_nodes read index |
| 版本历史（commit chain） | UI + REST API |
| Scope 权限（路径级 ACL） | MCP 协议暴露 |
| Clone/Push/Pull 协议 | 搜索索引、向量搜索 |
| 审计日志 | 多租户隔离 |

### 2.4 content_nodes 角色转变

```
迁移前: content_nodes = 文件系统（source of truth）
  ├── 内容存储 (preview_json, preview_md)     ← 删除，移到 Mut
  ├── 树结构 (id_path)                        ← 从 Mut 树派生
  ├── 版本 (current_version, content_hash)    ← 从 Mut 历史派生
  └── 元数据 (name, type, mime_type, ...)     ← 保留

迁移后: content_nodes = 元数据索引（read index）
  ├── 身份: id (UUID), project_id
  ├── 元数据: name, type, mime_type, size_bytes, created_by, created_at
  ├── Mut 映射: mut_path (人类可读路径), content_hash (从 Mut 同步)
  ├── 缓存: current_version (从 Mut 同步)
  └── 业务: permissions, source_info
```

`preview_json` 和 `preview_md` 列要么删除、要么保留作为 **缓存**（加速 UI 预览，
但 source of truth 是 Mut ObjectStore）。

---

## 3. 迁移涉及的文件清单

### 3.1 需要删除/替换的文件（collaboration 内部）

| 文件 | 当前作用 | 被 Mut 替代的部分 |
|------|---------|------------------|
| `conflict_service.py` | 三方合并（290 行） | → `mut.core.merge` |
| `lock_service.py` | 乐观锁（72 行） | → Mut 版本比对 |
| `version_service.py` | 版本 CRUD + rollback（597 行） | → Mut HistoryManager + ObjectStore |
| `version_repository.py` | file_versions/folder_snapshots 表操作 | → Mut ObjectStore + HistoryManager |
| `audit_service.py` | 审计日志 | → Mut AuditLog |
| `audit_repository.py` | audit_logs 表操作 | → Mut AuditLog |

### 3.2 需要重写的文件

| 文件 | 变更 |
|------|------|
| `service.py` | CollaborationService → MutBridge（内部委托 Mut，外部接口保持） |
| `schemas.py` | 保留 Mutation/CommitResult 等 API 类型，删除 FileVersion/FolderSnapshot DB 模型 |
| `dependencies.py` | 简化 DI：只注入 MutBridge，不再分别注入 6 个子服务 |
| `router.py` | 内部调用从 6 个子服务改为 MutBridge |

### 3.3 需要更新的调用方（30+ 处）

**高频调用方（构造 Mutation + 调用 commit）：**

| 文件 | commit() 调用次数 | 影响 |
|------|------------------|------|
| `content_node/router.py` | 8 | **接口不变**，Mutation 类型保留 |
| `internal/router.py` | 5 | **接口不变** |
| `upload/file/jobs/jobs.py` | 3 | **接口不变** |
| `connectors/datasource/engine.py` | 1 | **接口不变** |
| `connectors/datasource/service.py` | 2 | **接口不变** |
| `connectors/filesystem/folder_access.py` | 1 | **接口不变** |
| `collaboration/router.py` | 1 | **接口不变** |
| `upload/router.py` | 2 | **接口不变** |
| `sandbox/registry.py` | 1 | **接口不变** |
| `connectors/agent/service.py` | 2+ | **接口不变** |
| `scheduler/jobs/sandbox_reaper.py` | 1 | **接口不变** |

**关键发现：所有调用方都通过 `Mutation` + `commit()` 接口调用。只要 MutBridge 保持相同接口，调用方几乎不需要改动。**

**手动构建 CollaborationService 的位置（需要改为构建 MutBridge）：**

| 文件 | 当前做法 |
|------|---------|
| `collaboration/dependencies.py` | `get_collaboration_service()` + `create_collaboration_service()` |
| `connectors/filesystem/service.py` | `_build_collab_service()` — 手动构建完整 CollabService |
| `connectors/agent/service.py` | 手动构建 CollabService（多处） |
| `workspace/router.py` | 手动构建 CollabService |
| `main.py` | 构建 CollabService 给 OpenClaw provider |
| `scheduler/jobs/sandbox_reaper.py` | 手动构建 CollabService |

**需要消除的双写路径：**

| 文件 | 问题 |
|------|------|
| `content_node/service.py` | `_track_version()` — 11 个调用点直接写版本，绕过 CollabService |

---

## 4. 分阶段迁移计划

### Mut 不需要改（设计原则）

**Mut 保持极简，不加云端抽象。** 就像 Git 不知道 GitHub 的存在：

- Git 操作文件 → GitHub 把文件放到自己的基础设施上
- Mut 操作文件 → PuppyOne 把文件操作桥接到 S3/PostgreSQL

Mut 唯一的可插拔抽象是 `ObjectStore.StorageBackend`（内容存储）。
History、Audit、Scope、Lock 在 Mut 里就是文件操作，PuppyOne 自己实现云端版本。

**PuppyOne 使用 Mut 的方式：**

| Mut 提供（文件操作） | PuppyOne 的云端对应 |
|------|------|
| `ObjectStore` + `StorageBackend` | `S3StorageBackend`（唯一扩展 Mut 的接口） |
| `mut.core.tree` (Merkle tree 操作) | `MutWriteService` 直接调用 |
| `mut.core.merge` (三方合并) | `MutWriteService` 直接调用 |
| `mut.core.diff` (树差异比较) | `MutWriteService` 直接调用 |
| `mut.server.graft` (子树嫁接) | `MutWriteService` 直接调用 |
| `HistoryManager` (文件系统 JSON) | `SupabaseHistoryManager`（PuppyOne 自建，同接口） |
| `AuditLog` (文件系统 JSON) | `SupabaseAuditManager`（PuppyOne 自建，同接口） |
| `ScopeManager` (文件系统 JSON) | Scope 存在 `connections.config` JSONB |

**这意味着：Mut 项目零改动。所有云端适配都在 PuppyOne 侧完成。**

---

### Phase 1: PuppyOne 集成基础 ✅ 已完成

**目标：** 在 PuppyOne 中实现云端后端，建立 per-project Mut repo 管理。

**已完成的任务：**

1. **安装 mut 依赖** ✅
2. **实现云端后端** ✅
   ```
   backend/src/mut_core/
   ├── __init__.py
   ├── backends/
   │   ├── s3_storage.py          # S3StorageBackend (扩展 Mut 的 StorageBackend)
   │   ├── supabase_history.py    # SupabaseHistoryManager (同 Mut HistoryManager 接口)
   │   └── supabase_audit.py      # SupabaseAuditManager (同 Mut AuditLog 接口)
   ├── repo_manager.py            # per-project repo 工厂
   ├── index_sync.py              # Mut tree → content_nodes 同步
   ├── write_service.py           # MutWriteService (唯一写入入口)
   ├── compat_service.py          # MutCompatService (旧接口兼容层)
   ├── schemas.py                 # WriteResult, DeleteResult, MoveResult
   └── dependencies.py            # FastAPI DI
   ```

3. **per-project ServerRepo 管理**
   ```python
   class MutRepoManager:
       """每个 project 对应一个 Mut ServerRepo 实例"""

       def get_repo(self, project_id: str) -> ServerRepo:
           return ServerRepo(
               project_id=project_id,
               store=ObjectStore(backend=S3StorageBackend(s3, project_id)),
               history=HistoryManager(backend=SupabaseHistoryBackend(supabase, project_id)),
               audit=AuditLog(backend=SupabaseAuditBackend(supabase, project_id)),
               scopes=ScopeManager(backend=SupabaseScopeBackend(supabase, project_id)),
           )

       def init_repo(self, project_id: str, project_name: str):
           """新建 project 时初始化 Mut repo"""
           repo = self.get_repo(project_id)
           repo.init(project_name)
   ```

4. **Index Sync — Mut tree → content_nodes 同步**
   ```python
   class IndexSync:
       """每次 Mut commit 后，将 changeset 增量同步到 content_nodes 表"""

       async def sync_changeset(self, project_id: str, changes: list,
                                new_root: str, version: int):
           repo = self.repo_manager.get_repo(project_id)
           for change in changes:
               path = change["path"]
               op = change["op"]  # "added" | "modified" | "deleted"

               if op == "deleted":
                   self.node_repo.delete_by_mut_path(project_id, path)
               elif op == "added":
                   blob_hash = self._resolve_hash(repo, new_root, path)
                   self.node_repo.create(
                       project_id=project_id,
                       name=basename(path),
                       type=detect_type(path),
                       mut_path=path,
                       content_hash=blob_hash,
                       current_version=version,
                   )
               elif op == "modified":
                   blob_hash = self._resolve_hash(repo, new_root, path)
                   self.node_repo.update_by_mut_path(
                       project_id, path,
                       content_hash=blob_hash,
                       current_version=version,
                   )
   ```

**完成标志：** 可以 programmatically 创建 Mut repo、写入 blob、构建 tree、记录 history，
并同步到 content_nodes 表。所有数据在 S3 + Supabase 中，无本地文件系统依赖。

---

### Phase 2: 写入路径迁移

**目标：** 所有内容写入通过 Mut 操作。彻底替代 CollaborationService + ContentNodeService 双写路径。

**核心：新建 `MutWriteService`**（替代 CollaborationService + VersionService + LockService + ConflictService）

```python
class MutWriteService:
    """PuppyOne 的唯一写入入口。所有内容变更通过 Mut 操作。"""

    def __init__(self, repo_manager: MutRepoManager, node_repo, index_sync):
        self.repos = repo_manager
        self.node_repo = node_repo
        self.index_sync = index_sync

    async def write_file(self, project_id: str, path: str,
                         content: bytes, operator: str,
                         scope: dict | None = None,
                         message: str = "") -> WriteResult:
        """创建或更新文件 — 核心写操作"""

        repo = self.repos.get_repo(project_id)

        # 1. 权限检查（Mut scope）
        if scope:
            check_path_permission(scope, path, "write")

        # 2. 写入 blob
        blob_hash = await repo.store.async_put(content)

        # 3. 读取当前树
        current_root = await repo.async_get_root_hash()
        current_version = await repo.async_get_latest_version()

        # 4. 如果文件已存在且需要合并
        if current_root:
            existing_hash = resolve_path_in_tree(repo.store, current_root, path)
            if existing_hash and existing_hash != blob_hash:
                # 三方合并
                base = await repo.store.async_get(existing_hash)
                merged = three_way_merge(base, base, content, path)
                blob_hash = await repo.store.async_put(merged.content)

        # 5. 修改树
        entries = read_current_tree_entries(repo.store, current_root)
        update_tree_entry(entries, path, blob_hash)
        new_tree_hash = write_tree(repo.store, entries)

        # 6. Graft → 新 root
        new_root = graft_subtree(repo.store, current_root, "", new_tree_hash)

        # 7. 记录版本
        new_version = current_version + 1
        changes = [{"path": path, "op": "modified" if existing_hash else "added"}]
        await repo.async_record_history(new_version, operator, message,
                                        "", changes, root_hash=new_root)
        await repo.async_set_latest_version(new_version)
        await repo.async_set_root_hash(new_root)

        # 8. 审计
        await repo.async_record_audit("write", operator, {"path": path})

        # 9. 同步 content_nodes index
        await self.index_sync.sync_changeset(project_id, changes, new_root, new_version)

        return WriteResult(version=new_version, hash=blob_hash, root=new_root)

    async def delete_file(self, project_id, path, operator, scope, message): ...
    async def move_file(self, project_id, old_path, new_path, operator, scope, message): ...
    async def create_folder(self, project_id, path, operator): ...

    async def read_file(self, project_id: str, path: str) -> bytes:
        """从 Mut ObjectStore 读取文件内容"""
        repo = self.repos.get_repo(project_id)
        root = await repo.async_get_root_hash()
        blob_hash = resolve_path_in_tree(repo.store, root, path)
        return await repo.store.async_get(blob_hash)
```

**路径映射：旧接口 → 新接口**

所有现有的 30+ 个 `collab.commit(Mutation(...))` 调用迁移为：

| 旧调用 | 新调用 |
|--------|--------|
| `commit(Mutation(type=CONTENT_UPDATE, node_id=X, content=Y))` | `write_file(project_id, path, content_bytes, operator)` |
| `commit(Mutation(type=NODE_CREATE, name="X", node_type="json"))` | `write_file(project_id, "X.json", content_bytes, operator)` |
| `commit(Mutation(type=NODE_CREATE, node_type="folder"))` | `create_folder(project_id, path, operator)` |
| `commit(Mutation(type=NODE_DELETE))` | `delete_file(project_id, path, operator)` |
| `commit(Mutation(type=NODE_RENAME, new_name="Y"))` | `move_file(project_id, old_path, new_path, operator)` |
| `commit(Mutation(type=NODE_MOVE))` | `move_file(project_id, old_path, new_path, operator)` |

**注意：** 接口从 node_id-centric 变为 path-centric。这是正确的——Mut 的世界中，
路径才是文件的地址，UUID 只是 index 中的标识符。

**迁移的 30+ 调用点：**

| 文件 | 调用数 | 迁移方式 |
|------|-------|---------|
| `content_node/router.py` | 8 | 改为 `mut_write.write_file()` / `delete_file()` / `move_file()` |
| `internal/router.py` | 5 | 同上 |
| `upload/file/jobs/jobs.py` | 3 | 同上（ETL 结果写入 Mut） |
| `connectors/datasource/engine.py` | 1 | Connector fetch → `mut_write.write_file()` |
| `connectors/datasource/service.py` | 2 | 同上 |
| `connectors/filesystem/folder_access.py` | 1 | OpenClaw push → Mut write |
| `collaboration/router.py` | 1 | 保留 checkout/commit API，内部改为 Mut |
| `upload/router.py` | 2 | 同上 |
| `sandbox/registry.py` | 1 | 同上 |
| `connectors/agent/service.py` | 2+ | 同上 |
| `scheduler/jobs/sandbox_reaper.py` | 1 | 同上 |
| `content_node/service.py` | 11 | **删除 `_track_version()`，ContentNodeService 不再做版本管理** |

---

### Phase 3: 读取路径迁移 + content_nodes 瘦身

**目标：** 内容读取从 content_nodes 的 preview_json/preview_md 切换到 Mut ObjectStore。
content_nodes 表瘦身为纯元数据 index。

**任务：**

1. **内容读取改为从 Mut 读**
   ```python
   # 旧：从 DB 读
   node = node_repo.get_by_id(node_id)
   content = node.preview_json or node.preview_md

   # 新：从 Mut ObjectStore 读
   repo = repo_manager.get_repo(node.project_id)
   root = repo.get_root_hash()
   blob_hash = resolve_path_in_tree(repo.store, root, node.mut_path)
   content_bytes = repo.store.get(blob_hash)
   ```

2. **content_nodes 表变更**（见 `sql/migrations/2026-03-18_mut_migration.sql` PART 2）
   - 新增 `mut_path` 列
   - 保留 preview_json/preview_md 作为缓存（UI 性能），source of truth 是 Mut ObjectStore

3. **前端 API 不变**
   - `GET /api/v1/nodes/?project_id=X&parent_id=Y` — 树浏览，仍然查 content_nodes
   - `GET /api/v1/nodes/{node_id}` — 详情页，content 从 Mut 读取
   - 响应 schema 不变，内部数据源切换

4. **版本历史 API 改为从 Mut 读**
   ```python
   # 旧：从 file_versions 表读
   versions = version_repo.list_by_node(node_id)

   # 新：从 Mut history 读
   repo = repo_manager.get_repo(project_id)
   history = repo.get_history_since(0, scope_path=node.mut_path)
   ```

5. **Diff API 改为使用 Mut diff**
   ```python
   from mut.core.diff import diff_trees

   changes = diff_trees(repo.store, root_at_v1, root_at_v2)
   ```

---

### Phase 4: Mut 协议端点 + Agent 原生支持

**目标：** Agent 可以通过 `mut clone/commit/push/pull` 直接操作 PuppyOne 内容树。

**任务：**

1. **实现 PuppyOneAuthenticator**
   ```python
   from mut.server.auth.base import Authenticator

   class PuppyOneAuthenticator(Authenticator):
       async def authenticate(self, headers, body) -> dict:
           token = extract_bearer(headers)
           # JWT → user scope / Access Key → agent scope
           agent_id, scope = resolve_credentials(token)
           return {"agent": agent_id, "_scope": scope}
   ```

2. **在 FastAPI 中嵌入 Mut handler**
   ```python
   from mut.server.handlers import handle_clone, handle_push, handle_pull, handle_negotiate

   @router.post("/mut/{project_id}/clone")
   async def clone(project_id: str, body: dict, auth = Depends(mut_auth)):
       repo = repo_manager.get_repo(project_id)
       return handle_clone(repo, auth, body)

   @router.post("/mut/{project_id}/push")
   async def push(project_id: str, body: dict, auth = Depends(mut_auth)):
       repo = repo_manager.get_repo(project_id)
       result = await handle_push(repo, auth, body)
       # Push 后触发 index sync
       await index_sync.sync_changeset(project_id, result["changes"], ...)
       return result
   ```

3. **Agent 使用 Mut CLI 直接操作**
   ```bash
   mut clone https://api.puppyone.ai/api/v1/mut/proj_123 --credential <key>
   # → 本地 .mut/ 目录，只拿到 scope 内的文件

   vim notes.md
   mut commit -m "updated notes"
   mut push
   # → 服务端三方合并 + graft → 新版本
   ```

---

### Phase 5: Scope 权限 + 清理

**目标：** 用 Mut scope 替代 `connection_accesses`。清理所有旧代码。

1. **Scope 权限迁移**
   - `connection_accesses` 中的 node-level 权限 → Mut scope (path-level)
   - Agent 创建时自动分配 scope
   - `check_path_permission()` 替换所有权限检查

2. **删除旧代码**

   **整个 collaboration/ 模块删除（12 个文件 → 0）：**
   - `service.py` (CollaborationService) → 被 MutWriteService 替代
   - `version_service.py` → 被 Mut HistoryManager 替代
   - `version_repository.py` → 被 Mut ObjectStore 替代
   - `conflict_service.py` → 被 `mut.core.merge` 替代
   - `lock_service.py` → 被 Mut 版本比对替代
   - `audit_service.py` → 被 Mut AuditLog 替代
   - `audit_repository.py` → 被 Mut AuditLog 替代
   - `schemas.py` → 精简后移入 `mut_core/schemas.py`
   - `dependencies.py` → 移入 `mut_core/dependencies.py`
   - `router.py` → 保留，内部改为调用 MutWriteService
   - `audit_router.py` → 保留，内部改为读 Mut audit

   **content_node/ 清理：**
   - 删除 `_track_version()` 和相关 version_service 注入
   - 删除 `version_service.py`, `version_repository.py`, `version_schemas.py`（兼容层）
   - ContentNodeService 只做元数据 CRUD，不做版本管理

   **数据库表：**
   - `file_versions` → 保留一段时间（数据迁移后可删除）
   - `folder_snapshots` → 保留一段时间（功能由 Mut history 替代）
   - `audit_logs` → 保留一段时间（功能由 Mut audit 替代）

3. **新的模块结构**
   ```
   backend/src/mut_core/           # 替代 collaboration/
   ├── __init__.py
   ├── write_service.py            # MutWriteService（唯一写入入口）
   ├── repo_manager.py             # per-project ServerRepo 管理
   ├── index_sync.py               # Mut tree → content_nodes 同步
   ├── schemas.py                  # WriteResult, 精简的 API 类型
   ├── router.py                   # /collab API + /mut 协议端点
   ├── auth.py                     # PuppyOneAuthenticator
   ├── dependencies.py             # FastAPI DI
   └── backends/
       ├── s3_storage.py           # S3StorageBackend
       ├── supabase_history.py     # SupabaseHistoryBackend
       ├── supabase_audit.py       # SupabaseAuditBackend
       └── supabase_scope.py       # SupabaseScopeBackend
   ```

---

## 5. 数据库变更清单

### 5.1 总览

| 类别 | 变更 | 涉及表 | DDL 类型 |
|------|------|--------|---------|
| 新建表 | Mut 版本历史 | `mut_commits` | CREATE TABLE |
| 加列 | Mut 树路径映射 | `content_nodes` | ALTER TABLE ADD COLUMN |
| 加列 | Mut 状态（root hash + 版本号） | `projects` | ALTER TABLE ADD COLUMN |
| 加列 + 放宽约束 | 适配 Mut 审计事件 | `audit_logs` | ALTER TABLE |
| 不变 | 全部保留 | `connections`, `connection_accesses`, 其余所有表 | — |
| 最终可删 | 迁移完成后废弃 | `file_versions`, `folder_snapshots` | DROP TABLE（不急） |

**迁移文件：** `backend/sql/migrations/2026-03-18_mut_migration.sql`

### 5.2 新建表：`mut_commits`

替代 `file_versions` 的角色。核心区别：

| | `file_versions`（旧） | `mut_commits`（新） |
|---|---|---|
| **粒度** | per-node（每个文件独立版本线） | per-project（全局版本号） |
| **存什么** | 完整内容快照 (content_json, content_text) | 变更集元数据 (changeset) |
| **版本号** | 每个 node 从 1 递增 | 全 project 从 1 递增 |
| **核心字段** | node_id, content_json, content_text, s3_key | root_hash, scope_path, changes[] |
| **内容寻址** | 无 | root_hash 可验证整棵树完整性 |

```sql
CREATE TABLE IF NOT EXISTS mut_commits (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version         INT NOT NULL,
    root_hash       TEXT NOT NULL DEFAULT '',
    scope_path      TEXT NOT NULL DEFAULT '',
    who             TEXT NOT NULL,
    message         TEXT NOT NULL DEFAULT '',
    changes         JSONB NOT NULL DEFAULT '[]',
    conflicts       JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, version)
);
```

### 5.3 现有表变更

**`content_nodes` — 加 1 列**

```sql
ALTER TABLE content_nodes ADD COLUMN IF NOT EXISTS mut_path TEXT;
```

`mut_path` 存储节点在 Mut 树中的人类可读路径（如 `docs/meeting-notes.md`），
用于在 UUID 和 Mut 路径之间映射。

**`projects` — 加 2 列**

```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS mut_root_hash TEXT DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS mut_version INT DEFAULT 0;
```

每个 project 的 Mut repo 状态：当前 root hash 和最新版本号。

**`audit_logs` — 加 1 列 + 放宽 1 个约束**

```sql
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS project_id TEXT;
ALTER TABLE audit_logs ALTER COLUMN node_id DROP NOT NULL;
```

- `project_id`：Mut 审计事件需要 project 维度
- `node_id` 改为可空：Mut 有些审计事件（clone/push/pull）不针对特定 node

### 5.4 不需要改的

| 表/存储 | 原因 |
|---------|------|
| **S3 (ObjectStore)** | Mut blobs 直接写 S3，前缀 `mut/{project_id}/objects/`，复用现有 bucket |
| **Redis (Locks)** | Mut scope-level 锁复用 PuppyOne 已有的 Redis（ARQ 用的那个） |
| **`connections`** | Scope 信息存在 `connections.config` JSONB 中，零 DDL |
| **`connection_accesses`** | 保留不变，scope 迁移在 Phase 5 |
| **`content_nodes` 现有列** | 全部保留：preview_json/preview_md 作为缓存，id_path/depth 保留 |
| **`organizations`** | 不涉及 |
| **`project_members`** | 不涉及 |
| **`profiles`** | 不涉及 |
| **`tools`**, `mcps`, `mcp_bindings` | 不涉及 |
| **`chunks`**, `uploads`, `etl_rules` | 不涉及 |
| **`oauth_connections`** | 不涉及 |
| **`chat_sessions`**, `chat_messages` | 不涉及 |
| **`sync_changelog`** | 保留，仍用于 OpenClaw 通知 |

### 5.5 最终可删除的（迁移完成后）

| 表/对象 | 何时删 | 前提条件 |
|---------|--------|---------|
| `file_versions` | Phase 5 完成后 | 存量数据已迁移到 Mut ObjectStore + mut_commits |
| `folder_snapshots` | Phase 5 完成后 | 功能被 mut_commits 替代 |
| `next_version()` 函数 | Phase 5 完成后 | 版本号改由 Mut 管理 |
| `content_nodes.preview_json` | 可选 | 如果确认 UI 不再需要 DB 级缓存 |
| `content_nodes.preview_md` | 可选 | 同上 |

---

## 6. Mut 与 PuppyOne 的职责边界

### 为什么 Mut 不加云端抽象

Git 的成功在于它的极简：只操作文件，不关心文件在哪里。GitHub 在 Git 之上加了
数据库、API、云端基础设施。这个分层让 Git 可以被任何平台复用（GitLab、Gitea 等）。

Mut 也应如此：

```
Mut（版本内核，极简）          PuppyOne（平台，云端）
  ├── 文件操作                   ├── S3 存储
  ├── Merkle tree                ├── PostgreSQL 历史/审计
  ├── 三方合并                   ├── Redis 锁
  ├── Scope 权限检查             ├── content_nodes 索引
  ├── Clone/Push/Pull 协议       ├── REST API + UI
  └── 零外部依赖                 ├── Connector 同步
                                 └── 用户/组织/项目管理
```

**唯一的跨界接口：** `ObjectStore.StorageBackend` — 这是 Mut 已有的抽象，
PuppyOne 实现了 `S3StorageBackend`。其余组件（History、Audit、Scope）
PuppyOne 自己实现同接口的云端版本，不需要 Mut 加 ABC。

### PuppyOne 如何桥接 Mut 的文件操作

| Mut 的文件操作 | PuppyOne 的云端实现 | 说明 |
|---|---|---|
| `ObjectStore.put/get` (blobs) | `S3StorageBackend` | 通过 Mut 的 `StorageBackend` 接口 |
| `HistoryManager` (JSON 文件) | `SupabaseHistoryManager` | PuppyOne 自建，同接口但写 DB |
| `AuditLog` (JSON 文件) | `SupabaseAuditManager` | PuppyOne 自建，同接口但写 DB |
| `ScopeManager` (JSON 文件) | `connections.config` JSONB | 复用现有表 |
| 文件锁 | `threading.Lock` / Redis | PuppyOne 自建 |
| `current/` 工作目录 | 不需要 | PuppyOne 直接操作 tree + ObjectStore |

**关键：PuppyOne 不使用 Mut 的 `ServerRepo` 和 `handlers`。**
它直接使用 Mut 的 core 模块（tree、merge、diff、graft）+ 自建的云端后端。
这就像 GitHub 不通过 `git daemon` 服务代码，而是直接调用 Git 的底层 plumbing 命令。

---

## 6. 数据迁移

### 6.1 迁移脚本（per-project）

```python
# scripts/migrate_project_to_mut.py

async def migrate_project(project_id: str):
    """把一个 project 的所有数据迁移到 Mut repo"""

    repo = repo_manager.get_repo(project_id)

    # Step 1: 把所有 content_nodes 的内容写入 Mut ObjectStore
    nodes = node_repo.list_all(project_id)
    files: dict[str, bytes] = {}

    for node in nodes:
        if node.type == "folder":
            continue
        path = derive_mut_path(node)  # 从 id_path + name 生成人类可读路径
        if node.preview_json:
            files[path] = json.dumps(node.preview_json, ensure_ascii=False).encode()
        elif node.preview_md:
            files[path] = node.preview_md.encode()
        elif node.s3_key:
            files[path] = s3.get_object(node.s3_key)

    # Step 2: 构建初始 Merkle tree
    root_hash = repo._build_tree_from_files(files)

    # Step 3: 记录初始版本
    repo.history.record(
        version=1,
        who="migration",
        message=f"Migrated from PuppyOne content_nodes",
        scope_path="",
        changes=[{"path": p, "op": "added"} for p in files],
        root_hash=root_hash,
    )
    repo.history.set_latest_version(1)
    repo.history.set_root_hash(root_hash)

    # Step 4: 更新 content_nodes 添加 mut_path
    for node in nodes:
        if node.type != "folder":
            node_repo.update(node.id, mut_path=derive_mut_path(node))

    # Step 5: 迁移历史版本（可选，耗时）
    for fv in file_version_repo.list_all_by_project(project_id):
        content = serialize_version_content(fv)
        repo.store.put(content)  # 内容写入 ObjectStore
```

### 6.2 迁移策略

- **新项目：** 直接在 Mut 上创建，不走旧路径
- **存量项目：** 运行迁移脚本，先迁移再切换读写路径
- **回滚方案：** 保留旧表 30 天，feature flag 可切回旧路径

---

## 7. 时间线估算

| Phase | 内容 | 状态 | 工作量 |
|-------|------|------|--------|
| Phase 1 | PuppyOne 集成基础（后端实现 + repo manager + index sync） | ✅ 已完成 | — |
| Phase 2 | 写入路径迁移（MutWriteService + MutCompatService + 30 调用点切换） | ✅ 已完成 | — |
| Phase 3 | 读取路径迁移 + content_nodes 瘦身 | 待做 | 3-5 天 |
| Phase 4 | Mut 协议端点 + Agent 原生支持 | 待做 | 3-5 天 |
| Phase 5 | Scope 权限 + 清理旧代码 + 数据迁移 | 待做 | 5-7 天 |

**剩余工作：约 11-17 天**

**注意：Mut 项目零改动。** 所有工作都在 PuppyOne 侧完成。

---

## 8. 风险与缓解

| 风险 | 严重程度 | 缓解策略 |
|------|---------|---------|
| S3 读写延迟导致性能下降 | 中 | content_nodes 保留 preview 缓存；频繁读的 blob 加内存 LRU 缓存 |
| Mut 全局版本号 vs 前端期望 per-node 版本号 | 中 | content_nodes 的 current_version 由 IndexSync 维护 |
| 迁移期间数据不一致 | 中 | MutCompatService 兼容层保证旧调用方零改动；新旧路径不会同时写 |
| 分布式锁（多实例并发写同一 project） | 中 | MutRepoManager 有 threading.Lock；生产环境可升级为 Redis 锁 |
| 旧 version_router 仍读 file_versions 表 | 低 | 暂时保留，Phase 3 切换到 Mut 历史查询 |

---

## 9. 成功标准

迁移完成后：

1. **Mut repo 是 source of truth** — 内容和树结构由 Merkle tree 管理，可验证完整性
2. **content_nodes 是 read index** — 从 Mut 同步，可以随时从 tree 重建
3. **collaboration/ 模块完全删除**（12 个文件 ~1800 行 → 0）
4. **mut_core/ 模块** — ~500 行，只做 PuppyOne 特定的后端实现和 index sync
5. **合并能力** — Mut 成熟的三方合并引擎，可插拔策略，hunk 级行合并
6. **Agent 原生协议** — `mut clone/commit/push/pull` 直接操作
7. **scope 权限** — 路径级 ACL，agent clone 只拿到 scope 内的内容
8. **Merkle 完整性** — 整个项目树有一个可验证的 root hash
9. **单一写入路径** — `MutWriteService` 是唯一入口，不存在旁路
