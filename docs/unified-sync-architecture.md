# Unified Sync Architecture

> 涉及模块：backend/src/sync, backend/src/agent, backend/src/access (兼容层), frontend/
> 最后更新：2026-02-24

---

## 1. 背景与动机

### 1.1 产品定位

PuppyOne 是一个 **file-based workspace built for agents**，核心价值在于：

- **多信息源接入**：Google Sheets、GitHub、Gmail、Supabase 等外部数据同步到 workspace
- **多信息源分发**：workspace 数据同步到 OpenClaw VM、Sandbox、MCP 端点等外部系统

### 1.2 当前架构的问题

当前架构将同一个概念（外部系统与 workspace 的数据交互）拆成了 **5 套独立系统**：

| 系统 | 职责 | 核心对象 |
|------|------|---------|
| OAuth | 平台授权 | `oauth_connection` |
| Ingest/Connect | 一次性导入 | `sync_task` + `content_nodes.type=信息源` |
| Sync | 持续双向同步 | `sync_sources` + `sync_mappings` + `sync_changelog` |
| Access | 外部交互/分发 | `agents` + `agent_bash` + `agent_tool` |
| ETL Worker | 文件后处理 | ARQ queue + `content_nodes` 更新 |

**核心矛盾**：

1. **`content_nodes.type` 双重职责**：既表示文件格式（json/markdown/file），又表示信息来源（github/gmail/google_sheets）。一个从 Google Sheets 导入的节点 `type='google_sheets'` 而非 `type='json'`，即便内容就是 JSON。信息源变成了文件身份的一部分。

2. **Connect 和 Access 是两套独立系统**：Connect 创建带信息源类型的 content_node，Access 通过 Agent 配置文件访问权限。两者共享 OAuth 但其他完全独立——不同的数据模型、不同的状态管理、不同的代码路径。

3. **Agent 承担过多角色**：所有外部访问必须经过 Agent（OpenClaw 连接需要创建 Agent、MCP 暴露需要创建 Agent）。有些 "Agent" 其实只是同步通道，有些才是真正的 AI 聊天代理。

4. **概念不对称**：输入（Connect）是文件属性，输出（Access）是外部配置。用户要理解一个文件的完整外部关系，需要看三个地方。

### 1.3 设计目标

将 Connect 和 Access 统一为 **Sync**——一个挂载在文件/文件夹上的外部同步进程。

**核心原则**：

- **文件就是文件**：`content_nodes.type` 只表示文件格式，不携带信息源信息
- **Sync 是进程不是属性**：外部连接是独立对象，可以随时挂载/卸载，不改变文件本身
- **PuppyOne 是仲裁者**：所有数据写入都经过 PuppyOne，冲突在 PuppyOne 层解决
- **Authority 模型**：通过"权威源"机制预防冲突，而非事后解决冲突

---

## 2. 统一 Sync 模型

### 2.1 三种同步方向

所有外部数据交互归结为三种方向：

```
方向 1: Inbound（外部 → PuppyOne）
  外部系统是权威源，PuppyOne 是消费者
  例：Google Sheets, Supabase, GitHub, Gmail, Google Calendar

方向 2: Outbound（PuppyOne → 外部）
  PuppyOne 是权威源，外部是消费者
  例：Readable sandbox, Webhook 推送, MCP publish

方向 3: Bidirectional（PuppyOne ↔ 外部）
  两边都能写，需要冲突解决
  例：OpenClaw VM 同步, 全功能沙盒
```

### 2.2 Sync 对象定义

每个 Sync 代表一个 **外部系统与 workspace 节点之间的同步关系**：

```
Sync {
  id              TEXT PK
  project_id      TEXT FK → projects
  node_id         TEXT FK → content_nodes    -- 挂载点（文件或文件夹）

  -- 同步定义
  direction       'inbound' | 'outbound' | 'bidirectional'
  provider        'google_sheets' | 'openclaw' | 'github' | 'supabase' | ...
  authority       'authoritative' | 'mirror'

  -- 适配器配置
  config          JSONB           -- 适配器特定配置
  credentials_ref TEXT            -- FK to oauth_connection（可选）

  -- 冲突策略
  conflict_strategy  'source_wins' | 'three_way_merge' | 'lww'

  -- 运行时状态
  status          'active' | 'paused' | 'error' | 'syncing'
  cursor          BIGINT          -- 增量同步游标
  last_synced_at  TIMESTAMPTZ
  error_message   TEXT

  created_at, updated_at
}
```

### 2.3 Authority 字段

`authority` 是整个模型的关键字段：

| authority 值 | 含义 | 行为 |
|---|---|---|
| `authoritative` | 该 Sync 是这个文件的**权威源** | 外部数据无条件覆盖本地；其他写入者被拒绝 |
| `mirror` | 该 Sync 只是**镜像/分发通道** | 尊重权威源的决定；无权威源时参与标准冲突解决 |

**默认值规则**：

| direction | 默认 authority | 原因 |
|---|---|---|
| `inbound` | `authoritative` | 外部系统提供数据，是天然的权威源 |
| `outbound` | `mirror` | 只是分发，不是数据来源 |
| `bidirectional` | `mirror` | 双方平等，除非用户显式指定 |

---

## 3. 组合与冲突解决

### 3.1 核心问题

当多个 Sync 作用于同一个文件时，如何解决写入冲突？

**典型场景**：

```
Google Sheets ──(inbound)──→ folder/budget.json
                                    │
Supabase ──────(inbound)──→ folder/users.json
                                    │
                              folder/ ←──(bidirectional)──→ OpenClaw
                              ├── budget.json  (来自 Google Sheets)
                              ├── users.json   (来自 Supabase)
                              ├── notes.md     (本地创建)
                              └── report.json  (OpenClaw 创建)
```

文件夹有一个 bidirectional sync（OpenClaw），其中的个别文件又有自己的 inbound sync（Google Sheets、Supabase）。两层写入如何共存？

### 3.2 Authority 组合规则

**规则 1：一个文件最多一个 authoritative Sync**

数据库层面通过 partial unique index 强制保证：

```sql
CREATE UNIQUE INDEX idx_syncs_one_authority_per_node
  ON syncs (node_id) WHERE authority = 'authoritative';
```

尝试为已有 authoritative Sync 的文件创建第二个 authoritative Sync 时，数据库直接拒绝。

**规则 2：文件级 Sync 优先于文件夹级 Sync（特指覆盖泛指）**

当判断一个文件的写入权限时：

```
budget.json 上直接挂载的 Sync:
  → Google Sheets (inbound, authoritative)  ← 文件级，优先

budget.json 的父文件夹上挂载的 Sync:
  → OpenClaw (bidirectional, mirror)        ← 文件夹级，被覆盖

结论：budget.json 的权威源是 Google Sheets
      OpenClaw 对 budget.json 只有读权限
```

**规则 3：无 authoritative Sync 的文件，所有写入者平等竞争**

```
notes.md 上没有直接挂载的 authoritative Sync
  → 所有 bidirectional Sync 可以自由读写
  → 冲突走 CollaborationService 标准流程（三方合并 / LWW）
```

### 3.3 Authority 解析流程

```
写入请求到达 (node_id, content, writer_sync_id)
    │
    ▼
查找 node_id 上所有 authoritative Sync
    │
    ├── 没有 authoritative Sync
    │     → 允许写入
    │     → 走 CollaborationService.commit() 标准冲突解决
    │
    └── 有 authoritative Sync
          │
          ├── writer_sync_id == authoritative Sync 的 id
          │     → 允许写入（权威源自己在写）
          │
          └── writer_sync_id != authoritative Sync 的 id
                → 拒绝写入 (409 Conflict)
                → 返回 { error: "authority_conflict",
                         managed_by: "google_sheets",
                         sync_id: "xxx" }
```

### 3.4 各场景下的具体行为

#### 场景 A：Inbound Sync 更新文件

```
Google Sheets 数据变更
  → SaaS Worker 拉取新数据
  → check_write_authority(budget.json, google_sheets_sync_id)
  → 权威源自己在写 → 允许
  → CollaborationService.commit(budget.json, new_content)
  → 全量覆盖（inbound authoritative = 外部说了算）
  → VersionService → sync_changelog → ChangeNotifier
  → OpenClaw Long Poll 收到通知 → pull → 更新本地文件
```

#### 场景 B：Bidirectional Sync 写入有权威源的文件

```
OpenClaw push budget.json
  → check_write_authority(budget.json, openclaw_sync_id)
  → budget.json 有 authoritative Sync (Google Sheets)
  → openclaw_sync_id ≠ google_sheets_sync_id
  → 拒绝写入 (409)
  → CLI 收到 409 → 不修改本地 → 日志提示
```

OpenClaw CLI 行为：文件正常存在于本地，但 CLI 忽略对它的本地修改（不推送到云端）。

#### 场景 C：两个 Bidirectional Sync 写入无权威源的文件

```
OpenClaw 编辑 notes.md (base_version=5)
Web UI 同时编辑 notes.md (base_version=5)
  → 两个写入都通过 authority 检查（无权威源）
  → 都到达 CollaborationService.commit()
  → 先到的成功 (version 5→6)
  → 后到的检测到 base_version 不匹配
  → 触发三方合并
  → 合并成功 → version 6→7
  → 或合并失败 → LWW fallback
```

#### 场景 D：用户脱钩权威源

```
用户暂停/删除 budget.json 上的 Google Sheets Sync
  → budget.json 不再有 authoritative Sync
  → OpenClaw 可以自由写入
  → 文件类型不变（仍然是 'json'）
  → 内容不变（保留最后一次同步的数据）
  → 版本历史保留
```

---

## 4. 完整表结构设计

### 4.1 表结构总览：重构前 vs 重构后

```
重构前（27+ 张表，sync 相关 6 张）          重构后
─────────────────────────────           ─────────────────────────────
content_nodes (含 10+ sync 字段)        content_nodes (精简，纯文件系统)
sync_sources                    ──┐
sync_mappings (已合并到 nodes)    ──┼──→ syncs (统一同步关系表，持久化配置)
sync_task                       ──┘
etl_task                        ──┐
import_task                     ──┼──→ uploads (一次性上传/导入任务)
search_index_task               ──┘
sync_changelog                  ────→ sync_changelog (保留不变)
file_versions                   ────→ file_versions (保留不变)
folder_snapshots                ────→ folder_snapshots (保留不变)
```

**Upload 与 Sync 的区别**：

| | Upload | Sync |
|---|---|---|
| 本质 | 一次性任务：开始 → 处理 → 完成 | 持久化配置：创建后一直活着 |
| 用户关心 | "处理完了吗？" | "同步健康吗？" |
| 状态住在 | `uploads` 表（任务本身就是主体） | `syncs` 表自身（status/last_synced_at/error） |
| 触发 | 用户主动操作 | 系统调度（定时/webhook/realtime） |

---

### 4.2 `content_nodes` — 精简后

**设计原则**：`content_nodes` 只负责文件系统语义——树形结构、内容存储、版本管理。所有 sync 相关的状态移出到 `syncs` 表。

```sql
CREATE TABLE content_nodes (
    -- ========== 核心身份 ==========
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    project_id          TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- ========== 树形结构 ==========
    parent_id           TEXT REFERENCES content_nodes(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,            -- POSIX 文件名 (max 255, 无 / 和控制字符)
    id_path             TEXT NOT NULL DEFAULT '/',-- 物化路径 /uuid1/uuid2/uuid3

    -- ========== 类型（仅原生类型） ==========
    type                TEXT NOT NULL,            -- 'folder' | 'json' | 'markdown' | 'file'

    -- ========== 内容存储（三选一） ==========
    preview_json        JSONB,                    -- JSON 类型的内容
    preview_md          TEXT,                     -- Markdown 类型的内容
    s3_key              TEXT,                     -- 二进制文件的 S3 路径

    -- ========== 文件元数据 ==========
    mime_type           TEXT,
    size_bytes          BIGINT NOT NULL DEFAULT 0,
    permissions         JSONB NOT NULL DEFAULT '{"inherit": true}'::JSONB,

    -- ========== 版本管理 ==========
    current_version     INT NOT NULL DEFAULT 0,   -- 乐观锁版本号
    content_hash        TEXT,                     -- SHA-256 内容哈希

    -- ========== 时间戳 ==========
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE UNIQUE INDEX idx_content_nodes_unique_name
    ON content_nodes (project_id, COALESCE(parent_id, '__root__'), name);
CREATE INDEX idx_content_nodes_project_id ON content_nodes(project_id);
CREATE INDEX idx_content_nodes_parent_id  ON content_nodes(parent_id);
CREATE INDEX idx_content_nodes_type       ON content_nodes(type);
CREATE INDEX idx_content_nodes_id_path    ON content_nodes(id_path);

-- 类型约束
ALTER TABLE content_nodes
    ADD CONSTRAINT chk_content_nodes_type
    CHECK (type IN ('folder', 'json', 'markdown', 'file'));
```

**对比：移除了哪些字段**

| 移除的字段 | 原用途 | 迁移到 |
|-----------|--------|--------|
| `sync_url` | 导入来源 URL | `syncs.config->>'url'` |
| `sync_id` | 外部平台资源 ID | `syncs.config->>'external_id'` |
| `sync_config` | 同步配置 | `syncs.config` |
| `sync_status` | 同步状态 | `syncs.status` |
| `sync_oauth_user_id` | OAuth 用户 | `syncs.credentials_ref` |
| `last_synced_at` | 上次同步时间 | `syncs.last_synced_at` |
| `sync_source_id` | FK → sync_sources | `syncs.id` (反转关系) |
| `external_resource_id` | 外部资源标识 | `syncs.config->>'external_resource_id'` |
| `remote_hash` | 外部内容哈希 | `syncs.remote_hash` |
| `last_sync_version` | 上次同步版本 | `syncs.last_sync_version` |

---

### 4.3 `syncs` — 统一同步关系表（新建）

**设计原则**：一条 `syncs` 记录 = 一个外部系统与一个 workspace 节点之间的同步关系。替代 `sync_sources` + `sync_mappings` + `content_nodes` 上的 sync 字段 + `sync_task` 的配置部分。

```sql
CREATE TABLE syncs (
    -- ========== 核心身份 ==========
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    project_id          TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    node_id             TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,

    -- ========== 同步定义 ==========
    direction           TEXT NOT NULL,             -- 'inbound' | 'outbound' | 'bidirectional'
    provider            TEXT NOT NULL,             -- 见下方 Provider 枚举
    authority           TEXT NOT NULL DEFAULT 'mirror', -- 'authoritative' | 'mirror'

    -- ========== 适配器配置 ==========
    config              JSONB NOT NULL DEFAULT '{}',
    -- config 内容因 provider 而异，示例:
    --   google_sheets: {"spreadsheet_id": "...", "url": "...", "sheet_names": [...]}
    --   openclaw:      {"workspace_path": "~/...", "recursive": true}
    --   github:        {"repo": "owner/repo", "branch": "main", "path_filter": "docs/"}
    --   webhook:       {"url": "https://...", "events": ["create","update"], "secret": "..."}

    -- ========== 认证 ==========
    credentials_ref     TEXT,                      -- FK → oauth_connection.id (SaaS 类)
    access_key          TEXT,                      -- 独立 access key (OpenClaw CLI / MCP)

    -- ========== 触发策略 ==========
    trigger             JSONB NOT NULL DEFAULT '{"type": "manual"}',
    -- trigger 类型:
    --   {"type": "manual"}                       一次性/手动触发
    --   {"type": "polling", "interval_seconds": 3600}  定时轮询
    --   {"type": "webhook"}                      外部 webhook 触发
    --   {"type": "realtime"}                     长连接实时同步 (OpenClaw)

    -- ========== 冲突策略 ==========
    conflict_strategy   TEXT NOT NULL DEFAULT 'three_way_merge',
    -- 'source_wins'       : inbound 权威源覆盖
    -- 'three_way_merge'   : 三方合并 (CollaborationService)
    -- 'lww'               : Last-writer-wins

    -- ========== 运行时状态 ==========
    status              TEXT NOT NULL DEFAULT 'active',
    -- 'active'   : 正常运行
    -- 'paused'   : 用户暂停
    -- 'error'    : 上次同步出错
    -- 'syncing'  : 正在同步中

    -- ========== 同步游标 ==========
    cursor              BIGINT DEFAULT 0,          -- sync_changelog 的增量游标
    last_synced_at      TIMESTAMPTZ,
    error_message       TEXT,

    -- ========== 远端状态跟踪（双向同步用） ==========
    remote_hash         TEXT,                      -- 外部内容的 SHA-256
    last_sync_version   INT NOT NULL DEFAULT 0,    -- 上次同步时 PuppyOne 的 current_version

    -- ========== 时间戳 ==========
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ========== 核心约束 ==========

-- 每个节点最多一个 authoritative sync
CREATE UNIQUE INDEX idx_syncs_one_authority_per_node
    ON syncs (node_id) WHERE authority = 'authoritative';

-- access_key 唯一（用于 CLI 认证）
CREATE UNIQUE INDEX idx_syncs_access_key
    ON syncs (access_key) WHERE access_key IS NOT NULL;

-- ========== 查询索引 ==========
CREATE INDEX idx_syncs_project   ON syncs (project_id);
CREATE INDEX idx_syncs_node      ON syncs (node_id);
CREATE INDEX idx_syncs_provider  ON syncs (provider);
CREATE INDEX idx_syncs_status    ON syncs (status) WHERE status = 'active';

-- ========== 约束 ==========
ALTER TABLE syncs ADD CONSTRAINT chk_syncs_direction
    CHECK (direction IN ('inbound', 'outbound', 'bidirectional'));
ALTER TABLE syncs ADD CONSTRAINT chk_syncs_authority
    CHECK (authority IN ('authoritative', 'mirror'));
ALTER TABLE syncs ADD CONSTRAINT chk_syncs_status
    CHECK (status IN ('active', 'paused', 'error', 'syncing'));
ALTER TABLE syncs ADD CONSTRAINT chk_syncs_conflict_strategy
    CHECK (conflict_strategy IN ('source_wins', 'three_way_merge', 'lww'));
```

**Provider 枚举**（可扩展，不做 CHECK 约束）：

| provider | direction | 说明 |
|----------|-----------|------|
| `google_sheets` | inbound | Google Sheets 导入 |
| `google_docs` | inbound | Google Docs 导入 |
| `google_calendar` | inbound | Google Calendar 导入 |
| `google_drive` | inbound | Google Drive 导入 |
| `gmail` | inbound | Gmail 导入 |
| `github` | inbound | GitHub repo/issues 导入 |
| `notion` | inbound | Notion 导入 |
| `airtable` | inbound | Airtable 导入 |
| `linear` | inbound | Linear 导入 |
| `supabase` | inbound | Supabase 数据库导入 |
| `url` | inbound | URL 抓取（Firecrawl） |
| `openclaw` | bidirectional | OpenClaw CLI 双向同步 |
| `sandbox` | bidirectional | 沙盒执行环境 |
| `webhook` | outbound | Webhook 推送 |
| `mcp_publish` | outbound | MCP 端点发布 |

---

### 4.4 `uploads` — 一次性上传/导入任务表（新建，替代 etl_task + sync_task + import_task + search_index_task）

**设计原则**：`uploads` 只负责一次性操作（上传处理、一次性导入、索引构建）。持久化同步的状态直接在 `syncs` 表上，不需要额外的任务表。

```sql
CREATE TABLE uploads (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id      TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    node_id         TEXT REFERENCES content_nodes(id) ON DELETE SET NULL,

    type            TEXT NOT NULL,
    -- 'file_ocr'         : 文件上传 OCR 阶段
    -- 'file_postprocess' : 文件上传 LLM 后处理
    -- 'import'           : 一次性 SaaS/URL 数据导入
    -- 'search_index'     : 搜索索引构建

    config          JSONB NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'pending',
    -- 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    progress        INT NOT NULL DEFAULT 0,
    message         TEXT,
    error           TEXT,

    result_node_id  TEXT REFERENCES content_nodes(id) ON DELETE SET NULL,
    result          JSONB,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);
```

**旧表 → 新表映射**：

| 旧表 | `uploads.type` |
|------|----------------|
| `etl_task` | `'file_ocr'` / `'file_postprocess'` |
| `sync_task` / `import_task` | `'import'` |
| `search_index_task` | `'search_index'` |

---

### 4.5 `sync_changelog` — 保留不变

```sql
-- 已有表，不做修改
CREATE TABLE sync_changelog (
    id          BIGSERIAL   PRIMARY KEY,          -- 全局递增序列，即 cursor
    project_id  TEXT        NOT NULL,
    node_id     TEXT        NOT NULL,
    action      TEXT        NOT NULL DEFAULT 'update',  -- 'create' | 'update' | 'delete'
    node_type   TEXT,
    version     INT         NOT NULL DEFAULT 0,
    hash        TEXT,
    size_bytes  BIGINT      DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 4.6 版本管理表 — 保留不变

```sql
-- file_versions: 文件级版本历史（已有，不做修改）
CREATE TABLE file_versions (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    node_id         TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
    version         INT NOT NULL,
    content_json    JSONB,
    content_text    TEXT,
    s3_key          TEXT,
    content_hash    TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    snapshot_id     BIGINT REFERENCES folder_snapshots(id) ON DELETE SET NULL,
    operator_type   TEXT NOT NULL,       -- 'user' | 'agent' | 'system' | 'sync'
    operator_id     TEXT,
    session_id      TEXT,
    operation       TEXT NOT NULL,       -- 'create' | 'update' | 'delete' | 'rollback' | 'merge'
    merge_strategy  TEXT,
    summary         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(node_id, version)
);

-- folder_snapshots: 文件夹级快照（已有，不做修改）
CREATE TABLE folder_snapshots (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    folder_node_id      TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
    file_versions_map   JSONB NOT NULL,
    changed_files       JSONB,
    files_count         INT NOT NULL DEFAULT 0,
    changed_count       INT NOT NULL DEFAULT 0,
    operator_type       TEXT NOT NULL,
    operator_id         TEXT,
    session_id          TEXT,
    operation           TEXT NOT NULL,
    summary             TEXT,
    base_snapshot_id    BIGINT REFERENCES folder_snapshots(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### 4.7 Agent 相关表 — 保留，微调

```sql
-- agents: 保留，移除同步通道职责
CREATE TABLE agents (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    icon            TEXT NOT NULL DEFAULT '✨',
    type            TEXT NOT NULL DEFAULT 'chat',   -- 'chat' | 'devbox' | 'webhook' | 'schedule'
    description     TEXT,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    mcp_api_key     TEXT,                           -- MCP 访问密钥（Agent 级别的，独立于 Sync）
    trigger_type    TEXT DEFAULT 'manual',
    trigger_config  JSONB,
    task_content    TEXT,
    task_node_id    TEXT REFERENCES content_nodes(id) ON DELETE SET NULL,
    external_config JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- agent_bash: 保留不变，Agent 的文件访问权限
CREATE TABLE agent_bash (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    node_id     TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
    json_path   TEXT NOT NULL DEFAULT '',
    readonly    BOOLEAN NOT NULL DEFAULT TRUE,
    permission  TEXT NOT NULL DEFAULT 'r',          -- 'r' | 'ra' | 'rw-' | 'rw'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(agent_id, node_id, json_path)
);

-- agent_tool: 保留不变
CREATE TABLE agent_tool (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    tool_id     TEXT NOT NULL REFERENCES tool(id) ON DELETE CASCADE,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    mcp_exposed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(agent_id, tool_id)
);
```

---

### 4.8 其他保留表（不变）

| 表 | 用途 | 变化 |
|----|------|------|
| `project` | 项目 | 无变化 |
| `tool` | 工具注册 | 无变化 |
| `oauth_connection` | OAuth token | 无变化，被 `syncs.credentials_ref` 引用 |
| `chat_sessions` | 聊天会话 | 无变化 |
| `chat_messages` | 聊天消息 | 无变化 |
| `mcp` | MCP 实例 | 无变化 |
| `mcp_binding` | MCP 工具绑定 | 无变化 |
| `context_publish` | 公开 JSON 发布 | 无变化 |
| `etl_rule` | ETL 规则 | 无变化 |
| `chunks` | 文本分块 | 无变化 |
| `agent_execution_log` | Agent 执行日志 | 无变化 |
| `agent_logs` | Agent 调用日志 | 无变化 |
| `access_logs` | 数据访问日志 | 无变化 |
| `db_connections` | 外部数据库连接 | 无变化 |
| `profiles` | 用户画像 | 无变化 |

---

### 4.9 废弃的表

| 表 | 替代 | 迁移策略 |
|----|------|---------|
| `sync_sources` | `syncs` | 数据迁移后 DROP |
| `sync_mappings` | `syncs` | 已合并到 content_nodes，再迁移到 syncs 后 DROP |
| `sync_task` | `uploads` (type='import') | 数据迁移后 DROP |
| `etl_task` | `uploads` (type='file_ocr'/'file_postprocess') | 数据迁移后 DROP |
| `import_task` | `uploads` (type='import') | 如已存在，数据迁移后 DROP |
| `search_index_task` | `uploads` (type='search_index') | 数据迁移后 DROP |

---

### 4.10 完整 ER 图

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              project                                     │
│  id, name, description, user_id                                          │
└──────────┬──────────────┬──────────────┬──────────────┬─────────────────┘
           │              │              │              │
           ▼              ▼              ▼              ▼
┌─────────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐
│  content_nodes  │ │  agents  │ │  syncs   │ │    uploads       │
│                 │ │          │ │ (新)     │ │ (新，一次性任务)  │
│ id              │ │ id       │ │          │ │                  │
│ project_id   ●──┤ │ project  │ │ id       │ │ id               │
│ parent_id    ●──┤ │ type     │ │ project  │ │ project_id       │
│ name            │ │ mcp_key  │ │ node_id ●┤ │ node_id       ●──┤
│ type (4种)      │ │          │ │ direction│ │ type             │
│ preview_json    │ └────┬─────┘ │ provider │ │ status           │
│ preview_md      │      │       │ authority│ │ progress         │
│ s3_key          │      │       │ config   │ │ result           │
│ current_version │      │       │ trigger  │ └──────────────────┘
│ content_hash    │      │       │ status   │
└────────┬────────┘      │       │ cursor   │
         │               │       │ access_key│
         │               │       └──────────┘
    ┌────┴────┐     ┌────┴──────┐
    ▼         ▼     ▼           ▼
┌────────┐ ┌──────────┐ ┌────────────┐
│file_   │ │sync_     │ │agent_bash  │
│versions│ │changelog │ │agent_tool  │
│        │ │          │ │            │
│node_id●│ │project_id│ │agent_id  ● │
│version │ │node_id   │ │node_id   ● │
│content │ │action    │ │permission  │
│operator│ │version   │ └────────────┘
└────────┘ │cursor=id │
           └──────────┘
```

### 4.11 表间关系总结

```
project (1) ──→ (N) content_nodes
project (1) ──→ (N) agents
project (1) ──→ (N) syncs
project (1) ──→ (N) uploads

content_nodes (1) ──→ (N) syncs          一个节点可以挂多个 sync
content_nodes (1) ──→ (N) uploads        一个节点可以有多个上传任务
content_nodes (1) ──→ (N) file_versions  一个节点有多个版本
content_nodes (1) ──→ (N) chunks         一个节点有多个分块
content_nodes (1) ←── (1) content_nodes  树形自引用 (parent_id)

syncs (N) ──→ (1) oauth_connection       多个 sync 可以共享一个 OAuth 连接

agents (1) ──→ (N) agent_bash            一个 agent 有多个文件访问权限
agents (1) ──→ (N) agent_tool            一个 agent 有多个工具绑定

sync_changelog ← VersionService 写入     所有内容变更追加到 changelog
sync_changelog → syncs.cursor 消费       各 sync 按 cursor 增量拉取
```

---

## 5. Sync 生命周期

### 5.1 Inbound Sync

创建 → 首次同步 → 持续/暂停 → 删除。删除 Sync 后文件保留，变为普通文件。

### 5.2 Bidirectional Sync

创建 → 外部客户端连接 → 增量同步循环（cursor-based pull/push + Long Poll）→ 断开/暂停 → 重连。

### 5.3 Outbound Sync

创建 → 监听 content_node 变更 → 按配置推送到外部 → 删除后停止推送。

---

## 6. 文件夹级 Sync 的作用域

文件夹级 Sync 默认**递归**作用于所有子节点。

**Authority 继承规则**：

- **文件夹级 bidirectional Sync**（如 OpenClaw）：authority **不传递**到子节点。它决定的是同步范围（哪些文件会被推送/拉取），不是写入权限。
- **文件夹级 inbound authoritative Sync**（如 GitHub repo）：authority **传递**到所有子节点。语义是"这整个文件夹的内容由外部系统管理"。

---

## 7. Agent 与 Sync 的关系

| 概念 | 是什么 | 核心能力 |
|------|--------|---------|
| **Sync** | 数据通道 | 文件同步、增量传输、冲突解决 |
| **Agent** | AI 代理 | 聊天对话、工具调用、推理决策 |

- Sync 不需要 Agent（OpenClaw CLI 只需要 Sync，Google Sheets 导入只需要 Sync）
- Agent 可以关联 Sync（Agent 修改文件 → Sync 分发到外部）
- 前端分离：**右侧面板**管理 Sync，**顶部 Agent 栏**管理 Agent

---

## 8. 前端交互设计

### 8.1 右侧 Sync 面板

选中文件/文件夹时，右侧面板展示所有关联的 Sync：

```
┌─────────────────────────────────┐
│  Q1_Budget_Data.json            │
│                                 │
│  SYNCS                          │
│  ┌───────────────────────────┐  │
│  │ ← Google Sheets           │  │
│  │   权威源 · 上次同步: 2分前 │  │
│  │   ● Active                │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │ ↔ OpenClaw (继承自 folder)│  │
│  │   只读（权威源: Sheets）   │  │
│  │   ● Active                │  │
│  └───────────────────────────┘  │
│                                 │
│  + 添加 Sync                    │
└─────────────────────────────────┘
```

### 8.2 入口保持友好

统一底层模型，但保留直觉入口：

| 用户动作 | 创建的 Sync |
|---------|------------|
| "从 Google Sheets 导入" | `{direction: 'inbound', authority: 'authoritative'}` |
| "同步到 OpenClaw" | `{direction: 'bidirectional', authority: 'mirror'}` |
| "通过 MCP 发布" | `{direction: 'outbound', authority: 'mirror'}` |

---

## 9. 后端模块结构（实际）

> 以下反映 2026-02-24 重构后的实际目录结构。

### 9.1 `sync/` — 同步模块

所有同步相关逻辑统一在 `backend/src/sync/`。

```
backend/src/sync/
├── router.py               # Sync CRUD API (/api/v1/sync/sources/*)
├── service.py              # 核心业务逻辑
├── repository.py           # syncs 表操作
├── schemas.py              # Pydantic 模型
├── dependencies.py         # FastAPI 依赖注入
│
├── folder_router.py        # 文件夹级同步 API (/api/v1/sync/{folder_id}/pull|push|changes|upload-url|confirm-upload)
├── folder_sync.py          # FolderSyncService — Stateless Mirror 同步引擎
├── import_service.py       # 一次性导入逻辑
├── import_schemas.py
│
├── handlers/               # SaaS 同步 Handler（每个信息源一个文件）
│   ├── base.py             # BaseSyncHandler 接口
│   ├── notion_handler.py
│   ├── github_handler.py
│   ├── gmail_handler.py
│   ├── google_calendar_handler.py
│   ├── google_sheets_handler.py
│   ├── google_drive_handler.py
│   ├── google_docs_handler.py
│   ├── airtable_handler.py
│   ├── linear_handler.py
│   ├── url_handler.py
│   ├── file_handler.py
│   └── folder_source.py
│
├── providers/              # 复杂 Provider（独立子目录）
│   └── openclaw/           # OpenClaw 双向同步
│       ├── __init__.py     # 导出 OpenClawService, FolderAccessService
│       ├── lifecycle.py    # CLI 连接生命周期 (connect/status/disconnect)
│       ├── router.py       # /api/v1/sync/openclaw/* 端点
│       └── folder_access.py # 文件夹访问权限服务
│
├── task/                   # 同步任务管理
│   ├── manager.py          # 任务调度
│   ├── repository.py       # 任务表操作
│   └── models.py           # 任务数据模型
│
├── jobs/                   # ARQ Worker
│   ├── worker.py           # Worker 入口
│   └── jobs.py             # Job 定义
│
├── changelog.py            # sync_changelog 读写
├── notifier.py             # 同步通知
├── adapter.py              # 适配器基类
├── config.py               # 同步配置
├── arq_client.py           # ARQ 客户端
├── sync_worker.py          # Worker 启动
├── cache_manager.py        # 缓存管理
│
├── utils/
│   ├── url_parser.py
│   └── firecrawl_client.py
│
├── triggers/               # 触发器（待实现）
└── adapters/               # 适配器注册（待实现）
```

### 9.2 `agent/` — Agent 模块

Agent 聊天、配置、MCP 的规范位置。从旧的 `access/` 迁移至此。

```
backend/src/agent/
├── router.py               # Agent 聊天 SSE 路由
├── service.py              # Agent 聊天服务
├── schemas.py
├── dependencies.py
├── sandbox_data.py         # 沙盒数据工具
│
├── chat/                   # 聊天子模块
│   ├── service.py          # 聊天业务逻辑
│   ├── repository.py       # 聊天记录存储
│   ├── schemas.py
│   └── dependencies.py
│
├── config/                 # Agent 配置
│   ├── router.py           # /api/v1/agent-config/* 端点
│   ├── service.py          # 配置 CRUD + OpenClaw 状态查询
│   ├── repository.py
│   ├── schemas.py
│   ├── models.py           # Agent 数据模型
│   └── dependencies.py
│
└── mcp/                    # MCP 协议（工具绑定/代理）
    ├── router.py           # /api/v1/mcp/* 端点
    ├── service.py
    ├── schemas.py
    ├── models.py
    └── dependencies.py
```

### 9.3 `access/` — 兼容层（待删除）

旧的 `access/` 目录现在只是 re-export 兼容层，所有文件都指向 `agent/` 或 `sync/providers/openclaw/`。等 CLI 新版发布、旧客户端淘汰后可安全删除。

```
backend/src/access/         # ⚠️ 兼容层 — 全部是 re-export stub
├── chat/                   # → src.agent.chat.*
├── config/                 # → src.agent.config.*
├── mcp/                    # → src.agent.mcp.*
└── openclaw/               # → src.sync.providers.openclaw.*
    ├── router.py           # 旧端点 /api/v1/access/openclaw/* (deprecated)
    ├── service.py          # → lifecycle.OpenClawService
    └── folder_access.py    # → providers.openclaw.folder_access
```

### 9.4 Handler vs Provider 分类

| 分类 | 形式 | 判断标准 | 示例 |
|------|------|---------|------|
| Handler | `sync/handlers/` 中单个 `.py` | 标准 pull 接口，无自定义端点 | Notion, GitHub, Gmail, Google Calendar |
| Provider | `sync/providers/` 中独立子目录 | 有自定义通信协议、专用端点 | OpenClaw (lifecycle + folder sync) |

### 9.5 API 路由映射

| 路由 | 模块 | 说明 |
|------|------|------|
| `/api/v1/sync/sources/*` | `sync/router.py` | Sync Source CRUD |
| `/api/v1/sync/{folder_id}/*` | `sync/folder_router.py` | 文件夹级双向同步 (pull/push/changes/upload) |
| `/api/v1/sync/openclaw/*` | `sync/providers/openclaw/router.py` | OpenClaw CLI 生命周期 (connect/status/disconnect) |
| `/api/v1/agents/*` | `agent/router.py` | Agent SSE 聊天 |
| `/api/v1/agent-config/*` | `agent/config/router.py` | Agent 配置 + OpenClaw 状态查询 |
| `/api/v1/mcp/*` | `agent/mcp/router.py` | MCP 工具绑定 |
| `/api/v1/access/openclaw/*` | `access/openclaw/router.py` | ⚠️ 兼容层 (deprecated) |

### 9.6 已完成的迁移

| 迁移 | 状态 | 说明 |
|------|------|------|
| `access/openclaw/` → `sync/providers/openclaw/` | ✅ 完成 | 生命周期 + folder_access |
| `access/chat/` → `agent/chat/` | ✅ 完成 | 聊天模块 |
| `access/config/` → `agent/config/` | ✅ 完成 | 配置模块 |
| `access/mcp/` → `agent/mcp/` | ✅ 完成 | MCP 模块 |
| CLI `/access/openclaw/*` → `/sync/openclaw/*` | ✅ 完成 | CLI 端点路径 |
| DB: `syncs` + `uploads` 新表 | ✅ 完成 | 4 步 SQL 迁移 |
| DB: `content_nodes` 简化 | ✅ 完成 | 移除 sync_* 字段 |
| DB: 旧表清理 | ✅ 完成 | 删除 sync_sources, sync_task, etl_task, search_index_task |

### 9.7 待完成的迁移

| 迁移 | 状态 | 说明 |
|------|------|------|
| `ingest/saas/` → `sync/handlers/` | ⏳ 待定 | SaaS Handler 已在 sync/handlers/，但旧 ingest 代码待清理 |
| `ingest/file/` → `upload/` | ⏳ 待定 | Upload 模块尚未独立拆出 |
| `sandbox/` → `sync/providers/sandbox/` | ⏳ 待定 | Sandbox Provider 未迁移 |
| `access/` 兼容层删除 | ⏳ 等待 | CLI + 前端完全迁移后可删除 |
| 前端统一同步状态面板 | ⏳ 待定 | 目前分散在 3 处（见 §12） |

---

## 10. 前端同步状态展示

### 10.1 设计原则

两层展示，不同粒度服务不同场景：

- **第一层 Node 行内**：浏览数据时的上下文感知（"这个文件从哪来"）
- **第二层 Header 全局面板**：全局监控和错误处理（"整体同步健康吗"）

### 10.2 第一层：Node 行内 Sync 指示

数据浏览器（ListView / GridView）中每个 node 旁显示 sync 图标：

- **图标**：Provider logo（Google / GitHub / Notion / OpenClaw 等），不是文字
- **状态色**：`●` idle（灰/绿）、`⟳` syncing（蓝）、`✕` error（红）
- **无 sync 的文件**：不显示任何图标，保持干净
- **点击**：右侧面板展开该 node 的 sync 详情（来源、方向、上次同步时间、操作按钮）

### 10.3 第二层：Header 全局 Sync 按钮

Header 右侧放一个 Sync 按钮，显示整体同步状态：

- **正常**：`[🔄 3]` — 图标 + 活跃 sync 数
- **有错误**：`[🔄 3 ⚠️ 1]` — 活跃数 + 错误数（红色高亮）
- **全部空闲**：`[🔄 ✓]` — 一切正常

点击展开下拉面板，分组显示：

1. **Error 置顶** — 带操作按钮（Reconnect / Retry / Dismiss）
2. **Syncing 其次** — 正在进行的同步
3. **Idle 收起** — 默认折叠，点击展开
4. **底部附带 Upload 任务** — 一次性导入/文件处理进度

### 10.4 与现有组件的关系

| 现有组件 | 变化 |
|---------|------|
| `SyncStatusIndicator` | **增强** — 加上 provider 图标，支持 idle 状态显示 |
| `TaskStatusWidget` (右下角浮窗) | **替换** — 合并进 Header 全局面板 |
| `SyncProgressPanel` (对话框内) | **保留** — 导入对话框内实时进度不变 |
| `OpenClawSetupView` (侧边栏) | **保留** — 首次配置流程不变，运行时状态归入全局面板 |

### 10.5 数据来源

新增后端端点 `GET /api/v1/sync/status?project_id=xxx`，聚合返回：

```json
{
  "syncs": [
    { "id": "...", "node_id": "...", "node_name": "...", "provider": "google_calendar",
      "direction": "inbound", "status": "idle", "last_sync_at": "...", "error_message": null }
  ],
  "uploads": [
    { "id": "...", "node_id": "...", "type": "file_processing",
      "status": "processing", "progress": 67 }
  ]
}
```

---

## 11. 开放问题

### 11.1 Inbound Sync 的更新频率

一次性导入 vs 定期同步？建议通过 `syncs.trigger` 字段配置：manual（默认）、polling、webhook。

### 11.2 Sync 的认证模型

各 provider 认证方式不同（OAuth token / Access Key / Webhook Secret），统一在 `syncs` 表的 `credentials_ref` + `access_key` 字段覆盖。

### 11.3 Upload handler 和 Sync provider 的代码复用

部分 provider 同时支持"一次性导入"和"持久同步"（如 Google Sheets）。导入逻辑可能与 sync handler 的首次同步逻辑重叠，需要确定复用方式。

### 11.4 一次性导入 → 持久同步的升级路径

用户是否可以将一次 upload（一次性导入）"升级"为持久的 sync？如果可以，交互和数据迁移流程待定义。

### 11.5 前端统一同步面板

已确定方案：两层展示（Node 行内指示 + Header 全局面板），详见 §10。

---

## 12. 总结

### 设计原则

| 原则 | 说明 |
|------|------|
| **文件就是文件** | `content_nodes.type` 只表示格式，信息源是 Sync 的属性 |
| **Sync 是进程** | 独立对象，可挂载/卸载，不改变文件本身 |
| **Authority 预防冲突** | 通过权威源机制在写入前阻止冲突，而非事后解决 |
| **PuppyOne 是仲裁者** | 所有写入经过 CollaborationService，统一冲突解决 |
| **特指覆盖泛指** | 文件级 Sync 优先于文件夹级 Sync |
| **入口友好** | 底层统一，但用户入口保持直觉（"从...导入"/"同步到..."） |

### 核心数据流

```
外部系统 ←→ Sync (authority + direction) ←→ content_nodes ←→ Sync ←→ 外部系统
                                                │
                                          CollaborationService
                                          (乐观锁 + 三方合并)
                                                │
                                          VersionService
                                          (版本历史 + sync_changelog)
```

### 与现有架构的关系

| 现有模块 | 变化 |
|---------|------|
| `content_nodes` | 移除 sync_* 字段，type 简化为 4 种原生类型 |
| `sync_sources` / `sync_mappings` | 被 `syncs` 表替代 |
| `sync_task` / `etl_task` / `search_index_task` | 被 `uploads` 表替代 |
| `sync_changelog` | 保留不变 |
| `CollaborationService` | 保留，增加 authority check |
| `VersionService` | 保留不变 |
| OAuth | 保留，被 `syncs.credentials_ref` 引用 |
| Agents | 保留，不再承担同步通道角色 |
