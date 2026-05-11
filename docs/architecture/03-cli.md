# CLI 架构

PuppyOne 有两个 CLI 工具，职责分明：

- **`puppyone`** — 控制平面 + Access Point scoped filesystem 操作（登录、项目管理、Access Point 管理、`puppyone fs` 文件操作）
- **`mut`** — 数据平面（clone、commit、push、pull——本地工作目录 + sync 协议）

**核心原则：所有对 MUT tree 的读写都必须经过 MUT 引擎（MutOps），不允许绕过。**

```
┌─────────────────────────────────────────────────────────────┐
│                    PuppyOne (Server)                        │
│                                                             │
│   Project A                                                 │
│   ├── Access Point 1 (direct)     → /api/v1/mut/ap/ak_abc123       │
│   ├── Access Point 2 (agent)      → /api/v1/mut/ap/ak_xyz789       │
│   ├── Access Point 3 (notion)     → Server Pull → MUT Tree  │
│   ├── Access Point 4 (mcp)        → /api/v1/mut/ap/ak_mcp456       │
│   └── Access Point 5 (filesystem) → /api/v1/mut/ap/ak_fs901        │
│                                                             │
│   所有类型都在 access_points 表中，provider 字段区分类型       │
│                                                             │
│   puppyone: 创建项目 → 创建 access point → 管理权限          │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ access point URL / access key
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    MUT (Client)                             │
│                                                             │
│   - 只认 access point URL                                    │
│   - 不知道"项目"、"平台"等概念                                │
│   - clone / commit / push / pull / ls / cat                 │
│   - 权限由 server 控制，client 只是执行                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. MUT CLI（数据平面）

### 设计理念

MUT 是纯粹的数据操作工具，类似 Git。它只认 Access Point URL，不知道
PuppyOne 平台、项目、连接等概念。所有内容读写都必须通过 MUT 协议。

### 用户体验

#### 首次使用

```bash
# 1. 登录 PuppyOne
puppyone login

# 2. 创建项目（自动生成默认 access point）
puppyone project create "My Knowledge Base"
# → Created project: my-knowledge-base
# → Access point: https://api.puppyone.com/api/v1/mut/ap/ak_abc123
# → Clone with: mut clone https://api.puppyone.com/api/v1/mut/ap/ak_abc123

# 3. MUT clone（用 access point URL）
mut clone https://api.puppyone.com/api/v1/mut/ap/ak_abc123 ./my-kb
cd my-kb/
```

#### 日常工作

```bash
echo '{"topic": "AI"}' > context.json
mut commit -m "add context"
mut push
mut pull
mut status
mut log
mut ls              # 列出当前目录
mut cat readme.md   # 查看文件内容
```

#### 多人/多 Agent 协作

```bash
mut clone https://api.puppyone.com/api/v1/mut/ap/ak_abc123 ./team-kb
cd team-kb/
mut pull          # 拉取别人的更新
mut commit -m "my changes"
mut push
mut log           # 查看历史
mut diff 5 8      # 对比版本
mut rollback 5    # 回滚
```

### 命令参考

| 命令 | 说明 | 示例 |
|------|------|------|
| `mut clone <url> [dir]` | 克隆 access point 到本地 | `mut clone https://.../api/v1/mut/ap/ak_abc ./kb` |
| `mut commit -m "msg"` | 创建本地版本快照 | `mut commit -m "update"` |
| `mut push` | 推送到云端 | |
| `mut pull` | 拉取云端最新 | |
| `mut status` | 查看本地与云端差异 | |
| `mut log` | 查看版本历史 | |
| `mut ls [path]` | 列出目录内容 | `mut ls docs/` |
| `mut cat <path>` | 查看文件内容 | `mut cat readme.md` |
| `mut diff <v1> <v2>` | 对比两个版本 | `mut diff 5 8` |
| `mut rollback <ver>` | 回滚到指定版本 | `mut rollback 5` → 创建 v9 |

### 输出示例

#### `mut status`

```
Access Point: https://api.puppyone.com/api/v1/mut/ap/ak_abc123
Local:  v5
Remote: v8

Changes since last commit:
  + new-file.md
  ~ modified.json

Unpushed commits: 2
```

#### `mut log`

```
v8  2026-03-21 14:30  sync:notion        synced from Notion
v7  2026-03-21 13:00  agent:research     collected articles
v6  2026-03-21 10:00  user:alice         update notes
```

### 配置文件

clone 后自动生成 `.mut/config.json`：

```json
{
  "server": "https://api.puppyone.com/api/v1/mut/ap/ak_abc123",
  "credential": "ak_abc123"
}
```

MUT 只认这个 URL，不知道背后是什么平台或项目。

### 与 Git 的区别

| | Git | MUT |
|---|---|---|
| 定位 | 独立的版本控制系统 | 云端的 client |
| 本地创建 | `git init` 可以从零创建 | 不能，必须 clone access point |
| Clone 对象 | 仓库 URL | access point URL |
| 权限管理 | 本地或平台都可以 | 只在 server 端 |
| 离线工作 | 完整支持 | 可以编辑和 commit，push/pull 需要网络 |

---

## 2. PuppyOne CLI（控制平面 + scoped FS）

PuppyOne CLI 管理项目和 Access Point，并通过 `puppyone fs` 提供
Access Point scoped filesystem 操作。文件操作统一到 `fs`。

`puppyone fs` 是 Unix-like，但不是本地 POSIX filesystem：底层是
MUT/MAT-backed tree + object store。所有写操作必须经由 `/ap-fs/*` 后端端点
进入 MutOps/MAT history；CLI 不能直接改 tree 或绕开版本记录。递归读命令默认有
资源保护，返回可能带 `truncated`，Agent 应优先使用 `tree -L`、
`find -maxdepth` 和 `--limit` 缩小扫描范围。`upload -r` / `download -r`
是 PuppyOne 的本地/云端桥接命令，不是 POSIX 原生命令，因此也暴露
`--max-depth` 和 `--limit` 控制资源使用。运行
`puppyone fs semantics` 可查看面向 Agent 的差异说明。

输出契约遵循 Unix 习惯：默认模式下 stdout 只放主结果，warning / 截断诊断走
stderr，避免污染管道；`--json` 模式才暴露 PuppyOne 扩展字段，例如
`complete`、`truncated`、`returned_count`、`limit`、`truncation_reason`。

### 命令总览

```
puppyone
├── login / logout / whoami        认证
├── project                        项目管理
│   ├── create <name>
│   ├── list
│   └── use <name>
├── access                         Access Point 统一管理
│   ├── add <provider> [args]      创建 access point
│   ├── ls                         列出全部
│   ├── info <id>                  查看详情
│   ├── rm <id>                    删除
│   ├── pause <id>                 暂停（仅 server-pull 类型）
│   ├── resume <id>                恢复
│   ├── trigger <id> [options]     设置同步触发器
│   ├── key <id>                   查看/重新生成 access key
│   ├── refresh <id>               立即触发一次同步
│   └── logs <id>                  查看同步日志
├── ap                             Access Point profile 管理
│   ├── login <profile>
│   ├── use <profile>
│   ├── list
│   ├── current
│   ├── logout <profile>
│   └── clear
├── fs                             Access Point scoped 文件操作
│   ├── ls [paths...]              列目录 / 文件本身
│   ├── cat <paths...>             原样读文件；JSON 输出才结构化
│   ├── head / tail <paths...>     读文件开头 / 结尾
│   ├── tree [-d] [-L n] [path]    目录树；-d 只列目录
│   ├── find [path] [expr]         查找路径
│   ├── stat [path]                文件信息
│   ├── write <path>               写文件
│   ├── mkdir [-p] <paths...>      创建目录
│   ├── rmdir [-p] <paths...>      删除空目录
│   ├── touch <paths...>           创建空文件 / 更新时间
│   ├── upload / download          本地文件系统和云端 scoped FS 桥接
│   ├── cp <src...> <dst>          复制
│   ├── mv <src...> <dst>          移动/重命名
│   ├── rm [-r] [-f] <paths...>    删除
│   └── semantics                  Agent-facing Unix compatibility notes
├── chat [agent-id]                与 Agent 聊天
├── status                         项目总览
└── config                         CLI 配置
```

### 认证

```bash
puppyone login              # 登录
puppyone logout             # 登出
puppyone whoami             # 查看当前用户
```

### 项目管理

```bash
puppyone project create "My Project"    # 创建项目
puppyone project list                   # 列出项目
puppyone project use "My Project"       # 设置当前活跃项目
```

### Access Point 管理

**一张表，一个命令。** 所有 access point 类型（SaaS 数据源、数据库、Agent、MCP、
Sandbox、本地同步）统一通过 `puppyone access` 管理，对应 `access_points` 表。

#### 创建 Access Point

```bash
# ── SaaS 数据源（Server Pull & Overwrite）──
puppyone access add notion <url>
puppyone access add gmail
puppyone access add github
puppyone access add google_drive
puppyone access add url <url>

# ── 外部数据库（Server Pull & Overwrite）──
puppyone access add database --host db.example.com --port 5432 --database mydb

# ── Agent（MUT Native Protocol）──
puppyone access add agent "Research Bot"
puppyone access add agent "Coder" --scope /src --permission rw

# ── MCP 端点（被动，MUT Native Protocol）──
puppyone access add mcp "Data API" --scope /data

# ── Sandbox（MUT Native Protocol）──
puppyone access add sandbox "Code Runner"

# ── 本地文件夹同步（MUT Native Protocol）──
puppyone access add filesystem --scope /docs
# → access_key: ak_fs_xxx
# → 然后在本地运行：mut clone https://.../api/v1/mut/ap/ak_fs_xxx ~/my-folder

# ── 直连（MUT Native Protocol）──
puppyone access add direct "Default Access"
puppyone access add direct "Read Only" --permission read --scope /public
```

#### 通用选项

```
Options:
  --scope <path>       MUT tree 上的路径范围 (default: /)
  --permission <perm>  权限: read | write | rw (default: rw)
  --name <name>        显示名称
  --set key=value      设置 provider 特有配置（可重复）
  --config <json>      JSON 格式的 provider 特有配置
  --trigger <spec>     同步触发器（仅 server-pull 类型）
```

#### 查看和管理

```bash
puppyone access ls                    # 列出当前项目的所有 access point
puppyone access info <id>             # 查看详情
puppyone access rm <id>               # 删除
puppyone access key <id>              # 查看 access key
puppyone access key <id> --regenerate # 重新生成 access key
```

#### 同步管理（Server Pull 类型）

```bash
puppyone access pause <id>            # 暂停同步
puppyone access resume <id>           # 恢复同步
puppyone access refresh <id>          # 立即触发一次同步
puppyone access trigger <id> --cron "0 9 * * *"  # 设置定时触发
puppyone access trigger <id> --manual             # 改为手动触发
puppyone access logs <id>             # 查看同步运行日志
```

#### 输出示例

```bash
$ puppyone access ls
ID          Provider    Scope    Perm  Status   Name              Last Sync
──────────  ──────────  ───────  ────  ───────  ────────────────  ──────────
ak_abc123   direct      /        rw    active   Default Access    —
ak_not456   notion      /notes   rw    active   Notion Sync       2m ago
ak_gm789    gmail       /inbox   read  active   Gmail Import      1h ago
ak_agt012   agent       /data    rw    active   Research Bot      —
ak_mcp345   mcp         /api     read  active   Data API          —
ak_sbx678   sandbox     /code    rw    active   Code Runner       —
ak_fs901    filesystem  /docs    rw    active   Local Sync        30s ago
```

```bash
$ puppyone access info ak_not456
Access Point: ak_not456
Provider:     notion
Name:         Notion Sync
Scope:        /notes
Permission:   rw
Status:       active
Trigger:      scheduled (every 6h)
Last Sync:    2026-03-21 14:30:00 (2m ago)
Access Key:   ak_not...56
MUT URL:      https://api.puppyone.com/api/v1/mut/ap/ak_not456
```

### 与 Agent 聊天

```bash
puppyone chat                  # 使用默认 Agent
puppyone chat <agent-id>       # 指定 Agent
```

### 项目状态

```bash
puppyone status                # 项目总览（access point 列表 + 最近同步 + 统计）
```

### 输出格式

所有命令支持双模式输出：
- 默认：人类可读的格式化输出
- `--json`：机器可读的 JSON 输出

---

## 3. Access Point 类型与 MUT 协议的关系

所有 Access Point 都在 `access_points` 表中，`provider` 字段区分类型。
按数据流方向分为两大类：

### Server Pull（服务端主动拉取）

| Provider | 数据流 | Trigger | MUT 写入方式 |
|----------|--------|---------|-------------|
| datasource (notion/gmail/github/...) | 外部 API → MUT Tree | Server-driven (scheduler) | MutOps.write_file() |
| database | 外部 DB → MUT Tree | 手动 / scheduler | MutOps.write_file() |

客户端（人 / agent）通过 `mut clone` 该 access point 来读取同步进来的数据。

### MUT Native Protocol（客户端双向读写）

| Provider | 客户端 | 数据流 | Trigger |
|----------|--------|--------|---------|
| direct | mut CLI / 任何 HTTP client | 双向 | 客户端主动 |
| agent | MutEphemeralClient（服务端进程内） | 双向 | 用户发消息 |
| mcp | 外部 MCP client | 按需读取 | 外部主动调用 |
| sandbox | MutEphemeralClient（容器内） | 双向 | 用户调 API |
| filesystem | mut CLI daemon（本地） | 双向 | chokidar 文件监听 |

所有 MUT Native Protocol 类型的 access point 都暴露为：
`https://api.puppyone.com/api/v1/mut/ap/{access_key}`

---

## 4. 完整示例

### 个人项目

```bash
puppyone login
puppyone project create "Notes"
# → Access point: https://api.puppyone.com/api/v1/mut/ap/ak_abc

mut clone https://api.puppyone.com/api/v1/mut/ap/ak_abc ./notes
cd notes/
echo "# My Notes" > README.md
mut commit -m "init"
mut push
```

### 连接 Notion 数据源

```bash
puppyone access add notion "https://notion.so/my-page"
# → OAuth 授权流程
# → Access Point ak_not456 created
# → Syncing to /notes ...

# 在本地查看同步过来的数据
mut clone https://api.puppyone.com/api/v1/mut/ap/ak_abc ./workspace
cd workspace/
mut pull       # 拉取最新（包含 Notion 同步的数据）
mut ls notes/  # 查看同步内容
```

### 创建 Agent

```bash
puppyone access add agent "Research Bot" --scope /data --permission rw
# → Access Point ak_agt012 created
# → MUT URL: https://api.puppyone.com/api/v1/mut/ap/ak_agt012

puppyone chat ak_agt012
# → 开始聊天，Agent 通过 MUT 协议读写 /data 目录
```

### 本地文件夹双向同步

```bash
puppyone access add filesystem --scope /docs
# → Access Point ak_fs901 created
# → Clone with: mut clone https://api.puppyone.com/api/v1/mut/ap/ak_fs901 ~/my-docs

# 在本地启动同步 daemon
mut clone https://api.puppyone.com/api/v1/mut/ap/ak_fs901 ~/my-docs
cd ~/my-docs
mut daemon     # 启动后台 watch + 自动 commit/push/pull
```

### 暴露 MCP 端点

```bash
puppyone access add mcp "Data API" --scope /data --permission read
# → Access Point ak_mcp345 created
# → MCP URL: https://api.puppyone.com/api/v1/mut/ap/ak_mcp345
# → 任何 MCP 客户端都可以连接此 URL
```

### 团队协作

```bash
# 管理员：创建只读 access point
puppyone access add direct "Team Reader" --permission read
# → ak_team123

# 团队成员：clone 并工作
mut clone https://api.puppyone.com/api/v1/mut/ap/ak_team123 ./wiki
# (只能 pull，不能 push——权限由 server 控制)
```

---

## 5. CLI 实现文件映射

### `puppyone` CLI（`cli/src/commands/`）

| 文件 | 命令 | 职责 |
|------|------|------|
| `auth.js` | `puppyone login/logout/whoami` | 认证 |
| `project.js` | `puppyone project` | 项目 CRUD |
| `access.js` | `puppyone access` | Access Point 统一管理 |
| `ap/index.js` | `puppyone ap` | AP 命令域注册 |
| `ap/profiles.js` | `puppyone ap login/use/list/current/logout/clear` | Access Point profile 管理 |
| `fs/index.js` | `puppyone fs` and `puppyone ap <fs-subcommand>` | FS 命令域注册 |
| `fs/commands/*.js` | `ls/tree/find/cat/head/tail/stat/write/mkdir/rmdir/touch/upload/download/cp/mv/rm` | 单个 FS 子命令实现 |
| `fs/lib/*.js` | shared FS helpers | AP context、HTTP、路径、渲染、内容读取、本地传输 |
| `ap.js` | compatibility re-export | 兼容旧 import，不承载业务逻辑 |
| `chat.js` | `puppyone chat` | Agent 聊天 |
| `config-cmd.js` | `puppyone config` | CLI 配置 |
| `global.js` | `puppyone status` | 全局状态 |

### `mut` CLI（`mut/mut/cli.py`）

| 命令 | 协议端点 |
|------|---------|
| `mut clone <url>` | `POST /api/v1/mut/ap/{ak}/clone` |
| `mut push` | `POST /api/v1/mut/ap/{ak}/push` |
| `mut pull` | `POST /api/v1/mut/ap/{ak}/pull` |
| `mut commit` | 纯本地操作 |
| `mut status` | `POST /api/v1/mut/ap/{ak}/negotiate` + 本地比对 |
| `mut log` | `POST /api/v1/mut/ap/{ak}/negotiate` |
| `mut ls` | 读取本地 .mut 仓库 |
| `mut cat` | 读取本地 .mut 仓库 |
| `mut diff` | 本地版本比对 |
| `mut rollback` | `POST /api/v1/mut/ap/{ak}/push`（推送回滚后的版本） |

### 已废弃（待删除）

| 文件 | 原因 |
|------|------|
| `openclaw.js` | 已废弃的品牌名 + 调用不存在的旧端点 |
| `data.js` | 旧 Data Plane 命令已移除；文件操作统一到 `puppyone fs` |
| `table.js` | 数据平面操作，应使用 `mut` |
| `mcp.js` | 合并到 `access` |
| `sandbox.js` | 合并到 `access` |
| `agent-cmd.js` | CRUD 合并到 `access`，chat 拆到 `chat.js` |
| `connection.js` | 合并到 `access` |
| `sync.js` | 合并到 `access`（trigger/pause/resume 子命令） |
| `db.js` | 合并到 `access add database` |
| `tool.js` | 工具管理随 MCP 端点自动处理 |
| `ingest.js` | 文件导入改为通过 `mut` 操作 |
| `publish.js` | 低优先级，后续再定 |
