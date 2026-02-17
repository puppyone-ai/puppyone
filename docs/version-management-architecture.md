# 版本管理系统 — 架构设计文档

## 一、系统定位

版本管理系统是 ContextBase 平台的**基础设施层**，为 OverlayFS 多 Agent 协同架构打地基。

它解决三个核心问题：

| 问题 | 解决方式 |
|------|---------|
| Agent 改错了怎么办 | 任意文件、任意文件夹可回滚到历史版本 |
| 两个 Agent 同时改同一文件 | 乐观锁检测冲突 + 三方合并（需要历史快照作为 Base） |
| 谁在什么时候改了什么 | 完整的操作审计链 |

---

## 二、数据模型

### 2.1 表关系总览

```
content_nodes (主表 — 当前状态)
│
│  ● current_version = 3        "现在是第几版"
│  ● content_hash = "sha256:…"  "当前内容的指纹"
│  ● preview_json / preview_md / s3_key  "当前内容本体"
│
├──< file_versions (历史表 — 每个版本的完整快照)
│       │
│       │  ● version = 1, 2, 3…
│       │  ● content_json / content_text / s3_key  "该版本的完整内容"
│       │  ● content_hash  "该版本的内容指纹"
│       │  ● operator_type + operator_id  "谁改的"
│       │  ● operation  "什么操作（create/update/rollback/merge）"
│       │
│       └──> snapshot_id → folder_snapshots  "属于哪次批量操作"
│
└──< folder_snapshots (快照表 — 文件夹某一时刻的全貌)
        │
        │  ● file_versions_map = {"node_1": 3, "node_2": 1}  "每个文件当时的版本号"
        │  ● changed_files = ["node_1"]  "这次改了哪些文件"
        │  ● base_snapshot_id → 自引用  "基于哪个快照（三方合并的 Base）"
        │
        └──> agent_bash.permission  "Agent 的权限级别"
```

### 2.2 各表职责类比

| 表 | 类比 Git | 存什么 | 查询频率 |
|-----|---------|--------|---------|
| `content_nodes` | 工作目录 (working tree) | 最新版本的内容 | 极高（99% 的读） |
| `file_versions` | blob 对象 | 每个历史版本的完整内容 | 低（回滚/合并/审计时） |
| `folder_snapshots` | commit 对象 | 某一时刻所有文件的版本号组合 | 低（回滚/审计时） |
| `agent_bash` | .gitignore + 权限 | Agent 对文件的访问权限 | 中（每次 Agent 操作前检查） |

### 2.3 为什么 content_nodes 和 file_versions 存了"重复"的内容

`content_nodes.preview_json` 和 `file_versions` 最新一条的 `content_json` 内容相同。

这是**数据库反范式设计**的经典最佳实践：

```
读当前内容（99% 的操作）：
  SELECT preview_json FROM content_nodes WHERE id = 'xxx'
  → 一次查询，零 JOIN

如果不冗余（纯范式）：
  SELECT fv.content_json
  FROM content_nodes cn
  JOIN file_versions fv ON fv.node_id = cn.id AND fv.version = cn.current_version
  WHERE cn.id = 'xxx'
  → 每次多一个 JOIN，所有 9 张依赖表的查询都变慢
```

**用少量写入冗余，换大量读取性能。** Notion、WordPress、Confluence 都用同一模式。

---

## 三、表结构详细定义

### 3.1 content_nodes（修改，加 2 个字段）

```sql
ALTER TABLE content_nodes
    ADD COLUMN current_version INT NOT NULL DEFAULT 0,
    ADD COLUMN content_hash TEXT;
```

| 新字段 | 类型 | 说明 |
|--------|------|------|
| `current_version` | INT | 当前版本号，每次修改 +1，乐观锁核心字段 |
| `content_hash` | TEXT | 当前内容的 SHA-256，用于变更检测和 S3 去重 |

其余字段不变：`preview_json`、`preview_md`、`s3_key` 继续存当前最新内容。

### 3.2 file_versions（新建）

```sql
CREATE TABLE file_versions (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    node_id         TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
    version         INT NOT NULL,

    -- 内容快照（三选一，根据文件类型）
    content_json    JSONB,          -- JSON 文件
    content_text    TEXT,           -- Markdown / 文本文件
    s3_key          TEXT,           -- 大文件 / 二进制（S3 版本路径）

    -- 元数据
    content_hash    TEXT NOT NULL,  -- SHA-256
    size_bytes      BIGINT NOT NULL DEFAULT 0,

    -- 关联
    snapshot_id     BIGINT REFERENCES folder_snapshots(id) ON DELETE SET NULL,

    -- 操作者
    operator_type   TEXT NOT NULL,  -- 'user' / 'agent' / 'system' / 'sync'
    operator_id     TEXT,           -- user_id 或 agent_id
    session_id      TEXT,           -- 聊天会话 ID

    -- 操作
    operation       TEXT NOT NULL,  -- 'create' / 'update' / 'delete' / 'rollback' / 'merge'
    merge_strategy  TEXT,           -- 'diff3' / 'lww' / 'crdt' / 'manual'
    summary         TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(node_id, version)
);
```

**内容字段三选一规则：**

| 文件类型 | 使用字段 | 存储位置 |
|---------|---------|---------|
| JSON (< 256KB) | `content_json` | PG（直接存） |
| Markdown / 文本 | `content_text` | PG（直接存） |
| PDF / 图片 / 视频等大文件 | `s3_key` | S3（PG 只存路径） |

**S3 版本路径格式：**

```
s3://contextbase/versions/{node_id}/v{version}/{filename}

示例：
s3://contextbase/versions/abc123/v1/report.pdf
s3://contextbase/versions/abc123/v2/report.pdf
```

S3 对象一旦写入不会被覆盖（不可变）。回滚时只需把 `content_nodes.s3_key` 指回旧路径。

### 3.3 folder_snapshots（新建）

```sql
CREATE TABLE folder_snapshots (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    folder_node_id      TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,

    -- 快照内容
    file_versions_map   JSONB NOT NULL,     -- {"node_id": version, ...}
    changed_files       JSONB,              -- ["node_id_1", "node_id_3"]
    files_count         INT NOT NULL DEFAULT 0,
    changed_count       INT NOT NULL DEFAULT 0,

    -- 操作者
    operator_type       TEXT NOT NULL,
    operator_id         TEXT,
    session_id          TEXT,

    -- 操作
    operation           TEXT NOT NULL,       -- 'agent_merge' / 'user_save' / 'rollback' / 'sync' / 'import'
    summary             TEXT,

    -- 三方合并基准
    base_snapshot_id    BIGINT REFERENCES folder_snapshots(id) ON DELETE SET NULL,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**`file_versions_map` 格式示例：**

```json
{
  "node_abc": 3,
  "node_def": 1,
  "node_ghi": 5
}
```

含义：在这个快照时刻，`node_abc` 是 v3，`node_def` 是 v1，`node_ghi` 是 v5。

### 3.4 agent_bash（修改，权限升级）

```sql
ALTER TABLE agent_bash
    ADD COLUMN permission TEXT NOT NULL DEFAULT 'r';
```

| 权限 | 含义 | 允许的操作 |
|------|------|-----------|
| `r` | 只读 | 读 |
| `ra` | 只读 + 追加 | 读、新建文件（不可改/删已有文件） |
| `rw-` | 读写受限 | 读、写、改（不可删除） |
| `rw` | 完全读写 | 读、写、改、删 |

---

## 四、核心操作流程

### 4.1 写入流程（Agent 修改文件后写回）

```
Agent 在沙盒中修改了 config.json
    │
    ▼
① 计算 content_hash (SHA-256)
    │
    ▼
② 乐观锁检查
   读取 content_nodes.current_version
   if 版本号 != 预期 → 抛出冲突异常
    │
    ▼
③ 判断内容是否真的变了
   if new_hash == old_hash → 跳过（不创建新版本）
    │
    ▼
④ 创建新版本 (file_versions)
   调用 next_version(node_id) 原子递增版本号
   INSERT INTO file_versions (node_id, version, content_json, ...)
    │
    ▼
⑤ 更新主表 (content_nodes)
   UPDATE content_nodes SET
     preview_json = 新内容,
     current_version = 新版本号,
     content_hash = 新 hash,
     updated_at = NOW()
    │
    ▼
⑥ 如果是批量操作（Agent 改了多个文件）
   创建 folder_snapshot，把所有 file_version 关联到同一个 snapshot_id
```

### 4.2 单文件回滚

```
用户要求回滚 config.json 到 v2
    │
    ▼
① 从 file_versions 取 (node_id, version=2) 的完整快照
    │
    ▼
② 创建新版本 v4（内容 = v2 的内容，版本号递增）
   INSERT INTO file_versions (
     node_id, version=4, content_json=v2的内容,
     operation='rollback', summary='Rollback to v2'
   )
    │
    ▼
③ 更新 content_nodes 指向新版本
   UPDATE content_nodes SET
     preview_json = v2 的内容,
     current_version = 4
```

版本号只增不减：`v1 → v2 → v3 → v4(回滚到v2的内容)`

### 4.3 文件夹回滚

```
用户要求回滚 workspace/ 到快照 #2
    │
    ▼
① 读取目标快照 #2 的 file_versions_map
   {"a.json": 2, "b.md": 1, "report.pdf": 1}
    │
    ▼
② 读取当前各文件的版本号
   {"a.json": 2, "b.md": 2, "report.pdf": 2}
    │
    ▼
③ 对比，找出需要回滚的文件
   a.json:     2 → 2  (不变，跳过)
   b.md:       2 → 1  (需要回滚)
   report.pdf: 2 → 1  (需要回滚，S3 文件)
    │
    ▼
④ 逐个回滚需要变更的文件

   b.md（PG 文件）：
     取 file_versions (b.md, v1) → content_text = 原始文本
     创建 v3，内容 = v1 的内容
     更新 content_nodes.preview_md = 原始文本

   report.pdf（S3 文件）：
     取 file_versions (report.pdf, v1) → s3_key = "versions/report/v1/report.pdf"
     创建 v3，s3_key = 同一个 S3 路径（零拷贝！不复制文件）
     更新 content_nodes.s3_key = "versions/report/v1/report.pdf"
    │
    ▼
⑤ 创建新的 folder_snapshot #4
   file_versions_map = {"a.json": 2, "b.md": 3, "report.pdf": 3}
   operation = 'rollback'
   summary = 'Rollback to snapshot #2, 2 files restored'
```

### 4.4 S3 文件版本管理

**写入时：**

```
新文件上传
    │
    ▼
计算 SHA-256 hash
    │
    ├── hash 已存在于该 node 的历史版本中
    │   → 复用旧 S3 对象（不重复上传）
    │
    └── hash 不存在（新内容）
        → 上传到 s3://contextbase/versions/{node_id}/v{n}/{name}
        → 旧版本的 S3 对象保留不动（不可变存储）
```

**回滚时：**

```
回滚 report.pdf 到 v1
    │
    ▼
读取 file_versions (report.pdf, v1)
→ s3_key = "versions/report/v1/report.pdf"
    │
    ▼
更新 content_nodes.s3_key = "versions/report/v1/report.pdf"
（S3 上不做任何操作，零拷贝，毫秒完成）
```

**清理策略（三道防线）：**

| 防线 | 时机 | 机制 |
|------|------|------|
| content_hash 去重 | 写入时 | 相同内容不重复上传 S3 |
| 保留策略 | 定时任务 | 7天内全保留 → 30天内每天最后一版 → 90天内每周最后一版 → 更早只保留首末 |
| S3 生命周期 | 自动 | 30天后降为低频存储 → 90天后归档 → 365天后删除 |

---

## 五、乐观锁机制

### 5.1 什么是乐观锁

```
不加锁，各自写。写入时检查版本号是否匹配，不匹配 = 有人抢先改了 = 冲突。
```

### 5.2 流程

```
Agent A 读取 config.json：current_version = 3
Agent B 读取 config.json：current_version = 3

Agent A 写入：
  检查 current_version == 3 ✅
  → 写入成功，current_version 变为 4

Agent B 写入：
  检查 current_version == 3 ❌（已经是 4 了）
  → 抛出冲突异常
  → 进入冲突解决流程
```

### 5.3 原子版本号递增

```sql
-- PG 函数：原子递增版本号
CREATE FUNCTION next_version(p_node_id TEXT) RETURNS INT AS $$
  UPDATE content_nodes
  SET current_version = current_version + 1, updated_at = NOW()
  WHERE id = p_node_id
  RETURNING current_version;
$$ LANGUAGE sql;
```

`UPDATE ... RETURNING` 是原子操作，不会出现两个请求拿到相同版本号。

---

## 六、与 OverlayFS Merge Daemon 的配合

### 6.1 Agent 启动时

```
Merge Daemon 记录：Agent A 基于 folder_snapshot #5 开始工作

Agent A 的沙盒挂载：
  Lower = snapshot #5 对应的文件内容
  Upper = 空（Agent 的改动会写入这里）
```

### 6.2 Agent 完成后

```
Merge Daemon 扫描 Agent A 的 Upper 目录
    │
    ▼
发现 3 个文件有改动：a.json, b.md, c.pdf
    │
    ▼
对每个文件做三方合并：
  Base   = snapshot #5 中该文件的版本（从 file_versions 取）
  Ours   = 当前最新版本（content_nodes 中的内容）
  Theirs = Agent A 在 Upper 中的改动
    │
    ├── Base == Ours（没有其他人改过）→ 直接采用 Theirs
    ├── Base == Theirs（Agent 没改）→ 跳过
    ├── Ours == Theirs（改成一样的）→ 跳过
    └── 三方都不同 → 按文件类型选择合并算法
        ├── .json / .md → Git diff3 三方合并
        ├── .pdf / 二进制 → Last-Writer-Wins
        └── 关键文件 → 进审核队列
    │
    ▼
合并完成：
  创建 3 个 file_version 记录
  创建 1 个 folder_snapshot（base_snapshot_id = #5）
  更新 content_nodes 中 3 个文件的当前内容
  清空 Agent A 的 Upper 目录
```

---

## 七、权限系统

### 7.1 四级权限

| 权限 | 代码 | 读 | 新建 | 修改 | 删除 |
|------|------|-----|------|------|------|
| 只读 | `r` | ✅ | ❌ | ❌ | ❌ |
| 只读+追加 | `ra` | ✅ | ✅ | ❌ | ❌ |
| 读写受限 | `rw-` | ✅ | ✅ | ✅ | ❌ |
| 完全读写 | `rw` | ✅ | ✅ | ✅ | ✅ |

### 7.2 权限执行位置

```
Agent 在沙盒内执行命令（OverlayFS 不管权限，任何写都会落到 Upper）
    │
    ▼
Merge Daemon 扫描 Upper
    │
    ▼
对每个改动文件查 PG 权限表：
    │
    ├── Agent 对该文件有 'rw' 权限 → 允许合并
    ├── Agent 对该文件有 'rw-' 但操作是删除 → 拒绝
    ├── Agent 对该文件有 'ra' 但修改了已有文件 → 拒绝
    ├── Agent 对该文件有 'r' → 拒绝所有写入
    │
    └── 拒绝的改动：
        删除 Upper 中的该文件
        通知 Agent："权限不足，改动已撤销"
```

---

## 八、存储成本分析

### 8.1 PG 存储（JSON / Markdown 文件）

| 场景 | 平均文件大小 | 每月改动次数 | 月新增 | 年累计 |
|------|------------|------------|--------|--------|
| 100 个 JSON 文件 | 50KB | 20 次/文件 | 100MB | 1.2GB |
| 50 个 Markdown 文件 | 10KB | 10 次/文件 | 5MB | 60MB |

PG 存储在 Supabase 免费额度内（500MB），Pro 计划 8GB，远远够用。

### 8.2 S3 存储（大文件）

| 场景 | 平均文件大小 | 每月改动次数 | 月新增 | S3 月成本 |
|------|------------|------------|--------|----------|
| 无清理 | 10MB | 5 次/文件 | 5GB | $0.12 |
| + hash 去重 | 10MB | 5 次（40%重复） | 3GB | $0.07 |
| + 保留策略 | 10MB | 滚动保留 | ~5GB | $0.03 |

### 8.3 回滚成本

| 操作 | I/O 量 | 耗时 |
|------|--------|------|
| 回滚 JSON 文件 | 0（PG 内操作） | ~毫秒 |
| 回滚 Markdown 文件 | 0（PG 内操作） | ~毫秒 |
| 回滚 S3 大文件 | 0（只改 PG 指针，S3 零拷贝） | ~毫秒 |
| 回滚整个文件夹（100 文件） | 0（批量改 PG 指针） | ~几十毫秒 |

---

## 九、迁移方案

### 9.1 数据库迁移

SQL 迁移文件：`backend/sql/migrations/2026-02-15_add_version_management.sql`

执行顺序：
1. ALTER `content_nodes` — 加 `current_version`、`content_hash`
2. ALTER `agent_bash` — 加 `permission` 字段
3. CREATE `file_versions` — 文件级版本历史表
4. CREATE `folder_snapshots` — 文件夹级快照表
5. 数据迁移 — 现有数据初始化为 v1
6. RLS 策略 — service_role 全权访问
7. 辅助函数 — `next_version()` 原子递增

### 9.2 应用层改造

| 模块 | 改动 |
|------|------|
| `content_node/service.py` | 所有写操作改为"创建新版本 → 更新主表" |
| `content_node/repository.py` | 新增 `file_versions`、`folder_snapshots` 的 CRUD |
| `agent/service.py` | 沙盒写回改为版本化写入 |
| `content_node/router.py` | 新增版本历史 API 和回滚 API |

### 9.3 新增 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/nodes/{id}/versions` | GET | 查看文件版本历史 |
| `/api/v1/nodes/{id}/versions/{version}` | GET | 获取某个历史版本的内容 |
| `/api/v1/nodes/{id}/rollback/{version}` | POST | 回滚文件到指定版本 |
| `/api/v1/nodes/{id}/diff/{v1}/{v2}` | GET | 对比两个版本的差异 |
| `/api/v1/folders/{id}/snapshots` | GET | 查看文件夹快照历史 |
| `/api/v1/folders/{id}/rollback/{snapshot_id}` | POST | 回滚文件夹到指定快照 |

---

## 十、后续扩展路径

```
阶段 0（本文档）                阶段 1                    阶段 2                  阶段 3
版本管理 + 乐观锁        →     OverlayFS 改造      →    Merge Daemon        →   加固优化
                               + Sync Daemon             + 冲突解决               + CRDT
file_versions                  Lower/Upper 分层          三方合并 (diff3)          Docker 安全加固
folder_snapshots               增量挂载替代全量复制       权限检查                   监控告警
content_hash 去重              Docker 改造                审核队列                  S3 生命周期
乐观锁 (current_version)      E2B 降级兼容               PG NOTIFY 通知           性能优化
```

---

*本文档描述 ContextBase 版本管理系统的架构设计，是 Agent Context Base 技术方案（`agent-context-base-report.md`）的阶段 0 实施细节。*
