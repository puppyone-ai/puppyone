# Content Node 树结构架构分析与方案设计

> **日期**: 2026-03-04
> **状态**: Implemented (Phase 1 完成)
> **作者**: Architecture Review

---

## 目录

1. [背景与问题](#背景与问题)
2. [现状诊断](#现状诊断)
3. [方案概述](#方案概述)
4. [场景化性能分析](#场景化性能分析)
5. [空间复杂度对比](#空间复杂度对比)
6. [总结矩阵](#总结矩阵)
7. [建议与路线图](#建议与路线图)

---

## 背景与问题

PuppyOne 是一个用 PostgreSQL + S3 存储数据、但维护文件系统 (File System) 接口的产品。核心数据模型 `content_nodes` 表同时使用了两套层级表示：

| 机制 | 列 | 用途 |
|------|----|----|
| **Adjacency List** | `parent_id` (FK → self) | 列出直接子节点、向上遍历构建路径、递归删除 |
| **Materialized Path** | `id_path` (如 `/uuid1/uuid2/uuid3`) | 列出所有子孙节点 (`LIKE prefix/%`)、move 时的环检测、排序 |

这种双源架构在节点移动时会引发数据不一致和循环引用问题，导致 sandbox 和 fs 遍历出现递归 bug。

### 核心使用场景

- **高频**：列举文件夹下的文件、列举子树所有文件、读写单个文件
- **中频**：节点移动（拖拽、MCP rm 软删除）、文件夹同步、sandbox 导出/写回
- **低频**：递归硬删除、搜索索引、批量创建

---

## 现状诊断

### 当前 Schema

```sql
CREATE TABLE content_nodes (
    id            TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    parent_id     TEXT REFERENCES content_nodes(id) ON DELETE CASCADE,  -- Adjacency List
    name          TEXT NOT NULL,
    type          TEXT NOT NULL CHECK (type IN ('folder', 'json', 'markdown', 'file')),
    id_path       TEXT NOT NULL DEFAULT '/',  -- Materialized Path (e.g. /uuid1/uuid2/uuid3)
    preview_json  JSONB,
    preview_md    TEXT,
    s3_key        TEXT,
    mime_type     TEXT,
    size_bytes    BIGINT NOT NULL DEFAULT 0,
    permissions   JSONB NOT NULL DEFAULT '{"inherit": true}'::JSONB,
    current_version INT NOT NULL DEFAULT 0,
    content_hash  TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_content_nodes_project_id ON content_nodes(project_id);
CREATE INDEX idx_content_nodes_parent_id ON content_nodes(parent_id);
CREATE INDEX idx_content_nodes_type ON content_nodes(type);
CREATE INDEX idx_content_nodes_id_path ON content_nodes(id_path);

CREATE UNIQUE INDEX idx_content_nodes_unique_name
    ON content_nodes (project_id, COALESCE(parent_id, '__root__'), name);
```

### 已确认的 5 个结构性问题

#### 问题 1：双源数据不一致 — 根因

`parent_id` 和 `id_path` 是对同一层级关系的两种独立表达，但没有任何 DB-level 约束保证它们一致。`move_node` 的流程是：

1. 读节点（获取 `old_id_path`）
2. 检查环
3. 更新节点的 `parent_id` + `id_path`（一次 update）
4. **逐行更新**所有子孙节点的 `id_path`（N 次独立 update）

步骤 3 和 4 之间没有事务保护。如果步骤 4 中途失败，`parent_id` 链和 `id_path` 链就会永久性失去同步。

#### 问题 2：环检测依赖可能已损坏的数据

`move_node` 的环检测是：

```python
if target and target.id_path and f"/{node_id}" in target.id_path:
    raise BusinessException("Cannot move a node into its own descendant")
```

这依赖 target 的 `id_path` 是正确的。但如果 `id_path` 因为之前的部分失败而已经不准确，这个检测就会漏判，造成环。

#### 问题 3：非原子性批量更新

`update_children_id_path_prefix` 对每个子孙节点执行独立的 HTTP 请求到 Supabase：

```python
for row in response.data:
    new_id_path = new_prefix + row["id_path"][len(old_prefix):]
    self.client.table(...).update({"id_path": new_id_path}).eq("id", row["id"]).execute()
```

这是 N 次独立网络请求，没有事务包裹。并发 move 操作可能交错执行导致数据损坏。

#### 问题 4：多处遍历无环保护

| 函数 | 位置 | 遍历方式 | 环保护 |
|------|------|---------|--------|
| `build_display_path()` | content_node/service.py | `parent_id` 向上走 | **无** — 死循环 |
| `_build_relative_path()` | filesystem/service.py | `parent_id` 向上走 | **无** — 死循环 |
| `_collect_node_info()` | content_node/service.py | `parent_id` 递归向下 | **无** — 栈溢出 |
| `_delete_recursive()` | content_node/service.py | `parent_id` 递归向下 | **无** — 栈溢出 |
| `build_name_path()` | sandbox_data.py | `parent_id` 向上走 | **有** `visited` |
| `_get_path()` | sync_worker.py | `parent_id` 向上走 | **有** `_visiting` |

#### 问题 5：缺乏 DB-level 约束

没有 trigger、CHECK constraint 或 exclusion constraint 来阻止 `parent_id` 形成环。所有保护都在应用层，且只在 `move_node` 一个入口。任何直接 `repo.update()` 调用或 DB 级别操作都可以绕过。

---

## 方案概述

### 方案 A：Materialized Path (`id_path`) 为唯一 Source of Truth（推荐）

删除 `parent_id`，让 `id_path` 成为层级关系的唯一表达。用 generated column 提供 `depth` 能力。

```sql
ALTER TABLE content_nodes
    ADD COLUMN depth INT GENERATED ALWAYS AS (
        array_length(string_to_array(trim(both '/' from id_path), '/'), 1)
    ) STORED;
```

**关键操作变化**：

| 操作 | 当前实现 | 方案 A |
|------|---------|--------|
| 列出直接子节点 | `WHERE parent_id = X` | `WHERE id_path LIKE '{X.id_path}/%' AND depth = {X.depth + 1}` |
| 列出所有子孙 | `WHERE id_path LIKE '{prefix}/%'` | 不变 |
| 移动节点 | 更新 parent_id + 逐行更新 id_path | **单条 SQL 原子更新** |
| 环检测 | 应用层检查 | 前缀检查（结构性不可能产生环） |

**原子性 Move**（核心优势）：

```sql
UPDATE content_nodes
SET id_path = :new_prefix || substring(id_path from length(:old_prefix) + 1)
WHERE project_id = :project_id
  AND (id_path = :old_prefix OR id_path LIKE :old_prefix || '/%');
```

一条 SQL 同时更新节点和所有子孙的 `id_path`，天然原子。

### 方案 B：Adjacency List (`parent_id`) 为唯一 Source of Truth + DB Trigger 维护 `id_path`

保留 `parent_id` 为权威数据，`id_path` 由 PostgreSQL trigger 自动计算维护。

```sql
CREATE OR REPLACE FUNCTION refresh_id_path() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.parent_id IS NULL THEN
        NEW.id_path := '/' || NEW.id;
    ELSE
        SELECT id_path || '/' || NEW.id INTO NEW.id_path
        FROM content_nodes WHERE id = NEW.parent_id;
    END IF;

    -- 环检测：沿 parent_id 链走到根
    DECLARE
        check_id TEXT := NEW.parent_id;
        visited TEXT[] := ARRAY[NEW.id];
    BEGIN
        WHILE check_id IS NOT NULL LOOP
            IF check_id = ANY(visited) THEN
                RAISE EXCEPTION 'Circular reference detected';
            END IF;
            visited := array_append(visited, check_id);
            SELECT parent_id INTO check_id FROM content_nodes WHERE id = check_id;
        END LOOP;
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 方案 C：Closure Table

新增 `content_node_ancestors` 表，显式存储所有祖先-子孙关系。

```sql
CREATE TABLE content_node_ancestors (
    ancestor_id   TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
    descendant_id TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
    depth         INT NOT NULL,  -- 0 = self, 1 = direct child, 2 = grandchild, ...
    PRIMARY KEY (ancestor_id, descendant_id)
);

CREATE INDEX idx_cna_descendant ON content_node_ancestors(descendant_id, depth);
```

### 方案 D：保持双列 + 加固安全层（最小改动方案）

保留 `parent_id` + `id_path`，通过 DB trigger 防环 + Supabase RPC 实现原子 move。

```sql
CREATE FUNCTION move_node_atomic(
    p_node_id TEXT, p_project_id TEXT, p_new_parent_id TEXT, p_new_id_path TEXT
) RETURNS VOID AS $$
DECLARE
    v_old_id_path TEXT;
BEGIN
    SELECT id_path INTO v_old_id_path FROM content_nodes WHERE id = p_node_id FOR UPDATE;

    UPDATE content_nodes
    SET parent_id = p_new_parent_id, id_path = p_new_id_path
    WHERE id = p_node_id;

    UPDATE content_nodes
    SET id_path = p_new_id_path || substring(id_path from length(v_old_id_path) + 1)
    WHERE project_id = p_project_id AND id_path LIKE v_old_id_path || '/%';
END;
$$ LANGUAGE plpgsql;
```

---

## 场景化性能分析

**变量定义**：

- **N** = 项目中总节点数
- **K** = 某文件夹的直接子节点数
- **D** = 某文件夹的全部子孙数（子树大小）
- **L** = 树的平均深度
- **M** = 被移动节点 + 其子孙数

### 场景 1：前端浏览 — 列出文件夹下的文件

> 用户在 Data Explorer 点击文件夹，`GET /api/v1/nodes/?parent_id=X`
>
> **频率：极高**（每次导航点击都触发，SWR 10s dedup + revalidate on focus）

| 方案 | SQL | DB 往返 | 时间复杂度 | 备注 |
|------|-----|---------|-----------|------|
| **当前** | `WHERE parent_id = :id` | 1 | O(K) | `idx_content_nodes_parent_id` 索引命中 |
| **A (id_path)** | `WHERE id_path LIKE ':prefix/%' AND depth = :d+1` | 1 (若已知 prefix) 或 2 (先查 folder) | O(K) | 需要组合索引 `(project_id, depth, id_path)`；btree 对左前缀 LIKE 有效 |
| **B (trigger)** | `WHERE parent_id = :id` | 1 | O(K) | 同当前 |
| **C (Closure)** | `JOIN cna ON cna.descendant_id = cn.id WHERE cna.ancestor_id = :id AND cna.depth = 1` | 1 | O(K) | JOIN 有额外开销，但 closure 表主键直接命中 |
| **D (加固)** | `WHERE parent_id = :id` | 1 | O(K) | 同当前 |

**结论**：所有方案都是 O(K)。实际瓶颈是 Supabase REST API 的网络延迟（~50-100ms），远大于查询本身差异。

### 场景 2：沙盒数据准备 — 导出文件夹子树

> Agent 执行前，`prepare_sandbox_data()` 加载 folder 的全部子孙并构建文件系统结构
>
> **频率：中高**（每次 agent 执行 sandbox 工具）

| 方案 | 查询方式 | DB 往返 | 路径构建 | 总时间复杂度 |
|------|---------|---------|---------|-------------|
| **当前** | `id_path LIKE ':prefix/%'` → D 行 | 2 (get_node + list_descendants) | `build_name_path`: 每个节点沿 parent_id 向上走 → O(D×L) 内存操作 | O(D×L) |
| **A (id_path)** | 同上 | 2 | id_path 已排序，可用前缀关系直接构建路径树 → O(D) | **O(D)** |
| **B (trigger)** | 同上 | 2 | 同当前 O(D×L)，parent_id 仍在 | O(D×L) |
| **C (Closure)** | `JOIN cna WHERE ancestor = :id` → D 行 | 2 | 需要额外查 depth=1 的父子关系来构建路径 | O(D) 但 JOIN 开销 |
| **D (加固)** | 同当前 | 2 | 同当前 O(D×L) | O(D×L) |

**方案 A 的优势**：`list_descendants` 返回的结果按 `id_path` 排序，可以直接用前缀关系构建路径树，不需要向上遍历 parent_id 链。举例：

```
/a          → FolderA
/a/b        → FolderB  (parent = FolderA, 直接从 id_path 前缀推导)
/a/b/c      → FileC    (parent = FolderB)
```

按 `id_path` 排序后，每个节点的父节点一定已经出现过，所以可以 O(1) 查 hashmap 构建完整路径。

**实际数据量**：假设一个 folder 有 500 个子孙节点、平均深度 5：

- 当前：500×5 = 2500 次内存 dict 查找
- 方案 A：500 次 hashmap 查找
- 差异在毫秒级，但方案 A 从结构上消除了环导致死循环的风险

### 场景 3：沙盒写回 — diff & writeback

> Agent 执行完毕，`diff_and_writeback()` 检查哪些文件变了，写回 DB
>
> **频率：中**（每次 agent 执行后）

| 步骤 | 操作 | 与方案关系 |
|------|------|-----------|
| 1 | Sandbox 内 `find + sha256sum` | 与 DB 方案无关 |
| 2 | 逐文件比较 hash | 纯内存 |
| 3 | 读取变化文件内容 | Sandbox I/O |
| 4 | `collab.commit(CONTENT_UPDATE)` | 单节点 update by ID |

**结论**：写回操作完全基于 `node_id`（已知），不涉及树遍历。四种方案完全相同。

### 场景 4：MCP POSIX — ls / cat / write / mkdir / rm

> MCP Client（如 Claude Desktop）通过 MCP 协议操作文件系统
>
> **频率：高**

#### 子场景：路径解析 (`resolve_path`)

将 `/docs/project/readme.md` 解析为 node_id：

| 方案 | 实现 | DB 往返 | 时间 |
|------|------|---------|------|
| 所有方案 | 逐段 `get_child_by_name(parent_id, segment)` | L 次 | O(L) |

路径解析是逐段走的，与树结构方案无关。所有方案都需要 L 次查询。

#### 子场景：各操作

| 操作 | 查询 | 方案差异 |
|------|------|---------|
| `ls` | list_children | 同场景 1，所有方案 O(K) |
| `cat` | get_by_id | O(1)，无差异 |
| `write` | update by id | O(1)，无差异 |
| `mkdir` | create with parent | O(1)，无差异 |
| `rm` | soft_delete → move to .trash | **同场景 5（Move）** |

### 场景 5：节点移动（核心差异场景）

> 用户拖拽文件/文件夹到新位置，或 MCP `rm`（软删除 = 移入 .trash）
>
> **频率：中**，但这是安全性最关键的操作

| 方案 | 步骤 | DB 往返 | 原子性 | 环风险 |
|------|------|---------|-------|--------|
| **当前** | ①读节点(1) ②读目标(1) ③应用层环检测 ④更新节点 parent_id+id_path(1) ⑤**逐行**更新 M 个子孙 id_path(M) | **3 + M** | **非原子** ❌ | 有（id_path 不一致时漏判） |
| **A (id_path)** | ①读节点(1) ②读目标(1) ③前缀检测环 ④`UPDATE SET id_path = new\|\|substr(...) WHERE id_path = old OR id_path LIKE old\|\|'/%'`(1) | **3** | **原子** ✅ | **不可能**（单条 UPDATE，前缀替换不产生环） |
| **B (trigger)** | ①读节点(1) ②更新 parent_id(1, trigger 检测环) ③trigger 级联更新子孙 id_path | **2 + trigger 内部** | 取决于 trigger 实现 | DB 级防环 ✅ |
| **C (Closure)** | ①环检测查询(1) ②删除旧祖先关系(1) ③插入新祖先关系(1, CROSS JOIN) ④更新 parent_id(1) | **4**（事务内） | 原子（事务）✅ | 查询检测 ✅ |
| **D (加固)** | ①读节点(1) ②读目标(1) ③RPC `move_node_atomic()`(1) | **3** | **原子**（RPC 内事务）✅ | DB trigger 防环 ✅ |

**具体数据举例** — 移动一个包含 200 个子节点的文件夹：

| 方案 | Supabase API 调用次数 | 预估耗时 | 失败后状态 |
|------|---------------------|---------|-----------|
| **当前** | 203 次 HTTP 请求 | ~10-20 秒 | 部分更新，id_path 与 parent_id 不一致 |
| **A** | 3 次 HTTP 请求 | ~150-300ms | 要么全成功，要么全不变 |
| **B** | 2 次（但 trigger 内部有级联） | ~200-500ms | trigger 失败则回滚 |
| **C** | 4 次 HTTP 请求 | ~200-400ms | 事务回滚 |
| **D** | 3 次 HTTP 请求（含 1 次 RPC） | ~150-300ms | RPC 内事务回滚 |

### 场景 6：文件夹同步 — 全量树构建

> `sync_worker.sync_project()` 加载整个项目树，构建路径映射
>
> **频率：中**（每次 sync pull/push）

| 方案 | 查询 | 路径构建 | 总时间 | 环风险 |
|------|------|---------|-------|--------|
| **当前** | `list_by_project`(1 query, N rows) | `_get_path`: 每节点走 parent_id 链，有 cache → 最坏 O(N×L)，有 cache 约 O(N) | O(N) 均摊 | 有 `_visiting` 保护 |
| **A** | `list_by_project`(1 query, N rows, order by id_path) | 已按 id_path 排序，前缀递推 → O(N) | **O(N)** | **不可能**（无 parent_id 链） |
| **B** | 同当前 | 同当前 | O(N) 均摊 | 有 trigger 保护 |
| **C** | `list_by_project`(1 query) + closure 查祖先 | O(N) 但需要额外 JOIN | O(N) | 不可能 |
| **D** | 同当前 | 同当前 | O(N) 均摊 | 有 trigger 保护 |

**方案 A 的优势**：路径构建从"向上遍历 parent_id 链"变成"从排序后的 id_path 直接推导"，不仅更快，而且从结构上不需要任何环检测逻辑。

### 场景 7：版本快照 — 文件夹快照创建

> `create_folder_snapshot()` 收集文件夹下所有文件的当前版本号
>
> **频率：中**（Agent 批量修改后触发）

| 方案 | 查询 | 时间 |
|------|------|------|
| 所有方案 | `list_descendants` (id_path LIKE 或 closure JOIN) → D 行 | O(D) |

**结论**：完全相同。

### 场景 8：递归删除（硬删除）

> `delete_node()` 递归删除节点及其子孙，并清理 S3 文件
>
> **频率：低**（清空 .trash 时）

| 方案 | 实现 | DB 往返 | 环风险 |
|------|------|---------|--------|
| **当前** | `_delete_recursive`: 逐节点递归 `get_children_ids` → delete | **2×D**（每节点 1 次查 children + 1 次 delete） | **有**（无 visited 检测，环导致栈溢出） |
| **A** | ① `SELECT id,s3_key WHERE id_path LIKE prefix/%`(1) ② 批量删 S3 ③ `DELETE WHERE id_path LIKE prefix/%`(1) | **2** | **不可能** |
| **B** | 可用 id_path LIKE 或递归 | 2 或同当前 | trigger 保护 |
| **C** | `DELETE WHERE id IN (SELECT descendant_id FROM cna WHERE ancestor_id=X)` | **1**（级联删 closure） | 不可能 |
| **D** | 可用 id_path LIKE | **2** | trigger 保护 |

**方案 A 将 2D 次查询降到 2 次**，且从结构上不可能因环导致栈溢出。

### 场景 9：搜索索引 — 索引文件夹

> `search.index_folder()` 获取文件夹下所有可索引文件
>
> **频率：低-中**

同场景 7，所有方案 `list_descendants` → O(D)，无差异。

### 场景 10：MCP Table — JSON Pointer CRUD

> 对单个 JSON 节点做 JSON Pointer 操作
>
> **频率：高**

| 方案 | 操作 |
|------|------|
| 所有方案 | `get_by_id(table_id)` → JSON 操作 → `update(table_id, data)` |

完全不涉及树遍历，所有方案 O(1)。

---

## 空间复杂度对比

| 方案 | 主表额外存储 | 辅助表 | 每节点空间开销 |
|------|-------------|--------|---------------|
| **当前** | `parent_id`(36B) + `id_path`(~36×L bytes) | 无 | ~36×(L+1) bytes |
| **A** | `id_path`(~36×L bytes) + `depth`(4B) | 无 | ~36×L + 4 bytes |
| **B** | 同当前 | 无 | ~36×(L+1) bytes |
| **C** | `parent_id`(36B) | `content_node_ancestors`: 每节点 L 行，每行 ~76B | ~36 + 76×L bytes |
| **D** | 同当前 | 无 | ~36×(L+1) bytes |

假设 N=10,000 节点、平均深度 L=5：

| 方案 | 主表 | 辅助表 | 总计 |
|------|------|--------|------|
| **当前** | ~2.1 MB | 0 | ~2.1 MB |
| **A** | ~1.8 MB | 0 | **~1.8 MB** |
| **B** | ~2.1 MB | 0 | ~2.1 MB |
| **C** | ~0.35 MB | ~3.7 MB | **~4.1 MB** |
| **D** | ~2.1 MB | 0 | ~2.1 MB |

Closure Table 的空间开销约为其他方案的 2 倍。

---

## 总结矩阵

| 场景 | 频率 | 当前 | A (id_path) | B (trigger) | C (Closure) | D (加固) |
|------|------|------|------------|------------|------------|---------|
| 列子节点 | 极高 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 列子树 | 高 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 沙盒导出 | 中高 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 沙盒写回 | 中 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| MCP POSIX | 高 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| MCP Table | 高 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **节点移动** | **中** | **⭐⭐** | **⭐⭐⭐⭐⭐** | **⭐⭐⭐** | **⭐⭐⭐⭐** | **⭐⭐⭐⭐** |
| 全量同步 | 中 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 递归删除 | 低 | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 版本快照 | 中 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **安全性** | — | **⭐⭐** | **⭐⭐⭐⭐⭐** | **⭐⭐⭐⭐** | **⭐⭐⭐⭐⭐** | **⭐⭐⭐⭐** |
| 代码改动量 | — | — | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |

---

## 建议与路线图

### 推荐：方案 A（`id_path` 唯一 Source of Truth）

理由：

1. **Move 从 O(M) 网络请求降到 O(1)**，且天然原子
2. **递归删除从 O(2D) 降到 O(2)**
3. **环从数学上不可能产生**，所有遍历代码可以移除 cycle detection 逻辑
4. 高频操作（列子节点、列子树）性能几乎无损
5. 代码库已经大量使用 `id_path`（list_descendants、delete_by_id_path_prefix、ordering 等）

唯一代价是"列直接子节点"从 `WHERE parent_id=X` 变成 `WHERE id_path LIKE 'prefix/%' AND depth=N`，需要组合索引，但在 PostgreSQL btree 上等价高效。

### 分阶段实施路线

**Phase 1（止血）**：方案 D — 最小改动加固

- 添加 DB trigger 防环
- 添加 `move_node_atomic` RPC
- 为所有无保护的遍历函数添加 visited 检测

**Phase 2（迁移）**：方案 A — 结构性解决

- 添加 `depth` generated column
- 迁移所有 `parent_id` 查询到 `id_path` + `depth`
- 保留 `parent_id` 为 computed column（兼容过渡）
- 最终移除 `parent_id`

---

## 附录：受影响的代码清单

### 使用 `parent_id` 的代码（需迁移到 `id_path` + `depth`）

| 文件 | 函数 | 用途 |
|------|------|------|
| `content_node/repository.py` | `list_children` | 列出直接子节点 |
| `content_node/repository.py` | `get_children_ids` | 获取子节点 ID（递归删除） |
| `content_node/repository.py` | `find_names_with_prefix` | 查找同目录下前缀名称 |
| `content_node/repository.py` | `get_child_by_name` | 按名称查找子节点 |
| `content_node/repository.py` | `name_exists_in_parent` | 检查名称唯一性 |
| `content_node/repository.py` | `count_children_batch` | 批量统计子节点数 |
| `content_node/service.py` | `move_node` | 移动节点 |
| `content_node/service.py` | `build_display_path` | 构建显示路径（向上遍历） |
| `content_node/service.py` | `_collect_node_info` | 收集子树信息（递归） |
| `content_node/service.py` | `_delete_recursive` | 递归删除 |
| `content_node/service.py` | `_build_id_path` | 构建 id_path |
| `sandbox_data.py` | `build_name_path` | 构建沙盒文件路径 |
| `sync_worker.py` | `_get_path` | 构建同步路径 |
| `filesystem/service.py` | `_list_all_files_recursive` | 递归列出文件 |
| `filesystem/service.py` | `_build_relative_path` | 构建相对路径 |
| `filesystem/service.py` | `_get_all_descendant_ids` | 获取所有子孙 ID |

### 已使用 `id_path` 的代码（不需改动）

| 文件 | 函数 | 用途 |
|------|------|------|
| `content_node/repository.py` | `get_by_id_path` | 按 id_path 精确查找 |
| `content_node/repository.py` | `list_descendants` | 列出子孙 |
| `content_node/repository.py` | `delete_by_id_path_prefix` | 按前缀删除 |
| `content_node/repository.py` | `update_children_id_path_prefix` | 移动时更新子孙路径 |
| `content_node/repository.py` | `list_by_project` | 按 id_path 排序列出项目节点 |
| `collaboration/version_service.py` | `create_folder_snapshot` | 收集子孙版本 |
| `search/service.py` | `index_folder` | 索引文件夹 |
