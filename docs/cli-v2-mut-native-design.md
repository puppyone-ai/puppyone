# PuppyOne CLI v2 — Mut-Native 重构设计方案

> Status: DRAFT — 等待确认后实施
> Date: 2026-03-19

## 背景

CLI v1 基于 `content_nodes` 表（PostgreSQL），所有文件操作通过 `/api/v1/nodes` 端点、UUID-based node ID 进行。
Mut-Native 架构迁移后，`content_nodes` 表已删除，SOT 是 Mut Merkle tree（S3 + `mut_commits`）。

**需要迁移的模块：**
- `fs` 命令组（整个文件系统操作）
- `helpers.js`（`resolvePath` / `resolveNode` 路径解析）
- `ingest` 命令组（文件导入时的节点创建）
- `connection` / `openclaw` 中的文件夹创建
- `watch.js` 的 Realtime 订阅
- `publish` 的 `node_id` 引用

**不需要迁移的模块：**
- `auth` — 纯认证流，无关 content
- `org` / `project` — 操作 PG organizations/projects 表，与 Mut 无关
- `config` — 纯本地状态
- `agent` / `mcp` / `sandbox` / `tool` — 操作 connections/tools 表，不直接操作 content
- `sync` — 管理 sync connections，sync engine 后端已迁移
- `table` — 操作独立的 `tables` 表
- `db` — 外部数据库连接器

## 设计原则

### 1. Path-native，取消 UUID

CLI 用户操作的维度永远是 **路径**（如 `/docs/readme.md`）。
旧架构里 CLI 要先把路径解析成 UUID（逐级调 `/nodes`），再用 UUID 调增删改查。
新架构中**路径就是 ID**，直接传给后端 Tree API，无需 resolve 步骤。

### 2. 对齐后端 Tree API

后端已有的 path-based 端点：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/v1/tree/{projectId}/ls` | GET `?path=` | 列目录 |
| `/api/v1/tree/{projectId}/cat` | GET `?path=` | 读文件 |
| `/api/v1/tree/{projectId}/stat` | GET `?path=` | 文件/目录元信息 |
| `/api/v1/tree/{projectId}/write` | POST `{path, content, type}` | 写文件 |
| `/api/v1/tree/{projectId}/mkdir` | POST `{path}` | 建目录 |
| `/api/v1/tree/{projectId}/rm` | POST `{path}` | 删除（移入 .trash） |
| `/api/v1/tree/{projectId}/move` | POST `{src, dst}` | 移动/重命名 |
| `/api/v1/tree/{projectId}/versions` | GET `?path=&limit=` | 版本历史 |
| `/api/v1/tree/{projectId}/rollback` | POST `{path, target_version}` | 回滚 |
| `/api/v1/tree/{projectId}/diff` | GET `?path=&v1=&v2=` | 版本对比 |
| `/api/v1/tree/{projectId}/search` | GET `?q=` | 搜索 (未来) |

### 3. 精简 helpers.js

删除 `resolvePath()` 和 `resolveNode()`（逐级 UUID 解析），
替换为直接的路径字符串处理。CLI 只需做路径标准化（去首尾 `/`、合并 `//`），然后直接传给 Tree API。

```js
// 新的 normalizePath — 纯本地字符串操作，零 API 调用
export function normalizePath(pathStr) {
  if (!pathStr || pathStr === '/' || pathStr === '.') return '';
  return pathStr.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/\/+/g, '/');
}
```

## 命令级改动

### `fs` — 文件系统

改动幅度：**重写**。所有命令从 `/nodes` UUID 端点迁移到 `/tree/{projectId}` path 端点。

| 命令 | 旧端点 | 新端点 | 改动 |
|------|--------|--------|------|
| `fs ls [path]` | `GET /nodes?parent_id={uuid}` | `GET /tree/{pid}/ls?path={path}` | 删除 resolvePath，直接传 path |
| `fs tree [path]` | 递归 `GET /nodes` | `GET /tree/{pid}/ls?path={path}&recursive=true` 或客户端递归调 ls | 服务端若不支持递归则客户端 DFS |
| `fs cat <path>` | `GET /nodes/{uuid}` | `GET /tree/{pid}/cat?path={path}` | 直接传 path |
| `fs mkdir <path>` | `POST /nodes/folder {parent_id}` | `POST /tree/{pid}/mkdir {path}` | 全路径直接传 |
| `fs touch <path>` | `POST /nodes/json` or `/nodes/markdown` | `POST /tree/{pid}/write {path, content, type}` | 根据扩展名推断 type |
| `fs write <path>` | `PUT /nodes/{uuid}` | `POST /tree/{pid}/write {path, content}` | |
| `fs mv <src> <dst>` | `POST /nodes/{uuid}/move` + `PUT /nodes/{uuid}` | `POST /tree/{pid}/move {src, dst}` | 单个调用完成移动+重命名 |
| `fs rm <path>` | `DELETE /nodes/{uuid}` | `POST /tree/{pid}/rm {path}` | soft delete → .trash |
| `fs info <path>` | `GET /nodes/{uuid}` | `GET /tree/{pid}/stat?path={path}` | |
| `fs upload <local> [remote]` | `POST /nodes/upload` (presigned) | `POST /tree/{pid}/write` with binary | 小文件直接 write；大文件需后端 presigned URL 支持 |
| `fs download <path> [local]` | `GET /nodes/{uuid}/download` | `GET /tree/{pid}/cat?path={path}` + write to file | 对 S3 文件需要后端返回 download URL |
| `fs versions <path>` | `GET /nodes/{uuid}/versions` | `GET /tree/{pid}/versions?path={path}` | |
| `fs diff <path> <v1> <v2>` | `GET /nodes/{uuid}/diff/{v1}/{v2}` | `GET /tree/{pid}/diff?path={path}&v1={v1}&v2={v2}` | |
| `fs rollback <path> <ver>` | `POST /nodes/{uuid}/rollback/{ver}` | `POST /tree/{pid}/rollback {path, target_version}` | |
| `fs audit <path>` | `GET /nodes/{uuid}/audit-logs` | `GET /nodes/{path}/audit-logs?project_id={pid}` | audit router 已是 path-based |

**关键简化**：`listChildren` 函数从"查 parent_id → 获取子节点"变成"调 ls API 传 path"，一次调用搞定。

### `ingest` — 导入

| 旧 | 新 |
|----|-----|
| `POST /nodes/json` (inline create) | `POST /tree/{pid}/write` |
| `POST /nodes/markdown` (inline create) | `POST /tree/{pid}/write` |
| `POST /nodes/upload` (presigned) | 先 `POST /tree/{pid}/write` 上传内容，或用专门的 upload 端点 |
| `folder_id` 参数 | `folder_path` 参数（path-based，如 `/docs`） |

### `connection` / `openclaw` — 连接管理

| 旧 | 新 |
|----|-----|
| `GET /nodes/by-path` 解析文件夹 | 直接传 `path` 给后端（后端自己 stat） |
| `POST /nodes/folder` 创建文件夹 | `POST /tree/{pid}/mkdir {path}` |
| `POST /filesystem/bootstrap {node_id}` | `POST /filesystem/bootstrap {path}` |

### `watch.js` — 文件监听

旧：Supabase Realtime 订阅 `content_nodes` 表的 INSERT/UPDATE 事件。
新：改为订阅 `projects` 表的 `mut_version` 字段变更。

```js
// 旧
channel.on('postgres_changes', {
  event: 'UPDATE', schema: 'public', table: 'content_nodes',
  filter: `sync_source_id=eq.${conn.source_id}`,
}, ...);

// 新
channel.on('postgres_changes', {
  event: 'UPDATE', schema: 'public', table: 'projects',
  filter: `id=eq.${conn.project_id}`,
}, (payload) => {
  const newVersion = payload.new.mut_version;
  const oldVersion = payload.old?.mut_version ?? 0;
  if (newVersion > oldVersion) {
    triggerPull();
  }
});
```

或者监听 `mut_commits` 表的 INSERT 事件（更精确，能获取 commit 详情）：

```js
channel.on('postgres_changes', {
  event: 'INSERT', schema: 'public', table: 'mut_commits',
  filter: `project_id=eq.${conn.project_id}`,
}, (payload) => {
  // payload.new 包含 version, who, changes 等
  triggerPull();
});
```

**推荐用 `mut_commits` INSERT**：更精确，可以拿到谁改了什么文件，用于按需 pull。

### `publish` — 发布

旧：`puppyone publish create <node-id>`（UUID）。
新：`puppyone publish create <path>`（如 `/docs/report.json`）。

后端 `context_publish` 模块需要同步适配接收 path 而非 UUID。

### `table` — 不变

Table 操作已经迁移到独立的 `tables` 表，用 table UUID。与 Mut 树无关，无需改动。

## 数据流对比

### 旧（v1）：Path → UUID → API

```
用户输入: puppyone fs cat /docs/readme.md
  ↓
CLI: resolvePath("/docs/readme.md")
  → GET /nodes?project_id=X            # 获取根目录子节点
  → 找到 name="docs" → parentId = docs.id (UUID)
  → GET /nodes?project_id=X&parent_id=docs.id
  → 找到 name="readme.md" → nodeId = readme.id (UUID)
  ↓
CLI: GET /nodes/{nodeId}              # 获取内容
  ↓
显示内容
```

**3 次 API 调用**，路径越深调用越多。

### 新（v2）：Path → API

```
用户输入: puppyone fs cat /docs/readme.md
  ↓
CLI: normalizePath("/docs/readme.md") → "docs/readme.md"
  ↓
CLI: GET /tree/{projectId}/cat?path=docs/readme.md
  ↓
显示内容
```

**1 次 API 调用**，无论路径多深。

## 输出格式

保持 v1 的双模式输出：
- 默认：人类可读的格式化输出
- `--json`：机器可读的 JSON 输出

### `fs ls` 输出示例

```
📁 docs/
📄 readme.md        (1.2 KB, modified 2h ago)
📄 config.json      (256 B, modified 1d ago)
📁 src/
```

### `fs versions` 输出示例

```
Path: docs/readme.md
Current version: v5

v5  ● HEAD   user:abc123   "Updated introduction"     2m ago    +1 ~0 -0
v4           agent:bot01   "Auto-fix formatting"      1h ago    +0 ~1 -0
v3           user:abc123   "Added section 3"          3h ago    +1 ~0 -0
v2           sync:notion   "Synced from Notion"       1d ago    +0 ~1 -0
v1           user:abc123   "Initial create"           2d ago    +1 ~0 -0
```

## 后端需要新增/确认的端点

| 端点 | 状态 | 说明 |
|------|------|------|
| `GET /tree/{pid}/ls` | ✅ 已有 | |
| `GET /tree/{pid}/cat` | ✅ 已有 | |
| `GET /tree/{pid}/stat` | ✅ 已有 | |
| `POST /tree/{pid}/write` | ✅ 已有 | |
| `POST /tree/{pid}/mkdir` | ✅ 已有 | |
| `POST /tree/{pid}/rm` | ✅ 已有 | |
| `POST /tree/{pid}/move` | ✅ 已有 | |
| `GET /tree/{pid}/versions` | ✅ 已有 | |
| `POST /tree/{pid}/rollback` | ✅ 已有 | |
| `GET /tree/{pid}/diff` | ✅ 已有 | |
| `POST /tree/{pid}/upload` | ❌ 需新增 | Presigned URL 上传大文件 |
| `GET /tree/{pid}/download` | ❌ 需新增 | S3 presigned download URL |
| `GET /tree/{pid}/ls?recursive=true` | ❓ 可选 | 如有，CLI tree 命令一次调用搞定 |

## MCP Service RPC Client

`mcp_service/rpc/client.py` 也需要同步迁移，从 `/internal/nodes/{id}/children` 改为 `/internal/nodes/list?path=...` 等 path-based 端点。

| 旧端点 | 新端点 |
|--------|--------|
| `GET /internal/nodes/{id}/children` | `GET /internal/nodes/list?project_id=X&path=Y` |
| `GET /internal/nodes/{id}/content` | `GET /internal/nodes/read?project_id=X&path=Y` |
| `PUT /internal/nodes/{id}/content` | `PUT /internal/nodes/write` (body: `{project_id, path, content}`) |
| `POST /internal/nodes/create` | `POST /internal/nodes/create` (body 改用 path) |
| `POST /internal/nodes/{id}/trash` | `POST /internal/nodes/trash` (body: `{project_id, path}`) |
| `POST /internal/nodes/{id}/rename` | `POST /internal/nodes/rename` (body: `{project_id, path, new_name}`) |
| `POST /internal/nodes/{id}/move` | `POST /internal/nodes/move` (body: `{project_id, src, dst}`) |
| `POST /internal/nodes/prepare-upload` | 需新增或合并到 write |
| `GET /internal/nodes/{id}/reupload-url` | 需新增或合并到 write |

## 实施计划

### Phase 1: 基础 — helpers + fs 核心命令
1. 重写 `helpers.js`：删除 `resolvePath`/`resolveNode`，新增 `normalizePath`
2. 重写 `fs.js`：ls, tree, cat, mkdir, touch, write, rm, mv, info
3. 更新 `api.js`：确保支持新的 Tree API 路径

### Phase 2: 版本管理 + 导入
4. 重写 `fs.js` 版本命令：versions, diff, rollback, audit
5. 重写 `ingest.js`：用 Tree API 替代 /nodes 端点
6. 处理 upload/download（可能需要后端新增端点）

### Phase 3: 连接 + 监听
7. 更新 `connection.js`：文件夹路径解析用 path 而非 UUID
8. 更新 `openclaw.js`：文件夹创建用 mkdir
9. 重写 `watch.js`：Realtime 订阅改为 `mut_commits`

### Phase 4: MCP Service
10. 重写 `mcp_service/rpc/client.py`：对齐 Internal API 新端点

### Phase 5: 清理
11. 更新 `SPEC.md` 和 `DESIGN.md`
12. 删除所有 `/nodes` UUID 旧代码
