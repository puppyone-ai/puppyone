# content_nodes 路径重构：id_path → mut_path

## 设计决策

**核心原则**：Mut 树是唯一的树结构 Source of Truth。`content_nodes` 是 Mut 树的物化视图。

| 概念 | 角色 | 类比 |
|------|------|------|
| `mut_path` | 索引键 / 树结构 SOT | 文件系统路径 `/home/user/doc.md` |
| `id` (UUID) | 稳定锚点 / 外部引用 | inode 号 |
| `id_path` | **废弃** | — |

- `mut_path` 定位节点在树中的位置（"这个文件在哪"）
- `UUID` 标识节点的身份（"这个文件是谁"）
- UUID 不是索引，不参与树查询。它是贴在 mut_path 位置上的"标签"，rename/move 时标签跟着走

---

## 当前架构的问题

### Bug 1：IndexSync 把 move 当成 delete + add

`MutWriteService.move_file` 的 changeset 是 `[{deleted, old_path}, {added, new_path}]`。IndexSync 删除旧节点（连带 UUID 和所有外键引用），再创建新节点（新 UUID）。导致：

- 所有引用该 node_id 的外键断裂（agent 权限、搜索索引、MCP 端点、公开链接等）
- 新节点的 id_path 是平铺在 root 下的，不反映 Mut 树层级

### Bug 2：文件夹 rename 不更新子节点 mut_path

`compat_service._do_node_rename` 只处理非文件夹。文件夹的 mut_path 和所有子节点的 mut_path 永不更新。

### Bug 3：两个入口各自建树

- REST API 入口：先建 content_node（有正确 id_path），后补 mut_path
- MUT 协议入口：先走 Mut 树，IndexSync 建 content_node（mut_path 正确但 id_path 平铺）

### 根本原因

两棵独立维护的树（PG 的 id_path 树 vs Mut 的路径树），没有单一 Source of Truth。

---

## 目标架构

```
┌──────────────────────────────────────────────────────────────┐
│  Mut Tree (S3)  —  唯一的树结构 Source of Truth               │
│  Merkle tree: {"name": ["B"|"T", hash], ...}                 │
└──────────────────────┬───────────────────────────────────────┘
                       │ IndexSync
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  content_nodes (PostgreSQL)  —  物化视图                      │
│                                                              │
│  id          UUID     稳定标识符（外键引用、API URL）          │
│  project_id  TEXT     所属项目                                │
│  mut_path    TEXT     树中路径（SOT，如 docs/notes.md）        │
│  name        TEXT     节点名                                  │
│  type        TEXT     folder/json/markdown/file               │
│  depth       INT      从 mut_path 计算                        │
│  content_hash TEXT    blob hash → S3                          │
│  current_version INT  Mut 版本号                              │
│  size_bytes  BIGINT                                           │
│  mime_type   TEXT                                             │
│  s3_key      TEXT     大文件直传                              │
│  permissions JSONB                                            │
│  created_by  UUID                                             │
│  created_at  TIMESTAMPTZ                                      │
│  updated_at  TIMESTAMPTZ                                      │
│                                                              │
│  (id_path    废弃删除)                                        │
└──────────────────────────────────────────────────────────────┘
```

### 树查询全部改用 mut_path

| 操作 | 旧（id_path） | 新（mut_path） |
|------|---------------|----------------|
| 列出子节点 | `id_path LIKE parent/%` + `depth = d+1` | `mut_path LIKE parent/%` + `depth = d+1` |
| 列出后代 | `id_path LIKE prefix/%` | `mut_path LIKE prefix/%` |
| 删除子树 | `delete where id_path LIKE prefix/%` | `delete where mut_path LIKE prefix/%` |
| 获取父节点 | `id_path.rsplit("/", 1)[0]` | `mut_path.rsplit("/", 1)[0]` |
| 名称唯一性 | `UNIQUE(project_id, parent_path(id_path), name)` | `UNIQUE(project_id, parent_mut_path(mut_path), name)` |
| 移动/重命名 | `move_node_atomic` 替换 id_path 前缀 | 替换 mut_path 前缀（级联子节点） |
| depth | `array_length(split(id_path))` | `array_length(split(mut_path, '/'))` |

### IndexSync 改造：rename detection

```
sync_changeset(changes):
  1. 将 changes 分为 deleted_set 和 added_set 和 modified_set
  2. 对每个 deleted：
     - 在 added_set 中找 content_hash 相同 + 类型/扩展名匹配的
     - 找到 → 这是 rename/move：UPDATE mut_path（保留 UUID），从 added_set 移除
     - 没找到 → 真正的删除
  3. 对 added_set 中剩余的 → 真正的新增（生成新 UUID）
  4. modified → UPDATE content_hash, current_version
```

---

## 影响范围全量清单

### 第一层：数据库（SQL）

| 组件 | 文件 | 改动 |
|------|------|------|
| `content_nodes` 表结构 | 新 migration | 添加 NOT NULL 约束到 mut_path；删除 id_path 列 |
| `depth` generated column | 新 migration | 改为从 mut_path 计算：`array_length(string_to_array(mut_path, '/'), 1)` |
| `parent_path()` 函数 | 新 migration | 重写为 `parent_mut_path(p_mut_path)` |
| `move_node_atomic()` RPC | 新 migration | 改为操作 mut_path 前缀替换 |
| `check_no_cycle()` trigger | 新 migration | 改为基于 mut_path 检查（或废弃，因为 Mut 树保证无环） |
| `count_children_batch()` RPC | 新 migration | 改为基于 mut_path 前缀 |
| 索引 | 新 migration | 删除 id_path 索引，新建 mut_path 索引（text_pattern_ops） |
| 唯一约束 | 新 migration | `UNIQUE(project_id, parent_mut_path(mut_path), name)` |
| 诊断脚本 | `backend/sql/diagnostics/` | 更新 check_tree_integrity.sql, fix_tree_integrity.sql |
| 重建脚本 | `backend/sql/rebuild_all_tables.sql` | 更新 content_nodes DDL |

### 第二层：Content 模块（核心改动）

| 文件 | 当前 id_path 用法 | 改为 |
|------|-------------------|------|
| **`content/models.py`** | `id_path` 字段、`_derive_parent_id`、`ancestor_ids`、`parent_id_from_path`、`parent_id_path`、`parent_depth` | 所有属性改为基于 `mut_path`；`parent_id` 改为直接查 DB 或从 mut_path 推导 |
| **`content/repository.py`** | `get_by_id_path`、`list_descendants`、`delete_by_id_path_prefix`、`list_children`、`create`(写 id_path)、`update`(写 id_path)、`move_node_atomic`、`collect_subtree_*`、`get_descendant_ids`、`find_names_with_prefix`、`get_child_by_name`、`name_exists_in_parent`、`ensure_root_for_project`、`create_node`(upsert with id_path) | 全部改为 mut_path 查询 |
| **`content/service.py`** | `_build_id_path`、`get_by_id_path`、`list_children`(用 parent.id_path)、`list_descendants`、`get_child_by_name`、`resolve_by_path_segments`、`resolve_by_id_path`、`build_human_path`(解析 id_path)、所有 create 方法、`move_node`(cycle check 用 id_path)、`delete_node_recursive` | 全部改为 mut_path；`_build_id_path` → `_build_mut_path`；路径解析直接用 mut_path segments |
| **`content/router.py`** | 响应中序列化 `id_path`；`get_node_by_id_path` 路由 | 改为序列化 `mut_path`；路由改为 `get_node_by_mut_path` |
| **`content/schemas.py`** | `id_path: str`、`parent_id` 在响应中 | `id_path` 废弃（或保留为 Optional deprecated）；添加 `mut_path` |

### 第三层：Mut Engine 模块

| 文件 | 改动 |
|------|------|
| **`mut_engine/index_sync.py`** | 重写核心逻辑：添加 rename detection（content_hash 匹配）；create_node 时构建正确的 mut_path 层级（创建缺失的中间文件夹节点） |
| **`mut_engine/compat_service.py`** | `_do_node_rename`：添加文件夹 rename 支持，级联更新子节点 mut_path；`_do_node_move`：级联更新子节点 mut_path；`_derive_mut_path`：简化（不再需要走 parent chain，直接读 mut_path） |
| **`mut_engine/write_service.py`** | `create_folder`：确保 mut_path 正确设置；其余逻辑基本不变（已经用 mut_path） |

### 第四层：连接器

| 文件 | 当前 id_path 用法 | 改为 |
|------|-------------------|------|
| **`connectors/filesystem/service.py`** | `parent_node.id_path` 构建子节点路径；`_build_relative_path_from_id_path` 解析 id_path；`list_descendants` 用 folder.id_path；`_get_descendant_ids` 用 folder.id_path | 全部改为 mut_path；`_build_relative_path_from_id_path` → `_build_relative_path_from_mut_path`（直接用 mut_path 裁剪前缀） |
| **`connectors/filesystem/worker.py`** | `node.id_path.strip("/").split("/")` 构建路径映射 | 改为 `node.mut_path.split("/")` |
| **`connectors/agent/sandbox_data.py`** | `target_node.id_path.strip("/").split("/")` 构建名称路径 | 改为 `target_node.mut_path.split("/")` |

### 第五层：搜索

| 文件 | 改动 |
|------|------|
| **`infra/search/service.py`** | `file_id_path` 字段改为 `file_mut_path`：写入用 `file_node.mut_path`；读取改为 `attrs.get("file_mut_path")`；返回 `"mut_path": file_mut_path` |

### 第六层：前端

| 文件 | 当前用法 | 改为 |
|------|----------|------|
| **`frontend/lib/contentNodesApi.ts`** | `NodeDetail.id_path`；`getNodeByIdPath()` | 类型改为 `mut_path`；API 改为 `getNodeByMutPath()` |
| **`frontend/lib/projectsApi.ts`** | 类型中 `id_path: string` | 改为 `mut_path` |
| **`frontend/app/.../page.tsx`** | `id_path` 用于导航 | 改为 `mut_path` |
| **`frontend/app/.../DataPageDialogs.tsx`** | `moveDialogTarget.id_path` | 改为 `mut_path` |
| **`frontend/app/.../useNodeActions.ts`** | `id_path` 在 state 中 | 改为 `mut_path` |
| **`frontend/app/.../GridView.tsx`** | `id_path` 在 props/callbacks | 改为 `mut_path` |
| **`frontend/app/.../ListView.tsx`** | 同上 | 同上 |
| **`frontend/components/MoveToDialog.tsx`** | `n.id_path?.startsWith(excludeIdPath)` 排除子树 | 改为 `n.mut_path?.startsWith(excludeMutPath)` |

### 第七层：测试

| 文件 | 改动 |
|------|------|
| `tests/search/test_folder_search.py` | mock 数据和断言中的 `id_path` → `mut_path` |
| `tests/mcp_service/test_content_node_service_posix.py` | mock repo 改为基于 mut_path |
| `tests/mcp_service/test_internal_posix_router.py` | mock 节点改为 mut_path |
| `tests/e2e/folder_search/test_folder_search_e2e.py` | `file_id_path` → `file_mut_path` |
| `tests/sync/test_openclaw_e2e.py` | id_path 构建和检查改为 mut_path |
| `tests/sync/test_folder_sync_filename_binary.py` | mock 中 `parent_id_path` → `parent_mut_path` |

### 第八层：文档

| 文件 | 改动 |
|------|------|
| `docs/content-node-tree-architecture.md` | 更新架构描述 |
| `docs/mut-native-architecture.md` | 更新 content_nodes 说明 |
| `docs/mut-migration-roadmap.md` | 标记 Phase 5 完成，添加 Phase 6 |
| `backend/docs/puppyone/turbopuffer/folder-search.md` | `file_id_path` → `file_mut_path` |
| `puppydoc/pages/en/reference/api.mdx` | API 文档更新 |
| `backend/AGENTS.md` / `CLAUDE.md` | 更新架构描述 |

### 不需要改动的部分（UUID 引用）

以下全部通过 UUID 引用 content_nodes，**不需要改动**：

- 所有 `node_id` 外键：`connection_accesses`、`chunks`、`tools`、`mcp_endpoints`、`sandbox_endpoints`、`uploads`、`context_publish`、`syncs`
- 所有 API 路由中的 `{node_id}` 参数
- 所有 service 方法中的 `node_id` 参数
- 所有 agent/MCP/sandbox 配置中的 `node_id` 引用
- `mut_engine/collab_router.py` 的版本/回滚/diff 端点
- `mut_engine/audit_router.py` 的审计日志端点
- `ingest/router.py` 的数据摄取端点

---

## 施工计划

### Phase 1：数据库 Schema 迁移

**目标**：让 mut_path 成为 NOT NULL 且有完整索引，同时保留 id_path（过渡期）。

1. 数据回填脚本：为所有 `mut_path IS NULL` 的节点从 id_path + name 推导 mut_path
2. `ALTER TABLE content_nodes ALTER COLUMN mut_path SET NOT NULL`
3. 创建新的 SQL 函数：
   - `parent_mut_path(p_mut_path TEXT)` — 提取父路径
   - `move_node_mut_path(p_project_id, p_old_prefix, p_new_prefix)` — mut_path 前缀替换
4. 创建新索引：
   - `idx_cn_mut_path_lookup (project_id, mut_path text_pattern_ops)`
   - `idx_cn_children_mut (project_id, depth, mut_path text_pattern_ops)`
   - `UNIQUE idx_cn_unique_name_mut (project_id, parent_mut_path(mut_path), name)`
5. 添加新的 depth 定义（基于 mut_path）
6. 更新 `check_no_cycle` trigger（或废弃，Mut 树天然无环）

**此阶段 id_path 和旧索引仍保留**，系统继续运行。

### Phase 2：IndexSync 重写

**目标**：修复所有已知 Bug，让 Mut → content_nodes 同步正确工作。

1. 添加 rename detection：在 changeset 中匹配 deleted + added 的 content_hash
2. rename/move 时 UPDATE mut_path（保留 UUID），不再 delete + add
3. create_node 时构建正确的 mut_path 层级（递归创建缺失的中间文件夹）
4. 文件夹 rename/move 时级联更新所有子节点的 mut_path

### Phase 3：Content 模块读路径迁移

**目标**：所有读查询从 id_path 切换到 mut_path。

1. `content/models.py`：
   - 添加 mut_path 版本的属性（`parent_mut_path_value`、`mut_depth` 等）
   - 保留旧属性（过渡期）
2. `content/repository.py`：
   - 添加 mut_path 版本的查询方法（`list_children_by_mut_path`、`list_descendants_by_mut_path` 等）
   - 旧方法标记 deprecated
3. `content/service.py`：
   - 切换到 mut_path 版本的方法
   - `_build_id_path` → `_build_mut_path`
   - 路径解析改用 mut_path segments
4. `content/router.py`：
   - 添加 `get_node_by_mut_path` 路由
   - 响应中添加 `mut_path`

### Phase 4：Content 模块写路径迁移

**目标**：所有写操作使用 mut_path。

1. `content/service.py`：所有 create 方法用 `_build_mut_path` 代替 `_build_id_path`
2. `move_node`：用 `move_node_mut_path` RPC 代替 `move_node_atomic`
3. `delete_node_recursive`：用 `mut_path LIKE prefix/%` 代替 `id_path LIKE prefix/%`
4. `rename_node`：添加 mut_path 级联更新（文件夹 rename 时更新子节点）

### Phase 5：连接器 & 搜索迁移

**目标**：所有外围模块切换到 mut_path。

1. `connectors/filesystem/service.py`：路径构建改用 mut_path
2. `connectors/filesystem/worker.py`：路径映射改用 mut_path
3. `connectors/agent/sandbox_data.py`：路径构建改用 mut_path
4. `infra/search/service.py`：`file_id_path` → `file_mut_path`
5. `mut_engine/compat_service.py`：简化 `_derive_mut_path`（直接读 mut_path 字段）

### Phase 6：前端迁移

**目标**：前端从 id_path 切换到 mut_path。

1. 类型定义：`NodeDetail.id_path` → `NodeDetail.mut_path`
2. API 调用：`getNodeByIdPath` → `getNodeByMutPath`
3. 组件：MoveToDialog、GridView、ListView 中的 id_path → mut_path
4. 导航：页面路由中的 id_path → mut_path

### Phase 7：清理 & 删除 id_path

**目标**：彻底删除 id_path。

1. 确认所有功能正常运行（回归测试）
2. 删除数据库中的 id_path 列和相关索引
3. 删除 `parent_path(id_path)` 函数
4. 删除 `move_node_atomic` RPC（已被 `move_node_mut_path` 替代）
5. 删除 `check_no_cycle` trigger（Mut 树保证无环）
6. 删除 `count_children_batch` 的 id_path 版本
7. 更新所有测试
8. 更新所有文档

---

## 关键设计细节

### mut_path 格式规范

```
根节点:         ""（空字符串）或文件夹名如 "docs"
子文件夹:       "docs/api"
文件:           "docs/api/readme.md"
表:             "tables/{table_id}.json"
```

- 不以 `/` 开头（与 id_path 不同）
- 文件带扩展名（.json / .md）
- 文件夹不带扩展名
- 名称中的 `/` 需要编码（待定策略）

### depth 计算

```sql
depth INT GENERATED ALWAYS AS (
  CASE 
    WHEN mut_path = '' THEN 0
    ELSE array_length(string_to_array(mut_path, '/'), 1)
  END
) STORED;
```

- `""` → depth 0（project root）
- `"docs"` → depth 1
- `"docs/notes.md"` → depth 2

### parent_mut_path 函数

```sql
CREATE OR REPLACE FUNCTION parent_mut_path(p_mut_path TEXT)
RETURNS TEXT AS $$
BEGIN
  IF p_mut_path IS NULL OR p_mut_path = '' THEN
    RETURN '__root__';
  END IF;
  IF position('/' in p_mut_path) = 0 THEN
    RETURN '__root__';
  END IF;
  RETURN regexp_replace(p_mut_path, '/[^/]+$', '');
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### rename detection 伪代码

```python
async def sync_changeset(self, project_id, store, changes, root_hash, version, operator_id):
    deleted = {c["path"]: c for c in changes if c["op"] == "deleted"}
    added = {c["path"]: c for c in changes if c["op"] == "added"}
    modified = [c for c in changes if c["op"] == "modified"]

    # Rename detection: match deleted → added by content_hash
    renames = []
    for del_path, del_change in list(deleted.items()):
        del_node = await self._repo.get_by_mut_path(project_id, del_path)
        if not del_node or not del_node.content_hash:
            continue
        for add_path, add_change in list(added.items()):
            add_blob_hash = self._get_blob_hash_from_tree(store, root_hash, add_path)
            if add_blob_hash == del_node.content_hash:
                # Same content → rename/move
                renames.append((del_path, add_path, del_node))
                del deleted[del_path]
                del added[add_path]
                break

    # Process renames: update mut_path, keep UUID
    for old_path, new_path, node in renames:
        await self._repo.update(node.id, mut_path=new_path, current_version=version)
        # If it's a folder, cascade children
        await self._cascade_children_mut_path(project_id, old_path, new_path)

    # Process real deletes
    for path in deleted:
        node = await self._repo.get_by_mut_path(project_id, path)
        if node:
            await self._repo.delete(node.id)

    # Process real adds
    for path in added:
        await self._handle_add(project_id, store, path, root_hash, version)

    # Process modifications
    for change in modified:
        await self._handle_modify(project_id, store, change["path"], root_hash, version)
```

### 文件夹 rename 级联

```sql
CREATE OR REPLACE FUNCTION move_node_mut_path(
    p_project_id TEXT,
    p_old_prefix TEXT,
    p_new_prefix TEXT
) RETURNS VOID AS $$
BEGIN
    -- Update the node itself
    UPDATE content_nodes
    SET mut_path = p_new_prefix
    WHERE project_id = p_project_id AND mut_path = p_old_prefix;

    -- Update all descendants
    UPDATE content_nodes
    SET mut_path = p_new_prefix || substring(mut_path from length(p_old_prefix) + 1)
    WHERE project_id = p_project_id
      AND mut_path LIKE p_old_prefix || '/%';
END;
$$ LANGUAGE plpgsql;
```

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| rename detection 误判（两个不同文件恰好 content_hash 相同） | 同时匹配 hash + 文件类型 + 扩展名 |
| 文件夹 rename 级联 O(N) 性能 | 单条 SQL UPDATE（与 move_node_atomic 相同量级）；文件夹 rename 频率低 |
| mut_path 中含 `/` 的文件名 | 定义编码规则（如 URL encode）或禁止 |
| 过渡期两套路径共存的复杂度 | Phase 1-6 分阶段切换，每阶段独立可测试 |
| 前端 URL 中暴露路径的安全性 | 前端 URL 继续用 UUID（`/nodes/{node_id}`），不暴露 mut_path |
| Turbopuffer 搜索索引中的 `file_id_path` 迁移 | 需要重建搜索索引（可异步） |

---

## 工作量估算

| Phase | 描述 | 预估 |
|-------|------|------|
| Phase 1 | 数据库 Schema 迁移 | 1-2 天 |
| Phase 2 | IndexSync 重写 | 2-3 天 |
| Phase 3 | Content 读路径迁移 | 2-3 天 |
| Phase 4 | Content 写路径迁移 | 1-2 天 |
| Phase 5 | 连接器 & 搜索迁移 | 1-2 天 |
| Phase 6 | 前端迁移 | 1-2 天 |
| Phase 7 | 清理 & 删除 id_path | 1 天 |
| **总计** | | **9-15 天** |

---

## 实施状态

**全部 7 个 Phase 已完成** (2026-03-19)

### 变更文件清单

**Phase 1 - DB Migration:**
- `supabase/migrations/20260319000000_mut_path_sole_sot.sql` (NEW)

**Phase 2 - IndexSync:**
- `backend/src/mut_engine/index_sync.py` (REWRITE: rename detection, parent folder creation)

**Phase 3+4 - Content Module:**
- `backend/src/content/models.py` (REWRITE: id_path → mut_path)
- `backend/src/content/repository.py` (REWRITE: all queries use mut_path)
- `backend/src/content/service.py` (REWRITE: _build_mut_path, move/delete/create all via mut_path)
- `backend/src/content/schemas.py` (UPDATED: NodeInfo.id_path → mut_path)
- `backend/src/content/router.py` (UPDATED: by-id-path endpoint → by-mut-path)

**Phase 5 - Connectors & Search:**
- `backend/src/mut_engine/compat_service.py` (UPDATED: rename/move handle folders)
- `backend/src/connectors/filesystem/service.py` (UPDATED: all tree ops use mut_path)
- `backend/src/connectors/filesystem/worker.py` (UPDATED: path map uses mut_path)
- `backend/src/connectors/agent/sandbox_data.py` (UPDATED: relative path from mut_path)
- `backend/src/infra/search/service.py` (UPDATED: file_id_path → file_mut_path)
- `backend/src/internal/router.py` (UPDATED: descriptions)

**Phase 6 - Frontend:**
- `frontend/lib/contentNodesApi.ts` (UPDATED: NodeInfo type, API endpoint)
- `frontend/lib/projectsApi.ts` (UPDATED: inline type)
- `frontend/components/MoveToDialog.tsx` (UPDATED: prop names)
- `frontend/app/(main)/projects/[projectId]/data/hooks/useNodeActions.ts`
- `frontend/app/(main)/projects/[projectId]/data/components/DataPageDialogs.tsx`
- `frontend/app/(main)/projects/[projectId]/data/components/views/ListView.tsx`
- `frontend/app/(main)/projects/[projectId]/data/components/views/GridView.tsx`
- `frontend/app/(main)/projects/[projectId]/data/[[...path]]/page.tsx`

**Phase 7 - Cleanup:**
- `id_path` column dropped in migration SQL
- All old SQL functions (`parent_path`, `move_node_atomic`, `check_no_cycle`) dropped
- Zero remaining `id_path` references in backend/frontend source code
