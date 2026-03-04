# Sandbox Architecture v2

## Overview

Agent sandbox 采用 **snapshot isolation + commit-time conflict resolution** 模型：
- Mount 时拍快照（记录每个文件的 version + hash）
- Agent 在隔离环境中工作，不受外部变更影响
- 每轮消息结束后做 diff，只回写变化的文件
- 冲突通过 CollaborationService 的已有机制处理

## Core Concepts

### Manifest

每次 mount 时生成，记录沙盒内文件的基准状态：

```python
@dataclass
class ManifestEntry:
    node_id: str
    node_type: str       # "json" | "markdown"
    hash: str            # sha256 of content at mount time
    version: int         # base_version for conflict detection
    json_path: str       # for sub-path JSON edits
    readonly: bool
    base_content: Any    # original content for 3-way merge
```

### SandboxRegistry

In-memory singleton mapping `chat_session_id → LiveSession`:

```python
@dataclass
class LiveSession:
    sandbox_session_id: str
    chat_session_id: str
    agent_id: str
    manifest: SandboxManifest
    created_at: float
    last_active: float
    readonly: bool = False
```

Location: `src/sandbox/registry.py`

### Sandbox Session Lifecycle

```
chat_session 创建
  │
  ├─ 第1条消息 → 创建沙盒 + 全量 mount + 生成 manifest
  │               注册到 SandboxRegistry
  │
  ├─ 第2-N条消息 → 复用沙盒（零传输）
  │                 每次消息重置 idle timer
  │                 每轮结束 → diff check → 仅变化文件回写
  │
  └─ 会话结束 → 最终 diff → write-back → 销毁
       触发条件（任一即可）：
       - 我方 idle 超时：4 分钟无消息（APScheduler 每 60s 检查）
       - E2B 平台超时：5 分钟（兜底）
```

### Data Flow

```
┌─ Mount ──────────────────────────────────────────┐
│ 1. prepare_sandbox_data() → files                │
│ 2. build_manifest(files, node_path_map) → manifest│
│ 3. sandbox.start_with_files(files)               │
│ 4. registry.register(session_id, sandbox_id, manifest)│
└──────────────────────────────────────────────────┘

┌─ Execute (per message) ──────────────────────────┐
│ 5. registry.get(session_id) → reuse sandbox      │
│ 6. Claude ↔ bash tool_use（多轮）                 │
│    沙盒内文件可被读写，与外部隔离                    │
└──────────────────────────────────────────────────┘

┌─ Commit (per message) ───────────────────────────┐
│ 7. sandbox.exec("find + sha256sum") → new_hashes │
│ 8. diff(manifest.hashes, new_hashes)             │
│    - unchanged → skip                            │
│    - modified  → read_file + commit(base_version)│
│    - new file  → read_file + create_node         │
│    - deleted   → skip                            │
│ 9. CollaborationService.commit() handles:        │
│    - version check                               │
│    - conflict detection (base_version vs current)│
│    - 3-way merge or reject                       │
│10. registry.touch(session_id) — keep alive       │
└──────────────────────────────────────────────────┘

┌─ Cleanup (idle timeout / session end) ───────────┐
│11. APScheduler reaper detects idle > 4min        │
│12. Final diff_and_writeback()                    │
│13. sandbox.stop()                                │
│14. registry.remove(session_id)                   │
└──────────────────────────────────────────────────┘
```

## Backend Selection

Sandbox backend is determined **globally per deployment** via the `SANDBOX_TYPE` environment variable:

| `SANDBOX_TYPE` | Behavior |
|----------------|----------|
| `docker` | Always use local Docker |
| `e2b` | Always use E2B cloud (requires `E2B_API_KEY`) |
| `auto` (default) | If `E2B_API_KEY` is set → E2B, otherwise → Docker |

One deployment instance = one sandbox backend. There is no per-endpoint backend selection.

## File Structure

```
src/sandbox/
├── service.py          # SandboxService (E2B/Docker abstraction)
├── registry.py         # SandboxRegistry + build_manifest() + diff_and_writeback()
├── dependencies.py     # get_sandbox_service() singleton
├── e2b_impl.py         # E2B implementation
├── docker_impl.py      # Docker implementation
└── base.py             # Abstract base class

src/scheduler/jobs/
└── sandbox_reaper.py   # APScheduler job: reap idle sandboxes (every 60s)
```

## Conflict Resolution

Delegated entirely to `CollaborationService.commit()`:

- `base_version` matches current → clean write
- `base_version` < current → conflict detected → strategy applies
  - `auto_merge`: 3-way merge if possible
  - `last_write_wins`: overwrite
  - `reject`: return error to user

No real-time sync needed. Sandbox = isolated snapshot.

## Deprecated Modules

| Module | Status |
|--------|--------|
| `workspace/provider.py` | Deprecated |
| `workspace/apfs_provider.py` | Deprecated |
| `workspace/fallback_provider.py` | Deprecated |
| `sync/sync_worker.py` | Deprecated (sandbox use removed) |
| `sync/cache_manager.py` | Deprecated |
