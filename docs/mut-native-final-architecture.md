# Mut-Native PuppyOne — 终态架构设计

> **状态：已实施完成 (2026-03-19)**
>
> 所有 6 个 Phase 已完成。`content_nodes` 和 `connection_accesses` 表已删除。
> 所有内容操作直接对接 Mut tree。前端已迁移到 path-based 路由。

> **核心原则：Mut server 是唯一的内容真相源。PG 是控制平面，不持有内容节点。**
>
> 本文档是对 `mut-native-architecture.md`（Phase 4 完成后的设计）和 `mut-path-refactor-roadmap.md`（Opus content_nodes 重构）的 **替代方案**。
>
> 区别在于：前两份文档仍然把 `content_nodes` 当作核心内容模型（只是从 Mut 同步）。本文档的结论是：**`content_nodes` 表应该被删除**，所有内容操作直接对接 Mut tree。

---

## 1. 架构哲学

### 1.1 为什么删除 content_nodes

| 问题 | 现状 | 本文档方案 |
|------|------|-----------|
| 两套 SOT | Mut tree (S3) + content_nodes (PG) 同时持有树结构 | Mut tree 是唯一 SOT |
| 双写风险 | `MutCompatService` 同时写 Mut 和 PG，出错导致永久不一致 | 所有写入只进 Mut |
| 过度建模 | 每个文件/文件夹都在 PG 有一行（UUID、depth、parent_id...） | 文件不需要 UUID，不需要 PG 行 |
| 权限双轨 | Mut scope (path-based) + connection_accesses (UUID-based) 并存 | 统一到 Mut scope |
| IndexSync 复杂性 | rename detection、folder ensure、extension mismatch... | 不需要 IndexSync |

### 1.2 三层定位

```
┌─────────────────── Data Plane: Mut ────────────────────┐
│                                                         │
│  Merkle tree (S3)  — 树结构 + 文件内容（唯一 SOT）       │
│  mut_commits (PG)  — 版本历史                            │
│  audit_logs (PG)   — 审计日志                            │
│  scope             — 权限边界（connections.config.scope） │
│  .trash/           — 软删除（Mut tree 内目录）            │
│                                                         │
│  能力: 版本控制、merge、diff、rollback、scope 权限       │
│  协议: clone / push / pull / negotiate                  │
│                                                         │
└────────────────────────┬────────────────────────────────┘
                         │
┌─────────────── Control Plane: PG ──────────────────────┐
│                                                         │
│  projects           — 项目注册                           │
│  connections        — Agent/connector/endpoint 注册      │
│                       + scope 配置 + access_key          │
│  connection_tools   — Agent ↔ Tool 绑定                 │
│  tools              — Tool 注册                          │
│  organizations      — 组织管理                           │
│  profiles           — 用户资料                           │
│  oauth_connections  — OAuth 集成                         │
│  chat_sessions/msg  — Agent 聊天历史                     │
│  bookmarks          — 少量稳定 handle（按需）             │
│                                                         │
│  能力: 注册、认证、计费、运营                             │
│  特点: 不持有任何文件内容或树结构                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**不再有"加速缓存层"。** 如果将来有性能瓶颈，再按需加 Redis/内存缓存，但当前阶段不预建。

---

## 2. 删除的表和模块

### 2.1 删除的 PG 表

| 表 | 原因 |
|---|---|
| `content_nodes` | Mut tree 是 SOT，不需要 PG 全量镜像 |
| `connection_accesses` | 统一到 Mut scope (connections.config.scope) |

### 2.2 删除的后端模块

| 模块 | 原因 | 替代 |
|------|------|------|
| `src/content/repository.py` | 操作 content_nodes 表 | Mut tree 读写 |
| `src/content/service.py` | 基于 content_nodes 的业务逻辑 | MutWriteService + MutTreeReader |
| `src/content/models.py` | ContentNode Pydantic 模型 | MutNode 轻量响应模型 |
| `src/content/router.py` | REST API 查 content_nodes | 新的 tree API（直接读 Mut） |
| `src/mut_engine/index_sync.py` | Mut → content_nodes 同步 | 不再需要 |
| `src/mut_engine/compat_service.py` | 兼容旧 CollaborationService | MutWriteService 直接替代 |
| `src/content/table/` | JSON Pointer 表操作（基于 content_nodes） | 基于 Mut path 重写 |

### 2.3 保留的后端模块

| 模块 | 状态 | 说明 |
|------|------|------|
| `src/mut_engine/write_service.py` | **保留，升级** | 唯一写入入口，增加 move/rename/mkdir/trash |
| `src/mut_engine/server_repo.py` | **保留** | PuppyOneServerRepo，S3+PG 适配器 |
| `src/mut_engine/protocol_router.py` | **保留** | Mut wire protocol 端点 |
| `src/mut_engine/repo_manager.py` | **保留** | per-project repo 工厂 |
| `src/mut_engine/auth.py` | **保留** | JWT/AccessKey → agent + scope |

---

## 3. 新增的核心组件

### 3.1 MutTreeReader — 直接读 Mut tree

替代 `ContentNodeRepository` 的读操作。所有文件列表、内容读取直接走 Mut tree。

```python
class MutTreeReader:
    """直接读 Mut Merkle tree，不经过 PG。"""

    def __init__(self, repo_manager: MutRepoManager):
        self._repos = repo_manager

    def list_dir(self, project_id: str, path: str = "") -> list[MutEntry]:
        """列出目录内容（类似 ls）。
        
        直接读 Mut tree object，返回子条目列表。
        """
        repo = self._repos.get_repo(project_id)
        root_hash = repo.history.get_root_hash()
        if not root_hash:
            return []

        tree_hash = self._navigate(repo.store, root_hash, path)
        if not tree_hash:
            return []

        entries = read_tree(repo.store, tree_hash)
        result = []
        for name, (typ, hash_val) in entries.items():
            result.append(MutEntry(
                name=name,
                path=f"{path}/{name}" if path else name,
                type="folder" if typ == "T" else detect_type(name),
                content_hash=hash_val if typ == "B" else None,
            ))
        return sorted(result, key=lambda e: (e.type != "folder", e.name))

    def read_file(self, project_id: str, path: str) -> bytes:
        """读取文件内容。"""
        repo = self._repos.get_repo(project_id)
        root_hash = repo.history.get_root_hash()
        blob_hash = self._resolve_blob(repo.store, root_hash, path)
        if not blob_hash:
            raise FileNotFoundError(f"File not found: {path}")
        return repo.store.get(blob_hash)

    def stat(self, project_id: str, path: str) -> MutEntry | None:
        """获取单个条目信息（类似 stat）。"""
        repo = self._repos.get_repo(project_id)
        root_hash = repo.history.get_root_hash()
        if not root_hash:
            return None
        # ... 解析 tree 定位到 path 对应的 entry

    def list_tree(self, project_id: str, path: str = "", recursive: bool = False) -> list[MutEntry]:
        """递归列出目录树（用于 tree view / 搜索）。"""
        repo = self._repos.get_repo(project_id)
        root_hash = repo.history.get_root_hash()
        flat = tree_to_flat(repo.store, root_hash)
        # 按 path 前缀过滤，构建目录结构
        ...
```

### 3.2 MutEntry — 轻量响应模型

替代 `ContentNode` 模型。不从 PG 来，直接从 Mut tree 构建。

```python
@dataclass
class MutEntry:
    """Mut tree 中的一个条目（文件或目录）。"""
    name: str              # 文件名 (e.g. "readme.md")
    path: str              # 完整路径 (e.g. "docs/readme.md")
    type: str              # "folder" | "json" | "markdown" | "file"
    content_hash: str | None = None   # blob hash (文件有, 目录无)
    size_bytes: int | None = None     # 可选, 需要额外读 blob

    # 不再有: id (UUID), depth, parent_id, mut_path, created_by, ...
```

### 3.3 扩展 MutWriteService — 完整的写入 API

现有 `MutWriteService` 只有 `write_file` / `delete_file` / `move_file`。需要增加：

```python
class MutWriteService:
    # 已有
    async def write_file(self, project_id, path, content, operator, message, base_version) -> WriteResult
    async def delete_file(self, project_id, path, operator, message) -> WriteResult
    async def move_file(self, project_id, old_path, new_path, operator, message) -> MoveResult

    # 新增
    async def mkdir(self, project_id, path, operator) -> str:
        """创建空目录（通过写入 .keep sentinel 文件）。"""
        keep_path = f"{path}/.keep"
        await self.write_file(project_id, keep_path, b"", operator, f"mkdir {path}")
        return path

    async def trash(self, project_id, path, operator) -> WriteResult:
        """软删除：mv path → .trash/<basename>_<timestamp>。"""
        import time
        basename = path.rsplit("/", 1)[-1] if "/" in path else path
        trash_path = f".trash/{basename}_{int(time.time())}"
        return await self.move_file(project_id, path, trash_path, operator, f"trash {basename}")

    async def restore(self, project_id, trash_path, original_path, operator) -> MoveResult:
        """从 .trash 恢复。"""
        return await self.move_file(project_id, trash_path, original_path, operator, f"restore {original_path}")
```

### 3.4 新的 REST API（Tree API）

替代现有的 `/api/v1/nodes` 系列端点。

```python
router = APIRouter(prefix="/api/v1/tree")

@router.get("/{project_id}/ls")
async def list_dir(project_id: str, path: str = "", auth = Depends(get_auth)):
    """列出目录内容。"""
    reader = MutTreeReader(repo_manager)
    entries = reader.list_dir(project_id, path)
    return {"path": path, "entries": [e.__dict__ for e in entries]}

@router.get("/{project_id}/cat")
async def read_file(project_id: str, path: str, auth = Depends(get_auth)):
    """读取文件内容。"""
    reader = MutTreeReader(repo_manager)
    content = reader.read_file(project_id, path)
    node_type = detect_type(path)
    if node_type == "json":
        return {"path": path, "type": "json", "content": json.loads(content)}
    return {"path": path, "type": node_type, "content": content.decode("utf-8", errors="replace")}

@router.get("/{project_id}/stat")
async def stat(project_id: str, path: str, auth = Depends(get_auth)):
    """获取文件/目录信息。"""
    ...

@router.get("/{project_id}/tree")
async def full_tree(project_id: str, path: str = "", auth = Depends(get_auth)):
    """获取完整目录树（递归）。"""
    ...

@router.post("/{project_id}/write")
async def write_file(project_id: str, body: WriteRequest, auth = Depends(get_auth)):
    """写入文件。"""
    result = await mut_write.write_file(
        project_id=project_id,
        path=body.path,
        content=body.content.encode("utf-8"),
        operator=f"user:{auth.user_id}",
        message=body.message or f"edit {body.path}",
        base_version=body.base_version,
    )
    return result

@router.post("/{project_id}/mkdir")
async def mkdir(project_id: str, body: MkdirRequest, auth = Depends(get_auth)):
    """创建目录。"""
    path = await mut_write.mkdir(project_id, body.path, f"user:{auth.user_id}")
    return {"path": path}

@router.post("/{project_id}/mv")
async def move(project_id: str, body: MoveRequest, auth = Depends(get_auth)):
    """移动/重命名。"""
    result = await mut_write.move_file(
        project_id, body.old_path, body.new_path,
        f"user:{auth.user_id}", body.message or f"mv {body.old_path} → {body.new_path}",
    )
    return result

@router.post("/{project_id}/rm")
async def remove(project_id: str, body: RemoveRequest, auth = Depends(get_auth)):
    """删除（移入 .trash）。"""
    result = await mut_write.trash(project_id, body.path, f"user:{auth.user_id}")
    return result
```

---

## 4. 权限模型

### 4.1 统一到 Mut scope

删除 `connection_accesses` 表。Agent 权限完全由 `connections.config.scope` 定义。

```json
// connections 表中的一行 (provider='agent')
{
  "id": "conn_abc123",
  "project_id": "proj_xyz",
  "provider": "agent",
  "access_key": "mcp_xxxxx",
  "config": {
    "name": "My Agent",
    "scope": {
      "path": "docs/",
      "exclude": ["docs/internal/"],
      "mode": "rw"
    }
  }
}
```

### 4.2 权限检查流程

```
请求进来 → 解析 auth token
  │
  ├─ JWT (人类用户) → scope = {"path": "", "exclude": [], "mode": "rw"}  (全量访问)
  │
  └─ Access Key (Agent) → 查 connections 表 → scope = config.scope
     │
     ▼
  对每个文件操作: check_path_permission(scope, file_path, action)
     │
     ├─ path 在 scope.path 下？
     ├─ path 不在 scope.exclude 下？
     └─ action 匹配 scope.mode？
```

### 4.3 比 connection_accesses 更强

| | connection_accesses (旧) | Mut scope (新) |
|---|---|---|
| 粒度 | 单个 node UUID | path prefix + exclude |
| 表达力 | "能访问 node A、node B" | "能访问 /docs/ 但不能访问 /docs/internal/" |
| 文件移动 | UUID 不变，权限不变 | path 变了，权限自动跟随（正确行为） |
| 新建文件 | 需要手动添加 access | scope 内新建的文件自动有权限 |
| 管理成本 | N 个文件 = N 行记录 | 1 个 scope 定义 |

---

## 5. .trash 实现

在 Mut tree 内部用 `.trash/` 目录实现软删除，不依赖 PG。

### 5.1 删除流程

```
用户删除 docs/readme.md
  → MutWriteService.trash("proj_xyz", "docs/readme.md", operator)
  → Mut move_file: docs/readme.md → .trash/readme.md_1710835200
  → 产生 Mut commit (version N+1)
  → .trash/ 就是 Mut tree 的一部分，有完整版本历史
```

### 5.2 恢复流程

```
用户恢复 .trash/readme.md_1710835200
  → MutWriteService.restore("proj_xyz", ".trash/readme.md_1710835200", "docs/readme.md", operator)
  → Mut move_file: .trash/readme.md_1710835200 → docs/readme.md
  → 产生 Mut commit
```

### 5.3 清空回收站

```
列出 .trash/ 下所有文件
  → 对每个文件: MutWriteService.delete_file() (真删)
  → 文件从 Mut tree 移除，但 blob 仍在 S3（不立即 GC）
  → 需要时可以通过历史版本恢复
```

### 5.4 .trash 对 Agent 不可见

Agent 的 scope 默认 exclude `.trash/`：

```json
{
  "path": "",
  "exclude": [".trash/"],
  "mode": "rw"
}
```

---

## 6. 前端改造

### 6.1 路由：UUID → path

```
现在: /projects/proj_123/data/uuid1/uuid2/uuid3
终态: /projects/proj_123/data/docs/readme.md
```

URL 直接反映 Mut tree 中的文件路径。路径变了 URL 就变了——这是文件系统的正确行为。

### 6.2 数据获取

```
现在:
  useContentNodes(projectId)     → GET /api/v1/nodes?project_id=xxx  → 查 content_nodes 表
  usePathResolver(path: UUID[])  → 批量查 content_nodes by UUID

终态:
  useTreeDir(projectId, path)    → GET /api/v1/tree/{projectId}/ls?path=xxx  → 直接读 Mut tree
  useFileContent(projectId, path) → GET /api/v1/tree/{projectId}/cat?path=xxx → 读 Mut blob
```

### 6.3 写操作

```
现在:
  创建 JSON → POST /api/v1/collab/commit (mutation: NODE_CREATE)
            → MutCompatService → 写 PG + 写 Mut

终态:
  创建 JSON → POST /api/v1/tree/{projectId}/write
            → MutWriteService.write_file() → 只写 Mut
```

### 6.4 ExplorerSidebar 改造

现在 ExplorerSidebar 拿到的是 `ContentNode[]`（每个有 UUID、depth、parent_id）。

终态拿到的是 `MutEntry[]`（只有 name、path、type、content_hash）。

树结构不再由 PG 的 parent_id 表达，而是由 path 层级表达。前端展开目录时调 `ls` API 获取子目录内容，跟文件管理器一样。

---

## 7. 少量稳定 handle（bookmarks）

对于**确实需要不变 ID 的场景**（公开分享链接、connector 挂载点），用一个轻量表按需注册：

```sql
CREATE TABLE bookmarks (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL REFERENCES projects(id),
    path       TEXT NOT NULL,
    label      TEXT,
    type       TEXT NOT NULL DEFAULT 'pin',  -- pin | share | mount
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (project_id, path, type)
);
```

特点：
- 不是每个文件都有 —— 只有被用户显式 pin / share 的才有
- path 变了（文件重命名）→ bookmark 失效 → 用户重新 pin（可接受）
- 整个表可能只有几十到几百行
- 如果需要 content_hash 级别的 follow（重命名后自动跟随），可以存 `(path, content_hash)` 做 fallback 查找

---

## 8. 搜索索引

搜索索引（Turbopuffer chunks）不再关联 `content_nodes.id`，改用 `(project_id, path)` 做 key。

### 8.1 索引时

```
Mut commit 后 → 遍历 changeset
  → 对每个 added/modified 的文件:
      chunk content → upsert to Turbopuffer with key = (project_id, path)
  → 对每个 deleted 的文件:
      delete from Turbopuffer where key = (project_id, old_path)
```

### 8.2 查询时

```
搜索结果返回 (project_id, path, score, snippet)
  → 前端直接用 path 导航到文件
  → 不需要 UUID
```

### 8.3 rename 处理

文件 rename 在 Mut changeset 中表现为 `deleted(old_path) + added(new_path)`。

搜索索引处理：delete old key → insert new key。内容没变的情况下可以优化为 update key（跟之前 IndexSync 的 rename detection 一样的思路，但只用于搜索索引，不用于 content_nodes）。

---

## 9. 受影响的 Connector 模块

### 9.1 Datasource connectors（Gmail / GitHub / Notion / ...）

```
现在: fetch data → ContentNodeService.create_xxx() → 写 PG → MutCompatService 写 Mut
终态: fetch data → MutWriteService.write_file() → 只写 Mut
```

### 9.2 Filesystem sync (OpenClaw)

```
现在: CLI daemon → 自定义 REST API → 操作 content_nodes
终态: CLI daemon → mut push/pull → 标准 Mut protocol
```

### 9.3 Agent sandbox

```
现在: 启动时从 content_nodes 读文件列表 → 加载到容器
终态: 容器内 mut clone → 直接得到文件 → 工作完成 mut push
```

### 9.4 MCP endpoint

```
现在: MCP tools → 查 content_nodes → 读写 content_nodes + Mut
终态: MCP tools → MutTreeReader.read_file() / MutWriteService.write_file()
```

---

## 10. 数据流总图（终态）

```
写入流:

  Mut Protocol ─┐
  MCP Tools ────┤
  Tree API ─────┤──→ MutWriteService
  Internal API ─┤         │
  Datasource ───┘         ▼
                    ┌─ Mut Core ─────────────────────────┐
                    │  1. ObjectStore.put(bytes) → hash   │
                    │  2. 修改 Merkle tree                │
                    │  3. graft_subtree → new root hash   │
                    │  4. three_way_merge (冲突时)        │
                    │  5. history.record(version, changes)│
                    │  6. audit.record(event)             │
                    └────────────┬────────────────────────┘
                                 │
                                 ▼
                    ┌─ Post-commit hooks ─────────────────┐
                    │  更新搜索索引 (Turbopuffer)           │
                    │  WebSocket 通知 (实时更新)            │
                    │  (不再有 IndexSync → PG)             │
                    └─────────────────────────────────────┘


读取流:

  前端/API ──┬── 目录浏览 ──→ MutTreeReader.list_dir() → 读 Mut tree (S3)
             ├── 文件内容 ──→ MutTreeReader.read_file() → 读 Mut blob (S3)
             ├── 版本历史 ──→ mut_commits (PG)
             ├── Diff ──────→ mut.core.diff.diff_trees()
             └── 搜索 ──────→ Turbopuffer → 返回 (project_id, path)
```

---

## 11. 实施 Roadmap

### Phase 1: 新建 Tree API + MutTreeReader

**目标**: 在不动现有代码的情况下，新增一套基于 Mut tree 的读写 API。

- [ ] 实现 `MutTreeReader`（list_dir / read_file / stat / list_tree）
- [ ] 实现 `MutEntry` 响应模型
- [ ] 新增 `/api/v1/tree/{project_id}/ls|cat|stat|tree` 只读端点
- [ ] 扩展 `MutWriteService`（mkdir / trash / restore）
- [ ] 新增 `/api/v1/tree/{project_id}/write|mkdir|mv|rm` 写入端点
- [ ] 确保 .trash/ 在所有 scope 中默认 exclude

### Phase 2: 权限统一

**目标**: 删除 `connection_accesses`，统一到 Mut scope。

- [ ] 审计所有 `connection_accesses` 的使用点
- [ ] 将现有 access 记录迁移为 connections.config.scope 配置
- [ ] 所有 Agent 权限检查改用 `check_path_permission(scope, path, action)`
- [ ] 删除 `connection_accesses` 表
- [ ] 更新 Agent config UI（前端）

### Phase 3: 前端迁移

**目标**: 前端从 content_nodes API 切换到 Tree API。

- [ ] 路由从 UUID-based 改为 path-based
- [ ] `useContentNodes` → `useTreeDir`
- [ ] `usePathResolver` → path-based 解析（不查 PG）
- [ ] ExplorerSidebar 改为 lazy load（展开目录时调 ls）
- [ ] 编辑器 save → 调 Tree API write
- [ ] 创建/删除/移动/重命名 → 调 Tree API 对应端点

### Phase 4: Connector 迁移

**目标**: 所有 connector 从 content_nodes 迁移到 Mut 直接操作。

- [ ] Datasource connectors → MutWriteService.write_file()
- [ ] Filesystem sync → Mut protocol（或保留现有路径但不经过 content_nodes）
- [ ] Agent sandbox → mut clone / push
- [ ] MCP tools → MutTreeReader + MutWriteService

### Phase 5: 搜索索引迁移

**目标**: 搜索索引从 content_nodes.id 迁移到 (project_id, path)。

- [ ] 搜索 upsert 改用 (project_id, path) 做 key
- [ ] 搜索结果返回 path 而不是 node_id
- [ ] post-commit hook 替代 IndexSync 做搜索索引更新

### Phase 6: 清理

**目标**: 删除所有遗留代码和表。

- [ ] 删除 `content_nodes` 表（DB migration）
- [ ] 删除 `src/content/` 整个模块（repository / service / models / router）
- [ ] 删除 `src/mut_engine/index_sync.py`
- [ ] 删除 `src/mut_engine/compat_service.py`
- [ ] 删除 `/api/v1/nodes` 所有端点
- [ ] 删除 `/api/v1/collab` 端点（版本历史 / diff / rollback 改为 Tree API 下）
- [ ] 清理 `bookmarks` 表的 migration（如果需要）
- [ ] 更新 AGENTS.md 和 API 文档

---

## 12. 关键设计决策汇总

| 决策 | 选择 | 原因 |
|------|------|------|
| content_nodes | **删除** | Mut tree 是唯一 SOT，PG 不应持有内容节点 |
| connection_accesses | **删除** | 统一到 Mut scope，path-based 权限更自然 |
| 文件 identity | **path** (不是 UUID) | 文件系统用 path 做 identity 是正确语义 |
| 空目录 | **.keep sentinel** | 跟 Git 一样，Mut tree 不表达空目录 |
| 软删除 | **.trash/ in Mut tree** | 不依赖 PG，有完整版本历史 |
| 少量稳定 handle | **bookmarks 表（按需）** | 只给被外部引用的对象建 UUID |
| 搜索索引 key | **(project_id, path)** | 不需要 UUID |
| 前端路由 | **path-based** | 直接反映文件系统路径 |
| 加速缓存 | **不预建** | 先证明有性能瓶颈再加 |
| IndexSync | **删除** | 不再需要 Mut → PG 同步 |
