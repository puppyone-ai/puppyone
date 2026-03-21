# PuppyOne 架构迁移计划

> **目标：** 将 `backend/src/` 从"30 个模块平铺"重构为"分层架构"
>
> **原则：** 每个 Phase 独立可测试、可回滚。先修 bug，再移文件，最后清理。

---

## 影响范围统计

每个模块被外部引用的文件数（决定迁移成本）：

| 模块 | 被引用文件数 | 迁移风险 |
|------|------------|---------|
| `auth/` | ~40 | **极高** — 几乎每个 router 都引用 |
| `supabase/` | ~80 | **极高** — 几乎每个 repo 都引用 |
| `content_node/` | ~45 | **高** |
| `s3/` | ~34 | **高** |
| `collaboration/` | ~23 | **中** |
| `mut_core/` | ~21 | **中** |
| `connectors/agent/` | ~21 | **中** |
| `upload/` | ~31 (多为内部) | **中** |
| `sandbox/` | ~11 | **低** |
| `mcp/` | ~12 | **低** |
| `db_connector/` | ~8 | **低** |
| `llm/` | ~8 | **低** |

---

## Phase 0: 修复写入泄漏（不改目录结构）

> **风险：低 | 工作量：1 天 | 影响文件：4-5 个**
>
> 先封堵写入泄漏，保证 Mut tree 完整性。不涉及目录变更。

### 0.1 删除 `_track_version` 死代码

- [ ] `content_node/service.py` — 删除 `create_file_node()` 中对 `self._track_version()` 的调用（方法不存在，会 AttributeError）

### 0.2 种子内容走 Mut

- [ ] `project/seed_content.py` — `create_folder("Guides")` 改为 `collab.commit(NODE_CREATE, type=folder)`
- [ ] `profile/service.py` — `create_folder("Tool_Configs")` 改为 `collab.commit(NODE_CREATE, type=folder)`

### 0.3 修复 rollback event loop

- [ ] `mut_core/compat_service.py` — rollback 方法中的 `loop.run_until_complete()` 改为 `await`

---

## Phase 1: 消除 `collaboration/` 空壳 → 合并进 `mut_core/`

> **风险：中 | 工作量：1 天 | 影响文件：~25 个**
>
> `collaboration/service.py` 只有 1 行 re-export。把有用文件合并到 `mut_core/`，
> 统一成一个模块，消除不必要的间接层。

### 移动清单

| 当前位置 | 目标位置 | 说明 |
|---------|---------|------|
| `collaboration/service.py` | **删除** | 只有 1 行 re-export |
| `collaboration/__init__.py` | **删除** | 模块说明 |
| `collaboration/schemas.py` | `mut_core/schemas.py` | 合并 Mutation/CommitResult 等类型 |
| `collaboration/dependencies.py` | `mut_core/dependencies.py` | 合并 DI 函数 |
| `collaboration/router.py` | `mut_core/collab_router.py` | 版本/diff/rollback REST API |
| `collaboration/audit_repository.py` | `mut_core/audit_repository.py` | 审计日志读取 |
| `collaboration/audit_router.py` | `mut_core/audit_router.py` | 审计日志 API |

### 需要更新 import 的文件（~25 个）

所有 `from src.collaboration` 的引用改为 `from src.mut_core`：

- `main.py` (3 处)
- `content_node/router.py` (3 处)
- `internal/router.py` (3 处)
- `upload/router.py` (4 处)
- `upload/file/jobs/jobs.py` (2 处)
- `connectors/datasource/router.py` (4 处)
- `connectors/datasource/engine.py` (2 处)
- `connectors/datasource/service.py` (2 处)
- `connectors/datasource/dependencies.py` (4 处)
- `connectors/filesystem/service.py` (2 处)
- `connectors/filesystem/watcher.py` (2 处)
- `connectors/filesystem/folder_access.py` (2 处)
- `connectors/agent/service.py` (4 处)
- `sandbox/registry.py` (5 处)
- `db_connector/service.py` (2 处)
- `db_connector/jobs.py` (2 处)
- `workspace/router.py` (2 处)
- `project/seed_content.py` (2 处)
- `profile/service.py` (2 处)
- `scheduler/jobs/sandbox_reaper.py` (1 处)
- `mut_core/compat_service.py` (1 处)
- tests: `test_openclaw_e2e.py`, `test_internal_posix_router.py`, `test_content_node_service_posix.py`

### 验证

```bash
# 确保没有残留引用
rg "from src\.collaboration" backend/
# 运行测试
uv run pytest -m "not e2e"
```

---

## Phase 2: 整理 `mcp/` 和 `sandbox/` 混装问题

> **风险：低 | 工作量：0.5 天 | 影响文件：~15 个**
>
> `mcp/` 和 `sandbox/` 各混装了两种不相关的功能。拆分清楚。

### 2.1 创建 `endpoints/` 目录，移出 endpoint CRUD

| 当前位置 | 目标位置 | 说明 |
|---------|---------|------|
| `mcp/endpoint_router.py` | `endpoints/mcp/router.py` | MCP endpoint CRUD |
| `mcp/endpoint_service.py` | `endpoints/mcp/service.py` | |
| `mcp/endpoint_repository.py` | `endpoints/mcp/repository.py` | |
| `mcp/endpoint_schemas.py` | `endpoints/mcp/schemas.py` | |
| `mcp/endpoint_dependencies.py` | `endpoints/mcp/dependencies.py` | |
| `sandbox/endpoint_router.py` | `endpoints/sandbox/router.py` | Sandbox endpoint CRUD |
| `sandbox/endpoint_service.py` | `endpoints/sandbox/service.py` | |
| `sandbox/endpoint_repository.py` | `endpoints/sandbox/repository.py` | |
| `sandbox/endpoint_schemas.py` | `endpoints/sandbox/schemas.py` | |
| `sandbox/endpoint_dependencies.py` | `endpoints/sandbox/dependencies.py` | |

### 需要更新 import 的文件

- `main.py` — `mcp_endpoint_router`, `sandbox_endpoint_router` 导入路径
- `mcp/endpoint_service.py` 内部互引
- `sandbox/endpoint_service.py` 内部互引
- `sandbox/endpoint_router.py` 内部互引
- `connectors/manager/router.py` — 引用了 endpoint service
- `internal/router.py` — 可能引用

### 2.2 `mcp/` 剩余文件 — legacy 健康检查，保持不动

`mcp/{service.py, repository.py, models.py, schemas.py, dependencies.py, cache_invalidator.py}` 保持不动，标记为 legacy。

### 2.3 `sandbox/` 剩余文件 — 沙盒执行引擎，保持不动

`sandbox/{service.py, base.py, docker_sandbox.py, e2b_sandbox.py, file_utils.py, registry.py, schemas.py, dependencies.py}` 保持不动。

---

## Phase 3: `db_connector/` → `connectors/database/`

> **风险：低 | 工作量：0.5 天 | 影响文件：~8 个**

### 移动清单

| 当前位置 | 目标位置 |
|---------|---------|
| `db_connector/__init__.py` | `connectors/database/__init__.py` |
| `db_connector/router.py` | `connectors/database/router.py` |
| `db_connector/service.py` | `connectors/database/service.py` |
| `db_connector/repository.py` | `connectors/database/repository.py` |
| `db_connector/jobs.py` | `connectors/database/jobs.py` |
| `db_connector/models.py` | `connectors/database/models.py` |
| `db_connector/schemas.py` | `connectors/database/schemas.py` |
| `db_connector/dependencies.py` | `connectors/database/dependencies.py` |
| `db_connector/providers/` | `connectors/database/providers/` |

### 需要更新 import 的文件（~8 个）

- `main.py`
- `db_connector/router.py` (内部互引)
- `db_connector/service.py` (内部互引)
- `db_connector/dependencies.py`
- `db_connector/jobs.py`
- `db_connector/providers/__init__.py`
- `db_connector/providers/supabase_rest.py`
- `scheduler/jobs/sync_job.py` (如果存在引用)

---

## Phase 4: `supabase/` 业务 repo 回归各自模块

> **风险：中 | 工作量：1 天 | 影响文件：~20 个**
>
> `supabase/` 应该只保留 client + 基础 repository。
> 各业务 repo 移回对应的业务模块。

### 移动清单

| 当前位置 | 目标位置 | 说明 |
|---------|---------|------|
| `supabase/client.py` | 保留 | 基础设施 |
| `supabase/repository.py` | 保留 | 基础 CRUD |
| `supabase/dependencies.py` | 保留 | |
| `supabase/exceptions.py` | 保留 | |
| `supabase/__init__.py` | 更新 | 移除已迁出的 re-export |
| `supabase/projects/repository.py` | `project/supabase_repository.py` | |
| `supabase/projects/schemas.py` | `project/supabase_schemas.py` | |
| `supabase/tables/repository.py` | `table/supabase_repository.py` | |
| `supabase/tables/schemas.py` | `table/supabase_schemas.py` | |
| `supabase/tools/repository.py` | `tool/supabase_repository.py` | |
| `supabase/tools/schemas.py` | `tool/supabase_schemas.py` | |
| `supabase/mcps/repository.py` | `mcp/supabase_repository.py` | |
| `supabase/mcps/schemas.py` | `mcp/supabase_schemas.py` | |
| `supabase/context_publish/repository.py` | `context_publish/supabase_repository.py` | |
| `supabase/context_publish/schemas.py` | `context_publish/supabase_schemas.py` | |

### 需要更新 import 的文件

- `supabase/__init__.py` — 大量 re-export 需要更新
- `project/service.py`, `project/repository.py` — projects repo
- `table/repository.py`, `table/service.py` — tables repo
- `tool/service.py`, `tool/dependencies.py`, `tool/router.py` — tools repo
- `mcp/service.py`, `mcp/repository.py` — mcps repo
- `context_publish/service.py`, `context_publish/repository.py`, `context_publish/dependencies.py`
- `connectors/agent/config/repository.py` — 引用了 tools
- `internal/router.py` — 引用了多个 supabase repos

---

## Phase 5: 创建 `platform/` 分组

> **风险：高 | 工作量：2 天 | 影响文件：~60 个**
>
> 将 6 个平台基础模块移入 `platform/` 目录。
> ⚠️ `auth/` 被 40+ 个文件引用，是影响面最大的移动。

### 移动清单

| 当前位置 | 目标位置 |
|---------|---------|
| `auth/` | `platform/auth/` |
| `organization/` | `platform/organization/` |
| `project/` | `platform/project/` |
| `profile/` | `platform/profile/` |
| `workspace/` | `platform/workspace/` |
| `analytics/` | `platform/analytics/` |

### 需要更新 import 的文件

**`auth/` (40+ 文件)** — 几乎每个 router.py 都有 `from src.auth.dependencies import get_current_user`。这是全量最大的一次变更。

**`project/` (~15 文件)** — project router/service/repo 被多处引用。

**`organization/` (~5 文件)** — 相对独立。

**`profile/` (~5 文件)** — 相对独立。

**`workspace/` (~3 文件)** — 相对独立。

**`analytics/` (~3 文件)** — 相对独立。

### 降低风险的策略

在旧路径放一个兼容 re-export 文件，让未更新的引用仍然能工作：

```python
# src/auth/__init__.py (迁移后保留的兼容层)
from src.platform.auth.dependencies import *  # noqa: F401,F403
from src.platform.auth.models import *        # noqa: F401,F403
```

后续再逐步清理掉这些兼容层。

---

## Phase 6: 创建 `infra/` 分组

> **风险：高 | 工作量：2 天 | 影响文件：~80 个**
>
> 将基础设施模块移入 `infra/` 目录。
> ⚠️ `supabase/` 被 80+ 个文件引用，是全项目引用最多的模块。

### 移动清单

| 当前位置 | 目标位置 |
|---------|---------|
| `supabase/` (client+base) | `infra/supabase/` |
| `s3/` | `infra/s3/` |
| `llm/` | `infra/llm/` |
| `search/` | `infra/search/` |
| `chunking/` | `infra/chunking/` |
| `turbopuffer/` | `infra/turbopuffer/` |
| `security/` | `infra/security/` |
| `scheduler/` | `infra/scheduler/` |

### 降低风险的策略

同 Phase 5，使用兼容 re-export 过渡。

---

## Phase 7: 模块改名 & 最终清理

> **风险：中 | 工作量：1 天**

### 7.1 `mut_core/` → `mut_engine/`

- 改名目录
- 更新 ~21 个引用文件
- 更新 `AGENTS.md` 文档

### 7.2 `content_node/` → `content/`

- 改名目录
- 更新 ~45 个引用文件
- `table/` 移入 `content/table/`

### 7.3 `upload/` → `ingest/`

- 改名目录
- 更新 ~31 个引用文件 (多为内部互引)

### 7.4 清理 main.py

- Router 注册按层分组（transport / content / connectors / agents / platform）
- 移除模块导入时间统计（或改为 DEBUG only）

### 7.5 更新文档

- `AGENTS.md` — 目录结构
- `backend/AGENTS.md` / `backend/CLAUDE.md`
- `docs/mut-native-architecture.md`
- `docs/mut-migration-roadmap.md`

---

## 执行顺序总结

```
Phase 0 ─→ Phase 1 ─→ Phase 2 ─→ Phase 3
(修 bug)   (消壳)     (拆混装)   (统一连接器)
  1天        1天       0.5天      0.5天

  ─→ Phase 4 ─→ Phase 5 ─→ Phase 6 ─→ Phase 7
    (supabase)   (platform)  (infra)    (改名)
      1天          2天         2天        1天
```

**总工作量估计：~9 天**

**建议先做 Phase 0-3（3 天），这些是高价值低风险的变更。**
Phase 5-6（platform/ 和 infra/ 分组）影响面大但价值相对低，可以放在后面或视情况决定是否执行。

---

## 每个 Phase 的验证步骤

```bash
# 1. 确保没有残留旧路径引用
rg "from src\.旧模块名" backend/

# 2. Python 导入检查
cd backend && python -c "from src.main import app"

# 3. 运行测试
uv run pytest -m "not e2e" --tb=short

# 4. 启动 dev server 验证
uv run uvicorn src.main:app --host 0.0.0.0 --port 9090

# 5. 前端功能检查（确保 API 路径未变）
npm run dev  # 前端不受影响，因为 API URL 不变
```

---

## 最终目录结构预览

完成全部 Phase 后：

```
backend/src/
├── main.py
├── config.py
│
├── mut_engine/              # Layer 1: 版本引擎 (Phase 1+7)
│   ├── write_service.py
│   ├── compat_service.py
│   ├── repo_manager.py
│   ├── server_repo.py
│   ├── index_sync.py
│   ├── protocol_router.py
│   ├── collab_router.py     # ← from collaboration/
│   ├── audit_router.py      # ← from collaboration/
│   ├── audit_repository.py  # ← from collaboration/
│   ├── auth.py
│   ├── schemas.py            # 合并了 collaboration/schemas.py
│   ├── dependencies.py       # 合并了 collaboration/dependencies.py
│   └── backends/
│
├── content/                 # Layer 2: 内容领域 (Phase 7)
│   ├── router.py
│   ├── service.py
│   ├── repository.py
│   ├── schemas.py
│   └── table/               # ← from table/
│
├── connectors/              # Layer 2: 连接器
│   ├── manager/
│   ├── datasource/
│   ├── filesystem/
│   └── database/            # ← from db_connector/ (Phase 3)
│
├── endpoints/               # Layer 2: 端点管理 (Phase 2)
│   ├── mcp/                 # ← from mcp/endpoint_*
│   └── sandbox/             # ← from sandbox/endpoint_*
│
├── mcp/                     # Legacy MCP 健康检查 (保留)
├── sandbox/                 # 沙盒执行引擎 (保留)
│
├── platform/                # Layer 2: 平台功能 (Phase 5)
│   ├── auth/
│   ├── organization/
│   ├── project/
│   ├── profile/
│   ├── workspace/
│   └── analytics/
│
├── ingest/                  # ← from upload/ (Phase 7)
│
├── infra/                   # Layer 0: 基础设施 (Phase 6)
│   ├── supabase/
│   ├── s3/
│   ├── llm/
│   ├── search/
│   ├── chunking/
│   ├── turbopuffer/
│   ├── security/
│   └── scheduler/
│
├── oauth/                   # 保持独立 (或移入 platform/)
├── tool/                    # 保持独立
├── context_publish/         # 保持独立
├── internal/                # Internal API
└── utils/                   # 通用工具
```
