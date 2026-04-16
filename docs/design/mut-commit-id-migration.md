# MUT: 从 `version: int` 迁移到 `commit_id: hash`

**Date:** 2026-04-17
**Status:** 🟢 Implementing — 决策已冻结
**Scope:** mut library + PuppyOne backend + frontend + CLI + DB + docs

---

## 0. 最终决策冻结（2026-04-17）

> 以下决策覆盖本文后续所有"方案 A/B/讨论"段落，以本节为准。

**commit_id 设计**
- 长度：**16 hex chars（64 bits）** — SHA256 截断前 16 字符
- Payload：`scope_path | scope_hash | created_at_iso | who`（pipe 分隔）
- **不包含** `parent_commit_id` — 当前线性历史靠 `created_at` 排序即可
- **不包含** `message` — 同一 agent 同一秒改同一 scope 到同一内容，message 不同是边缘场景，不值得复杂化

```python
import hashlib

def compute_commit_id(scope_path, scope_hash, created_at_iso, who) -> str:
    payload = "|".join([scope_path or "", scope_hash or "", created_at_iso, who or ""])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
```

**数据模型**
- `mut_commits`：**新增** `commit_id TEXT NOT NULL`；**删除** `version`, `scope_version`
- `mut_scope_state`：**新增** `head_commit_id TEXT`；**删除** `version`
- `projects`：**删除** `mut_version`；**保留** `mut_root_hash`；**不添加** `mut_head_commit_id`
- 不添加 `parent_commit_id` 字段（未来做 DAG 时再加）

**RPC**
- **删除** `atomic_next_version(p_project_id TEXT)` 以及所有 UUID overload
- **保留** `cas_update_scope_state` / `cas_update_root_hash`（本来就是 hash-based）

**客户端 snapshot**
- 本地 snapshot ID 保持 `int`（local cursor 含义不变）
- 新增字段 `server_commit_id: str`，push 成功后填充
- `REMOTE_HEAD` 文件存 `commit_id` 字符串（而非 `int`）

**UI/CLI 显示**
- 前端：`#abc12345` 前 8 位 hex + hover 显示完整 16 位
- CLI：`(#abc12345)`

**迁移策略**
- 既往不咎 — 不做历史数据迁移，用户量小，直接一步到位
- 清空 `mut_commits` / `mut_scope_state` / `projects.mut_version`
- 不升 `PROTOCOL_VERSION`（字段重命名，协议版本号不变）

---

## 1. 背景与目标

### 1.1 动机

当前 MUT 使用**全局递增整数** (`projects.mut_version`, `mut_commits.version`, `mut_scope_state.version`) 作为 commit 的身份 ID。这在中心化、严格线性的场景下能工作，但存在几个根本性问题：

1. **无法支持分叉/并行分支** — 无论是短暂分叉（用户本地有多条未推送的分支）还是未来的 DAG，整数 ID 都无法表达。
2. **非 idempotent push** — 客户端重试会得到新 version（v20 → v21），即使内容完全相同。
3. **ID 不能离线生成** — 客户端必须等服务器分配 version，无法在 offline 场景提前生成稳定的 commit ID。
4. **`atomic_next_version` 是一个热点** — 每次 push 都要 DB round-trip 更新 `projects.mut_version`。

### 1.2 目标（用户指令明确）

> "我觉得随着我们走到未来，一定要允许用户有短暂分叉的权利。因此，变成 Hash 是一个必然的选择。"
> "我们现在依旧是要保证线性提交的这种模式。只是一个序号的改变，但并不改变我们产品的整体逻辑，我们只是为后续的升级留出空间而已。"

**本次改动**：
- ✅ 把 commit 的身份 ID 从 `version: int` 换成 `commit_id: hash (str)`
- ✅ 保持**产品逻辑不变** — 仍强制线性提交（fast-forward-only，通过 CAS on head）
- ✅ 为未来 DAG/短暂分叉**留足空间**（parent_commit_id 字段已就位）
- ❌ **不** 引入 DAG 的 merge commit 语义
- ❌ **不** 放松 server 端的 fast-forward 约束

### 1.3 非目标

- 不是要立即支持 git-like 的分支/merge
- 不做历史数据迁移（用户明确说："用户量不多，可以直接一步到位，不考虑迁移成本")
- 不改 MUT protocol version 号（仍为 1，但字段重命名）

---

## 2. 核心设计

### 2.1 commit_id 哈希算法

```python
import hashlib

def compute_commit_id(
    parent_commit_id: str,  # "" for the first commit
    scope_hash: str,        # Merkle tree root of this scope after the commit
    scope_path: str,        # canonical scope path ("" for root)
    who: str,
    message: str,
    created_at_iso: str,    # ISO 8601 UTC
) -> str:
    payload = "\n".join([
        parent_commit_id or "",
        scope_hash or "",
        scope_path or "",
        who or "",
        message or "",
        created_at_iso,
    ]).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:16]
```

**设计决策**：
- **16 hex chars (64 bits)** — 碰撞概率 ~1 / 10^19 per scope，足够安全
- **包含 parent_commit_id** — 形成 hash chain，天然抗篡改
- **包含 who/message/created_at** — 即使内容（scope_hash）相同的重复 commit 也有唯一 ID
- **不含 scope_hash 子节点** — 因为 scope_hash 本身已经是 Merkle root，已递归包含整个子树
- **sha256 截断而非 sha1** — 满足行业 hash 迁移趋势（Git 也在迁移到 sha256）

### 2.2 Commit chain 数据模型

```
projects
├── mut_head_commit_id TEXT    -- 全局 HEAD（最新 commit 的 id）
└── mut_root_hash      TEXT    -- 保留，全局 Merkle root（独立于 commit_id）

mut_commits
├── commit_id        TEXT NOT NULL  -- 主身份
├── parent_commit_id TEXT           -- 父 commit（空 = 第一个 commit）
├── project_id       TEXT
├── scope_path       TEXT
├── scope_hash       TEXT           -- 保留（内容指纹，用于 CAS + 解 dup）
├── root_hash        TEXT           -- 保留（grafting 后的全局 root）
├── who / message / changes / conflicts / created_at  (不变)
└── UNIQUE(project_id, commit_id)

mut_scope_state
├── project_id       TEXT
├── scope_path       TEXT
├── head_commit_id   TEXT           -- 该 scope 的 HEAD
└── scope_hash       TEXT           -- 保留（CAS 用）
```

**删除的字段**（一步到位）：
- `projects.mut_version`
- `mut_commits.version`
- `mut_commits.scope_version`（"docs/3" 这种人造 ID，不需要了）
- `mut_scope_state.version`

**RPC 变化**：
- ❌ 删除 `atomic_next_version(project_id)` — 不再需要序列号
- ✅ 保留 `cas_update_scope_state(project_id, scope_path, old_hash, new_hash)` — 继续用 scope_hash 做 CAS
- ✅ 保留 `cas_update_root_hash(project_id, old_hash, new_hash)` — 继续用 root_hash 做 graft CAS
- 🆕 新增（可选） `cas_update_scope_head(project_id, scope_path, old_commit_id, new_commit_id)` — 如果需要 head CAS

### 2.3 线性约束如何保证

用户要求：**保持线性提交**。

实现机制：
1. 客户端 push 时必须带 `base_commit_id`（= 客户端最后看到的 server HEAD）
2. Server 用 CAS 约束：`UPDATE mut_scope_state SET head_commit_id = new WHERE head_commit_id = base_commit_id`
3. CAS 失败 → 说明有人先 push 了 → 服务端做 3-way merge（已有逻辑）→ 重新 CAS
4. 这等价于 Git 的 "force fast-forward only"，但是服务端自动 merge（不像 Git 会拒绝）

**未来开关 DAG**：只需要放松 step 4 的 "merge 后必须 CAS 成功" 约束，允许 `parent_commit_id ≠ head_commit_id` 的 commit 存在（变成 merge commit）。当前这个字段已经存在，只是永远 == head。

---

## 3. 全面清单：所有需要改的地方

> **约定**：每一项都标出**文件路径**、**当前行为**、**目标行为**、**风险**。

### 3.1 DB Schema （1 个新 migration）

**新 migration**: `supabase/migrations/20260418000000_mut_commit_hash_identity.sql`

```sql
BEGIN;

-- Part 1: 加新字段
ALTER TABLE mut_commits
    ADD COLUMN IF NOT EXISTS commit_id TEXT,
    ADD COLUMN IF NOT EXISTS parent_commit_id TEXT;

ALTER TABLE mut_scope_state
    ADD COLUMN IF NOT EXISTS head_commit_id TEXT;

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS mut_head_commit_id TEXT;

-- Part 2: 回填（既然用户说不管数据迁移，填个占位即可）
-- 方案 A: 保留老数据，commit_id 回填为 scope_hash（简化处理）
UPDATE mut_commits
    SET commit_id = scope_hash
    WHERE commit_id IS NULL AND scope_hash IS NOT NULL;
-- 方案 B: 直接清空（用户说没历史数据价值，也可以）
-- TRUNCATE mut_commits, mut_scope_state CASCADE;

-- Part 3: 约束
ALTER TABLE mut_commits
    ALTER COLUMN commit_id SET NOT NULL;

ALTER TABLE mut_commits
    ADD CONSTRAINT uq_mut_commits_commit_id UNIQUE(project_id, commit_id);

CREATE INDEX IF NOT EXISTS idx_mut_commits_commit_id
    ON mut_commits (project_id, commit_id);
CREATE INDEX IF NOT EXISTS idx_mut_commits_parent
    ON mut_commits (project_id, parent_commit_id);
CREATE INDEX IF NOT EXISTS idx_mut_commits_scope_created
    ON mut_commits (project_id, scope_path, created_at DESC);

-- Part 4: 删除旧字段 & RPC
DROP INDEX IF EXISTS idx_mut_commits_project_version;
ALTER TABLE mut_commits DROP CONSTRAINT IF EXISTS mut_commits_project_id_version_key;
ALTER TABLE mut_commits DROP COLUMN IF EXISTS version;
ALTER TABLE mut_commits DROP COLUMN IF EXISTS scope_version;

ALTER TABLE mut_scope_state DROP COLUMN IF EXISTS version;

ALTER TABLE projects DROP COLUMN IF EXISTS mut_version;

DROP FUNCTION IF EXISTS atomic_next_version(TEXT);
DROP FUNCTION IF EXISTS atomic_next_version(UUID);  -- 防御性

COMMIT;
```

**影响的现有 migration 要点**：
- `20260319100000_mut_native_drop_content_nodes.sql` — 创建 mut_commits 的地方，version 字段被 drop 掉
- `20260322000000_mut_scope_versioning.sql` — 加 scope_hash/scope_version，scope_version 被 drop
- `20260415000000_mut_cas_rpc_functions.sql` + fix — atomic_next_version 被 drop
- `20260416100000_scope_path_canonical.sql` — 无影响（只处理 scope_path，不碰 version）

---

### 3.2 mut 库（upstream, `/Users/puppyoneai/Desktop/mut/`）

这是**最大的改动**，~15 个文件，因为 mut 的核心假设是"version 是整数序列"。

#### 3.2.1 Protocol 层 — `mut/core/protocol.py`

| 字段 | Before | After |
|---|---|---|
| `PushRequest.base_version: int` | `= 0` | `PushRequest.base_commit_id: str = ""` |
| `PushResponse.version: int` | | `PushResponse.commit_id: str = ""` |
| `PullRequest.since_version: int` | | `PullRequest.since_commit_id: str = ""` |
| `PullResponse.version: int` | | `PullResponse.head_commit_id: str = ""` |
| `CloneResponse.version: int` | | `CloneResponse.head_commit_id: str = ""` |
| `PullVersionRequest.version: int` | | `PullCommitRequest.commit_id: str = ""` |
| `RollbackRequest.target_version: int` | | `RollbackRequest.target_commit_id: str = ""` |
| `RollbackResponse.new_version: int` | | `RollbackResponse.new_commit_id: str = ""` |
| `RollbackResponse.target_version: int` | | `RollbackResponse.target_commit_id: str = ""` |

**动作**: 直接 rename 字段（不保留旧字段）。

#### 3.2.2 HistoryBackend 接口 — `mut/server/history.py`

**重写 HistoryBackend 抽象接口**：

```python
class HistoryBackend(abc.ABC):
    @abc.abstractmethod
    def get_head_commit_id(self) -> str: ...

    @abc.abstractmethod
    def set_head_commit_id(self, cid: str) -> None: ...

    @abc.abstractmethod
    def record(self, entry: dict) -> None:
        """entry MUST contain 'commit_id' and 'parent_commit_id' keys."""

    @abc.abstractmethod
    def get_entry(self, commit_id: str) -> dict | None: ...

    @abc.abstractmethod
    def get_since(
        self,
        since_commit_id: str,
        scope_path: str | None = None,
        limit: int = 0,
    ) -> list[dict]:
        """Return commits strictly after `since_commit_id` in the linear chain.
        When `since_commit_id` is empty, return all commits from the root."""

    # Per-scope
    def get_scope_head_commit_id(self, _scope_path: str) -> str:
        return ""

    def set_scope_head_commit_id(self, _scope_path: str, _cid: str) -> None:
        ...

    def get_scope_hash(self, _scope_path: str) -> str:
        return ""

    def set_scope_hash(self, _scope_path: str, _h: str) -> None:
        ...
```

**FileSystemHistoryBackend 重写**：
- 文件命名：`commits/{commit_id}.json`（不再 `{version:06d}.json`）
- `latest` 文件存 `head_commit_id`（str 不是 int）
- `scope_state/{scope_key}.json` 里面的 `version` 字段改 `head_commit_id`

**HistoryManager 变化**：
- 删除 `make_scope_version_id(scope, scope_version)` → 换成 `make_human_label(commit_id)` 返回 `#abc12345`
- `migrate_scope` 改成遍历 commit chain（跟随 parent_commit_id）

#### 3.2.3 ServerRepo — `mut/server/repo.py`

```python
class ServerRepo:
    # 删除:
    # def next_global_version(self) -> int
    # self._version_counter: int | None

    # 新增:
    def get_head_commit_id(self) -> str:
        return self.history.get_head_commit_id()

    def set_head_commit_id(self, cid: str):
        self.history.set_head_commit_id(cid)

    # record_history 签名变化:
    def record_history(
        self,
        commit_id: str,
        parent_commit_id: str,
        who: str,
        message: str,
        scope_path: str,
        changes: list,
        conflicts: list | None = None,
        scope_hash: str = "",
        root_hash: str = "",
    ) -> None:
        ...

    # get_history_since / get_history_entry 参数改 commit_id
```

#### 3.2.4 Handlers — `mut/server/handlers.py`

**handle_push**:
```python
def _push_cas_attempt(...):
    old_scope_hash = repo.get_scope_hash(scope["path"])
    our_files = repo.list_scope_files(scope)
    current_head_commit = repo.get_head_commit_id()   # NEW

    merged_files, merge_conflicts = _resolve_conflicts(
        repo, scope, req.base_commit_id, current_head_commit,  # use commit_id
        our_files, their_files,
    )
    ...
    new_scope_hash = repo.build_scope_tree(scope)

    # CAS on scope_hash (unchanged)
    if not repo.cas_update_scope(scope["path"], old_scope_hash, new_scope_hash):
        return None

    # Compute commit_id (NEW)
    parent = repo.get_head_commit_id() or ""
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    new_commit_id = compute_commit_id(
        parent, new_scope_hash, scope["path"], auth["agent"],
        req.snapshots[-1].get("message", ""), created_at,
    )

    repo.record_history(
        new_commit_id, parent, auth["agent"], ...,
    )
    repo.set_head_commit_id(new_commit_id)
    repo.set_scope_head_commit_id(scope["path"], new_commit_id)

    return PushResponse(status="ok", commit_id=new_commit_id, ...).to_dict()
```

**handle_pull / handle_rollback / handle_pull_version**：类似改造，用 commit_id 替换 version。

**_get_base_files(repo, scope, base_commit_id)**: 用 commit_id lookup entry（已有 get_entry 接口）。

#### 3.2.5 Client-side ops — `mut/ops/`

**`push_op.py`**:
```python
remote_head_path = repo.mut_root / REMOTE_HEAD_FILE
base_commit_id = read_text(remote_head_path) if remote_head_path.exists() else ""

resp = client.push(base_commit_id, snap_data, objects)

server_commit_id = resp.get("commit_id", base_commit_id)
# watermark 逻辑不变（仍用本地 snapshot id）
# 但 REMOTE_HEAD 现在存 commit_id (string)
write_text(remote_head_path, server_commit_id)
```

**`pull_op.py`**: 同样，`since_commit_id` 从 REMOTE_HEAD 读 string。

**`rollback_op.py`**: 参数 `target_commit_id: str`。

**`clone_op.py`**: `write_text(mut / REMOTE_HEAD_FILE, head_commit_id)` (string 而非 str(int))。

**`link_access_op.py`**: `server_commit_id = clone_resp.get("head_commit_id", "")`。

#### 3.2.6 Snapshot 本地 bookkeeping — `mut/core/snapshot.py`

**关键决策**：客户端 snapshot 自己的 ID 怎么办？

选项：
- **(A) 保留本地 int ID**：`snapshots/{id:06d}.json` 不变；只是 `REMOTE_HEAD` 存 commit_id 字符串。本地 watermark `pushed` 仍是 int，表示 "本地 snap id ≤ watermark 已推送"。
- **(B) 本地也用 commit_id**：每个 snapshot 文件命名 `snapshots/{commit_id}.json`。

**建议 (A)**：
- 本地 snapshot 是"uncommitted draft"，是本地暂存。push 后 snapshot 被"关联"到服务器 commit_id。
- 最小改动。
- Snapshot 的 `id: int` 是**本地游标**，`server_commit_id: str` 是**服务器身份**。
- 每个 snapshot 文件存一个新字段：`server_commit_id: str` — push 成功后填充。

```python
def create(self, root_hash: str, who: str, message: str, pushed: bool = False):
    ...
    snap = {
        "id": latest_id + 1,           # 本地游标
        "root": root_hash,
        "parent_local": latest_id if latest_id > 0 else None,  # 本地父
        "server_commit_id": "",         # push 成功后填充
        ...
    }
```

#### 3.2.7 Tests — `mut/tests/`

影响的 test files：
- `test_handlers.py`（全部 push/pull/rollback 测试）
- `test_protocol.py`
- `test_v4_features.py`
- `test_scope_migration.py` — scope_version 概念删除
- `test_rollback.py`
- `test_integration_v4.py`
- `test_notification.py`
- `test_async_server.py`
- `test_stress_concurrent.py`
- `test_enhanced_cli.py`

**动作**：每个 test 里的 `version=N` 改成 `commit_id="<hash>"`，用固定 hash 或者先 push 记录结果用。

---

### 3.3 PuppyOne 后端（`backend/src/mut_engine/`）

#### 3.3.1 Schemas — `backend/src/mut_engine/schemas.py`

| 字段 | Before | After |
|---|---|---|
| `WriteFileRequest.base_version: int` | | `base_commit_id: str = ""` |
| `ListDirResponse.version: int` | | `head_commit_id: str = ""` |
| `ReadFileResponse.version: int` | | `head_commit_id: str = ""` |
| `TreeResponse.version: int` | | `head_commit_id: str = ""` |
| `FileVersionInfo.version: int` | | `commit_id: str = ""` |
| `FileVersionInfo` | 加 `parent_commit_id: str = ""` | |
| `VersionHistoryResponse.current_version: int` | | `head_commit_id: str = ""` |
| `RollbackResponse.new_version: int` | | `new_commit_id: str = ""` |
| `RollbackResponse.rolled_back_to: int` | | `rolled_back_to_commit_id: str = ""` |
| `DiffResponse.v1: int, v2: int` | | `c1: str, c2: str` (commit ids) |
| `RollbackRequest.target_version: int` | | `target_commit_id: str = ""` |
| `MutCommitInfo.version: int` | | `commit_id: str = ""` |
| `MutCommitInfo` | 加 `parent_commit_id: str = ""` | |
| `MutProjectHistoryResponse.current_version: int` | | `head_commit_id: str = ""` |

**连带 rename**：
- 类名 `FileVersionInfo` → `CommitInfo`
- 类名 `VersionHistoryResponse` → `CommitHistoryResponse`

#### 3.3.2 SupabaseHistoryManager — `backend/src/mut_engine/server/backends/supabase_history.py`

**重写所有方法**（~300 行代码）：

```python
class SupabaseHistoryManager:
    # 删除:
    # def get_latest_version() -> int
    # def set_latest_version(int)
    # def get_scope_version(scope_path)
    # def set_scope_version(scope_path, int)
    # def atomic_next_version() -> int

    # 新增 / 改动:
    def get_head_commit_id(self) -> str:
        resp = (self._client.table("projects")
            .select("mut_head_commit_id").eq("id", self._project_id)
            .maybe_single().execute())
        data = _safe_data(resp)
        return data.get("mut_head_commit_id", "") if data else ""

    def set_head_commit_id(self, cid: str) -> None:
        self._client.table("projects").update(
            {"mut_head_commit_id": cid}
        ).eq("id", self._project_id).execute()

    def get_scope_head_commit_id(self, scope_path: str) -> str:
        scope_path = _normalize(scope_path)
        resp = (self._client.table(self.SCOPE_STATE_TABLE)
            .select("head_commit_id").eq("project_id", self._project_id)
            .eq("scope_path", scope_path).maybe_single().execute())
        data = _safe_data(resp)
        return data.get("head_commit_id", "") if data else ""

    # record: 签名改
    def record(
        self, commit_id: str, parent_commit_id: str,
        who: str, message: str, scope_path: str, changes: list,
        conflicts: list | None = None,
        root_hash: str = "", scope_hash: str = "",
    ) -> None:
        ...
        data = {
            "project_id": self._project_id,
            "commit_id": commit_id,
            "parent_commit_id": parent_commit_id,
            "scope_path": scope_path,
            "scope_hash": scope_hash,
            "root_hash": root_hash,
            "who": who,
            "message": message,
            "changes": json.dumps(changes),
            ...
        }
        self._client.table(self.TABLE).insert(data).execute()

    # get_since: 按 chain 遍历（也可以简单按 created_at > since_commit.created_at 排序）
    def get_since(
        self, since_commit_id: str,
        scope_path: str | None = None, limit: int = 0,
    ) -> list[dict]:
        # 实现：
        # 1. 如果 since_commit_id == "" → 全部
        # 2. 否则 → 先查 since_commit 的 created_at
        # 3. WHERE created_at > since_created_at ORDER BY created_at ASC
        if not since_commit_id:
            since_time = None
        else:
            entry = self.get_entry(since_commit_id)
            if entry is None:
                return []
            since_time = entry["created_at"]

        query = (self._client.table(self.TABLE)
            .select("*").eq("project_id", self._project_id)
            .order("created_at", desc=False))
        if since_time:
            query = query.gt("created_at", since_time)
        if scope_path:
            query = query.eq("scope_path", _normalize(scope_path))
        if limit > 0:
            query = query.limit(limit)
        resp = query.execute()
        entries = _safe_data(resp) or []
        for entry in entries:
            _parse_json_fields(entry)
        return entries

    def get_entry(self, commit_id: str) -> dict | None:
        resp = (self._client.table(self.TABLE)
            .select("*").eq("project_id", self._project_id)
            .eq("commit_id", commit_id).limit(1).execute())
        ...

    def get_previous_scope_commit(
        self, scope_path: str, before_commit_id: str,
    ) -> dict | None:
        """替代 get_previous_scope_hash — 返回 scope 的前一个 commit 条目。"""
        before_entry = self.get_entry(before_commit_id)
        if not before_entry:
            return None
        before_time = before_entry["created_at"]
        resp = (self._client.table(self.TABLE)
            .select("*").eq("project_id", self._project_id)
            .eq("scope_path", _normalize(scope_path))
            .lt("created_at", before_time)
            .order("created_at", desc=True)
            .limit(1).execute())
        rows = _safe_data(resp)
        return rows[0] if rows else None

    # cas_update_scope_hash / cas_update_root_hash 保持不变（本来就是 hash-based）
```

#### 3.3.3 PuppyOneServerRepo — `backend/src/mut_engine/server/server_repo.py`

**方法 rename + 重新委托**：
- `get_latest_version` / `set_latest_version` / `next_global_version` → 全部删除
- 加 `get_head_commit_id` / `set_head_commit_id`
- `record_history` 签名改（参数 commit_id + parent_commit_id）
- `get_history_since(since_commit_id, ...)` 参数改

#### 3.3.4 Hooks — `backend/src/mut_engine/services/hooks.py`

```python
def run_post_push_hook(project_id, repo_manager, push_result):
    ...
    commit_id = push_result.get("commit_id") or push_result.get("new_commit_id")
    if not commit_id:
        return

    entry = repo.history.get_entry(commit_id)
    ...

def _update_global_root(repo, push_result):
    ...
    # 用 commit_id 查 entry
    entry = repo.history.get_entry(push_result["commit_id"])
    scope_path = (entry.get("scope_path") or "").strip("/")
    # get_previous_scope_hash → get_previous_scope_commit
    prev = repo.history.get_previous_scope_commit(scope_path, push_result["commit_id"])
    old_scope_hash = prev["scope_hash"] if prev else ""
    ...
```

#### 3.3.5 Ops — `backend/src/mut_engine/services/ops.py`

```python
@dataclass
class WriteResult:
    commit_id: str = ""          # 替换 version
    status: str = "ok"
    merged: bool = False
    conflicts: int = 0
    paths: list[str] = field(default_factory=list)

# _to_result:
@staticmethod
def _to_result(raw: dict, paths: list[str] | None = None) -> WriteResult:
    return WriteResult(
        commit_id=raw.get("commit_id", ""),
        status=raw.get("status", "ok"),
        merged=raw.get("merged", False),
        conflicts=raw.get("conflicts", 0),
        paths=paths or [],
    )

# get_version → get_head_commit_id:
def get_head_commit_id(self, project_id: str) -> str:
    return self._reader.get_head_commit_id(project_id)
```

#### 3.3.6 Routers

**`routers/content_history.py`**:
- GET `/{project_id}/versions?since_commit_id=<hash>&limit=50` (rename param)
- GET `/{project_id}/version-content?path=...&commit_id=<hash>` (rename param)
- GET `/{project_id}/diff?c1=<hash>&c2=<hash>` (rename params)
- POST `/{project_id}/rollback` body `{target_commit_id: "<hash>"}`

**命名决策**：
- 路径本身保留 `/versions` 不改（对外稳定 URL）
- 参数/body 字段全换成 commit_id

**`routers/content_write.py`**:
- 返回体：`{"commit_id": "<hash>", "path": "...", ...}` (而非 `{"version": N, ...}`)

**`routers/protocol_router.py`**:
- 无需改（透传 handle_push 等），但日志里的 `v={result.get('version')}` 改 `c={result.get('commit_id')}`

#### 3.3.7 MutTreeReader — `backend/src/mut_engine/services/tree_reader.py`

- `get_version` → `get_head_commit_id`

#### 3.3.8 ARCHITECTURE.md

更新架构文档，把 "Version Number" 章节改成 "Commit Identity"，加 hash chain 图。

---

### 3.4 Frontend（`frontend/`）

#### 3.4.1 `frontend/lib/contentTreeApi.ts`

```ts
// Before:
export interface MutEntry {
  version: number;
  ...
}
export interface VersionInfo {
  version: number;
  ...
}
export interface VersionHistory {
  current_version: number;
  commits: VersionInfo[];
}
export interface RollbackResult {
  new_version: number;
}

// After:
export interface MutEntry {
  head_commit_id: string;
  ...
}
export interface CommitInfo {
  commit_id: string;
  parent_commit_id: string;
  ...
}
export interface CommitHistory {
  head_commit_id: string;
  commits: CommitInfo[];
}
export interface RollbackResult {
  new_commit_id: string;
}

// Rollback API call:
export async function rollbackToCommit(
  nodeId: string, commit_id: string, projectId: string,
) {
  return fetch(`.../${projectId}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ path: nodeId, target_commit_id: commit_id }),
  });
}
```

#### 3.4.2 `frontend/components/editors/VersionHistoryPanel.tsx`

```tsx
// Before:
<span>v{commit.version}</span>
onClick={() => onRollback(commit.version)}
isCurrent={commit.version === currentVersion}

// After:
<span>#{commit.commit_id.slice(0, 8)}</span>
onClick={() => onRollback(commit.commit_id)}
isCurrent={commit.commit_id === headCommitId}
```

显示格式建议：
- 列表上：`#abc12345` (前 8 位 hex)
- Hover tooltip：完整 16 位 hash + 时间

#### 3.4.3 `frontend/app/(main)/projects/[projectId]/history/page.tsx`

同样 `v{...}` → `#{commit_id.slice(0, 8)}`，所有 version 引用改 commit_id。

---

### 3.5 CLI（`cli/src/commands/data.js`）

```js
// Before:
out.info(`Written: ${result.path ?? cleanPath} (v${result.version})`);

// After:
const cid = result.commit_id?.slice(0, 8) ?? '?';
out.info(`Written: ${result.path ?? cleanPath} (#${cid})`);
```

9 处地方全部改（write/create/mkdir/cp/mv/rm/restore）。

---

### 3.6 Docs

- `docs/design/mut-scope-concurrency.md`
  - 加新章节 §6 "Commit Identity: Hash as ID"
  - 更新 CAS 流程图，把 "atomic_next_version" 去掉
  - 更新"附录：关键代码位置"

- `docs/design/mut-bug-checklist.md`
  - 加 entry `P0-7: Migrated commit identity from integer version to hash commit_id`

- `backend/src/mut_engine/ARCHITECTURE.md`
  - 更新数据模型图
  - 更新 API 契约章节

---

### 3.7 Tests（回归）

**Backend tests 需要改**：
- `backend/tests/mut_engine/test_server_repo.py`
- `backend/tests/mut_engine/test_bug_fixes.py`
- `backend/tests/mut_engine/test_access_point.py`
- `backend/tests/mut_engine/test_mut_integration.py`
- `backend/tests/mut_engine/test_multi_repo_stress.py`
- `backend/tests/sync/test_openclaw_e2e.py`

每个测试里对 `version: int` 的断言改成 `commit_id: str`。

**新增测试**：
- `test_commit_id_hash.py` — 验证 hash 算法 deterministic、相同输入产生相同 hash
- `test_commit_chain.py` — 验证 parent_commit_id 正确连接（链条完整性）
- `test_fast_forward_only.py` — 验证当 base_commit_id ≠ head 时 server 强制 3-way merge（保持线性）

---

## 4. 执行顺序（强烈建议的分阶段）

这不是一次性改得动的。建议按依赖方向分阶段：

### Stage 1: DB schema 迁移（1 次 PR）
- 新 migration: `20260418000000_mut_commit_hash_identity.sql`
- 上到测试 branch
- 验证所有现有 API 仍正常（因为 column 是增量添加 + 回填 commit_id 是 scope_hash）

### Stage 2: mut 库内部重构（1 次 PR on `/Users/puppyoneai/Desktop/mut`）
- Protocol 层字段重命名
- HistoryBackend 接口重写
- FileSystemHistoryBackend 跟进
- ServerRepo 重构
- handlers 重构（handle_push / pull / rollback）
- ops 重构（client-side）
- Snapshot bookkeeping 小改
- 所有 mut/tests 更新
- 上游 mut 通过自己的 CI

### Stage 3: PuppyOne backend 跟进（1 次 PR on puppyone）
- schemas.py 重命名
- SupabaseHistoryManager 重写
- PuppyOneServerRepo 跟进
- hooks.py 跟进
- ops.py 跟进
- routers 跟进
- ARCHITECTURE.md 更新
- mut_engine tests 更新

### Stage 4: Frontend + CLI（1 次 PR on puppyone）
- contentTreeApi.ts 类型改
- VersionHistoryPanel.tsx 展示改
- history page 展示改
- CLI data.js 展示改

### Stage 5: Docs（1 次 PR）
- mut-scope-concurrency.md 加章节
- mut-bug-checklist.md 加 entry
- 本文档归档（移到 completed/ 下，或删除）

### Stage 6: E2E 回归
- `mut init / clone / push / pull / rollback` 全部走一遍
- Frontend 的 history/rollback 全部走一遍
- Agent/sandbox 写入走一遍（因为 ops.py 也改了）
- CLI `puppyone data` 走一遍

---

## 5. 风险矩阵

| 风险 | 严重性 | 可能性 | 缓解措施 |
|---|---|---|---|
| mut 库改完后有未覆盖到的调用点 | 🔴 高 | 🟡 中 | 所有方法全部 rename（而非保留兼容），编译器/Pydantic 强制发现所有调用点 |
| 客户端 / 服务端版本不匹配（老 client 发 base_version, 新 server 读 base_commit_id） | 🔴 高 | 🟢 低 | 一并部署 mut lib + puppyone backend；升级 PROTOCOL_VERSION 1→2 让老 client 显式拒绝 |
| 本地 `.mut/REMOTE_HEAD` 里残留 int | 🟡 中 | 🟡 中 | 客户端读取时如果 parse 到 int → 认为是初始态，回落 commit_id = "" |
| 前端用 `commit.version` 的地方漏改 | 🟡 中 | 🟡 中 | TypeScript 编译器捕获（`Property 'version' does not exist`） |
| SQL UPDATE 回填 commit_id 碰到空数据 | 🟢 低 | 🟢 低 | UPDATE 有 WHERE 保护；就算失败也只影响展示 |
| `get_since` 用 created_at 排序有时间戳精度问题（同毫秒 commit） | 🟢 低 | 🟢 低 | 用 `(created_at, commit_id)` 复合排序，commit_id 做 tie-breaker |
| CI/CD 漏跑 smoke test | 🟢 低 | 🟢 低 | `validate-migrations.yml` 已有，新 migration 自动跑 |

---

## 6. 未来 DAG 扩展的兼容性（留给未来）

本次改动之后，DAG 升级只需要：

1. 放松 `handle_push` 的 CAS 约束：允许 `base_commit_id != current_head_commit_id` 的 push 走 "merge commit" 路径（创建一个 `parent_commit_id` 为 base 的 commit，commit message 标记为 merge）。
2. `mut_commits` 支持 `parent_commit_id` 是一个 list（改成 JSONB `parents: [cid1, cid2]`），或者新增 `merge_parent_commit_id` 字段。
3. 客户端 `mut branch` / `mut merge` 命令（`mut/ops/` 下新增）。
4. Frontend 展示 branch/merge graph。

**当前不做，但数据模型已就绪。**

---

## 7. 回滚计划

如果上线后出现重大问题：

1. **Backend 级回滚**：revert PR，同时把 `mut_head_commit_id` 清空（数据仍在 mut_commits 里，老接口靠 scope_hash 兜底）。
2. **DB 级回滚**：准备 `20260418000001_rollback_commit_id.sql`（测试 branch 上先跑过），它：
   - 重建 `mut_version / version` 字段
   - 回填（根据 created_at ASC 赋递增值）
   - 重建 `atomic_next_version` RPC
3. **前端 / CLI 回滚**：前一个版本即可。

回滚应该在 **1 小时** 内完成（因为改动都在可控的 migration + code 范围）。

---

## 8. 待确认事项（请用户 review）

### 8.1 hash 算法细节
- [ ] 16 hex chars 够吗？（碰撞概率 1/10^19 per scope，OK？）要不要上 Git-like 的 40 hex？
- [ ] commit_id 的 payload 里要不要加 `scope_hash_subtree_count` 或类似 disambiguator？

### 8.2 DB schema
- [ ] 直接 DROP `version` column 可以吗？还是先保留一段时间做 dual-write 保险？
- [ ] 现有 `mut_commits` 的 9 条记录（per E2E 测试）怎么处理？回填 commit_id = scope_hash？清空？

### 8.3 mut 库的改动策略
- [ ] 是不是只有 PuppyOne 在用这个 mut 库？如果是，可以大胆改；如果还有独立用户（CLI 本地模式用户），需要兼容。
- [ ] 改完 mut 库要不要升 PROTOCOL_VERSION = 2？老 client 连新 server 会 parse error。

### 8.4 API URL / 字段命名
- [ ] URL 路径 `/versions` 保留（对外稳定），body 字段用 `commit_id`，OK？
- [ ] 前端展示 `#abc12345` 形式 OK？还是要 `@abc12345` / `commit:abc12345`？

### 8.5 FS snapshot 本地 bookkeeping
- [ ] 选 (A) 保留本地 int ID + 加 server_commit_id 字段？还是 (B) 本地也完全 hash？

---

## 9. 总结

| 维度 | 数值 |
|---|---|
| 涉及文件（粗估） | mut: ~15, backend: ~15, frontend: ~5, CLI: 1, DB: 1 migration, tests: ~10, docs: 3 |
| 新代码行数 | ~1500 lines |
| 删除代码行数 | ~800 lines |
| 净新增 | ~700 lines |
| PR 数（建议） | 5 个（按 Stage 分） |
| 预计工时 | 3-5 天（一人，专注） |
| 用户看到的变化 | URL 不变；UI 里 `v20` → `#abc12345`；CLI 里 `(v20)` → `(#abc12345)` |

---

**请 review 后告诉我**：
1. Plan 是否遗漏了什么？
2. 如果没问题，从 Stage 1 开始执行还是直接跳到 Stage 2/3？
3. 8.1-8.5 的待确认事项要不要现在就决定？
