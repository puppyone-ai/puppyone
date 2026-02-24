# PuppyOne CLI — System Design v4

> 2026-02-23

---

## 1. 产品定位

**PuppyOne 是一个云端结构化文件系统**，为 LLM Agent 提供上下文管理。

CLI 的核心体验是：**像操作本地文件系统一样，操作云端的项目和文件。**

"把本地文件夹同步到云端"（access agent）只是 PuppyOne 的一种接入方式，属于 access 层的一个 connector。

---

## 2. 核心设计问题：Project 上下文

用户可能有几十个 project。执行 `puppyone ls` 时，CLI 怎么知道是哪个 project？

### 行业参考

| 工具 | 策略 | 优点 | 缺点 |
|------|------|------|------|
| `gcloud` | 全局 active project (`gcloud config set project X`) | 简洁，命令最短 | 容易忘记当前在哪个 project |
| `kubectl` | context + namespace (`use-context`) | 精确控制 | 概念多，新手易混淆 |
| `aws` | profile (`--profile X`) | 安全，多环境 | 每次都要指定或设环境变量 |
| `vercel` | 目录绑定 (`vercel link`) | 最直觉 | 只适用于代码项目 |
| `mc` (MinIO) | 每次都写完整路径 (`mc ls alias/bucket/path`) | 无歧义 | 冗长 |

### PuppyOne 的选择：Hybrid — 全局 active project + 显式 override

```bash
# 1. 设置 active project（存入 ~/.puppyone/config.json）
puppyone project use "My Agent"
# → Active project: My Agent (proj_abc123)

# 2. 之后所有命令默认操作 active project
puppyone ls                         # = ls active project 根目录
puppyone ls data/                   # = ls active project 的 data/ 文件夹
puppyone cat README.md              # = cat active project 的 README.md

# 3. 随时可以显式指定另一个 project（不改变 active）
puppyone ls "Research":data/        # 临时看别的 project
puppyone cp "Research":report.pdf ./  # 从别的 project 下载

# 4. 未设 active project 时，命令报错并提示
puppyone ls
# → Error: No active project. Run `puppyone project use <name>` first.
#   Or specify a project: `puppyone ls <project>:<path>`
```

路径解析规则详见 §6.1。

---

## 3. 命令架构（总览）

```
puppyone
│
├── auth                                # 认证 (§4)
│   ├── login                           #   JWT 登录
│   ├── logout                          #   退出
│   └── whoami                          #   身份 + 上下文
│
├── project                             # 项目管理 (§5)
│   ├── ls                              #   列出所有项目
│   ├── use <name|id>                   #   设置 active project
│   ├── current                         #   显示当前 active project
│   ├── create <name>                   #   创建项目
│   ├── info [project]                  #   项目详情
│   └── rm <project>                    #   删除项目
│
├── [文件系统命令]                       # (§6 — 暂略)
│   └── ls, cat, cp, rm, mv, mkdir, tree, info, find
│
├── access                              # 接入层 (§7)
│   ├── agent                           #   Agent 工作区双向同步
│   │   ├── up <path> [--key <key>]     #     启动
│   │   ├── down <path>                 #     停止 daemon
│   │   ├── remove <path>              #     断连 + 注销
│   │   ├── ls                          #     列出所有连接
│   │   ├── ps                          #     运行中进程
│   │   ├── status [path]              #     详细状态
│   │   ├── logs <path> [-f]           #     日志
│   │   └── trigger <path>             #     强制同步
│   └── [future connectors]
│
├── search <query>                      # 语义搜索 (暂略)
│
└── config                              # 全局配置
    ├── show
    └── set <key> <value>
```

---

## 4. Auth 模块 — 详细设计

### 4.1 现状分析

当前 CLI 已有的认证实现：

| 组件 | 位置 | 说明 |
|------|------|------|
| `puppyone login` | `cli/src/commands/login.js` | email+password → JWT，或 `-k` 直接传 token |
| `puppyone logout` | 同上 | 清空 `~/.puppyone/config.json` |
| `puppyone whoami` | 同上 | 显示 email、API URL、服务器可达性 |
| `config.js` | `cli/src/config.js` | 读写 `~/.puppyone/config.json`，存 `api_url`, `api_key`, `refresh_token`, `user_email` |
| `api.js` | `cli/src/api.js` | `createClient(cmd)` → JWT Bearer; `createOpenClawClient(key, cmd)` → X-Access-Key |
| 后端 login | `backend/src/auth/router.py` | `POST /auth/login` → Supabase Auth → access_token + refresh_token |
| 后端 refresh | 同上 | `POST /auth/refresh` → 新 access_token |
| 后端 JWT 校验 | `backend/src/auth/dependencies.py` | `get_current_user()` → 从 Bearer token 解析 CurrentUser |

### 4.2 现存问题

1. **命令层级**：`login`, `logout`, `whoami` 是顶层命令，应当归入 `auth` 子命令组
2. **JWT 过期无自动刷新**：Supabase JWT 默认 1 小时过期，过期后用户直接收到 401，没有自动用 `refresh_token` 续期
3. **whoami 信息不全**：不显示 active project，CLI 版本写死 `0.2.0`
4. **两种认证模式混淆**：JWT (人类用户) 和 Access Key (Agent 机器连接) 存在同一个 config 但用途完全不同，`config.json` 结构不够清晰

### 4.3 双认证体系

PuppyOne CLI 有两种完全独立的认证机制，服务于不同场景：

```
┌─────────────────────────────────────────────────────────────┐
│                      PuppyOne CLI                           │
│                                                             │
│  ┌──────────────────┐          ┌──────────────────────┐     │
│  │   JWT Bearer      │          │   X-Access-Key       │     │
│  │   (人类用户)       │          │   (Agent 机器连接)    │     │
│  │                   │          │                      │     │
│  │  获取方式:         │          │  获取方式:            │     │
│  │  auth login       │          │  Web UI 创建 Agent   │     │
│  │                   │          │  → 复制 mcp_api_key  │     │
│  │  过期:            │          │                      │     │
│  │  1h (自动刷新)    │          │  过期: 永不           │     │
│  │                   │          │  (除非 Agent 被删除)  │     │
│  │  用于:            │          │                      │     │
│  │  auth, project,   │          │  用于:               │     │
│  │  ls, cat, cp,     │          │  access agent 全部    │     │
│  │  rm, search...    │          │  子命令              │     │
│  │                   │          │                      │     │
│  │  存储:            │          │  存储:               │     │
│  │  ~/.puppyone/     │          │  <workspace>/        │     │
│  │  config.json      │          │  .puppyone/state.json │     │
│  └──────────────────┘          └──────────────────────┘     │
│                                                             │
│  两者互不依赖：                                              │
│  • 可以只登录 JWT，不用 access agent                         │
│  • 可以只用 access key，不登录 JWT                           │
│  • 也可以两者都用                                            │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 新命令设计

#### `puppyone auth login`

```bash
# 交互式登录（最常用）
$ puppyone auth login
  Email: user@example.com
  Password: ********
  Logging in...  ✓

  Logged in as user@example.com
  API: http://localhost:9090

# 非交互式（CI / 脚本）
$ puppyone auth login -e user@example.com -p mypassword

# 直接传 token（已有 JWT 时，如从 Web UI 复制）
$ puppyone auth login -k eyJhbGciOi...
  Logged in (token mode).
  API: http://localhost:9090

# 指定自定义 API URL
$ puppyone auth login -u https://api.puppyone.ai
```

**后端交互：**

```
CLI                              Backend
 │  POST /auth/login             │
 │  { email, password }    ───►  │  Supabase Auth
 │                          ◄─── │  { access_token, refresh_token, expires_in, user_email }
 │                               │
 │  存入 ~/.puppyone/config.json │
```

**存储结构：**

```json
{
  "api_url": "http://localhost:9090",
  "api_key": "eyJhbGciOi...",
  "refresh_token": "abc123...",
  "user_email": "user@example.com",
  "token_expires_at": 1740350400,
  "active_project": null
}
```

`token_expires_at` 是新增字段，由 CLI 在登录时计算 `Date.now()/1000 + expires_in`，用于后续自动刷新判断。

#### `puppyone auth logout`

```bash
$ puppyone auth logout
  Logged out. Credentials cleared.
```

清除 `config.json` 中的 `api_key`, `refresh_token`, `user_email`, `token_expires_at`。保留 `api_url` 和 `active_project`。

#### `puppyone auth whoami`

```bash
# 完整状态
$ puppyone auth whoami
  User:      user@example.com
  API:       http://localhost:9090
  Server:    reachable ✓
  Project:   My Agent (proj_abc123)
  CLI:       v0.7.0

# 未登录
$ puppyone auth whoami
  Not logged in.
  Run `puppyone auth login` to get started.

# 登录了但没选 project
$ puppyone auth whoami
  User:      user@example.com
  API:       http://localhost:9090
  Server:    reachable ✓
  Project:   (none — run `puppyone project use <name>`)
  CLI:       v0.7.0
```

### 4.5 自动 Token 刷新

JWT 过期是最影响 CLI 体验的问题。方案：

```
                   ┌─ 每次 API 请求前 ─┐
                   │                    │
                   ▼                    │
        token_expires_at - 300s         │   ← 提前 5 分钟刷新
        > Date.now() / 1000 ?          │
                   │                    │
              Yes ─┼─ No                │
                   │    │               │
                   │    ▼               │
                   │  直接用现有 token   │
                   │                    │
                   ▼                    │
          POST /auth/refresh            │
          { refresh_token }             │
                   │                    │
              成功 ─┼─ 失败              │
                   │    │               │
                   ▼    ▼               │
          更新 config  提示重新登录      │
          继续请求     退出              │
                   │                    │
                   └────────────────────┘
```

**实现位置：** `api.js` 的 `createClient()` 内部，在 `_makeClient` 的 `request()` 函数中加入 refresh 逻辑。对调用方完全透明。

**刷新策略：**
- 提前 5 分钟（300s）刷新，避免在请求进行中过期
- 刷新失败 → 清除 token，抛出友好错误 "Session expired. Run `puppyone auth login`."
- 不存在 `token_expires_at`（旧版 config）→ 不刷新，走原来的逻辑
- Direct token mode（`-k`）→ 不刷新（没有 refresh_token）

### 4.6 向后兼容

| 旧命令 | 新命令 | 处理 |
|--------|--------|------|
| `puppyone login` | `puppyone auth login` | 保留为 alias |
| `puppyone logout` | `puppyone auth logout` | 保留为 alias |
| `puppyone whoami` | `puppyone auth whoami` | 保留为 alias |

`bin/puppyone.js` 中同时注册两种形式。旧的顶层命令标记为 `hidden: true`（Commander.js），不显示在 `--help` 里但仍可用。

---

## 5. Project 模块 — 设计概要

> 文件系统操作暂略，此处仅覆盖 project 管理命令。

### 5.1 命令

```bash
# 列出所有项目
$ puppyone project ls
  ID              NAME              NODES   MODIFIED
  proj_abc123     My Agent          142     2h ago
  proj_def456     Research Data     67      5d ago
  proj_ghi789     Product Catalog   23      1m ago

  3 projects

# 设置 active project
$ puppyone project use "My Agent"
  Active project: My Agent (proj_abc123)

# 显示当前 active project
$ puppyone project current
  My Agent (proj_abc123)

# 项目详情
$ puppyone project info
  Name:      My Agent
  ID:        proj_abc123
  Nodes:     142
  Created:   2026-01-15
  Modified:  2026-02-22
```

### 5.2 后端 API 映射

| CLI 命令 | HTTP | 端点 |
|----------|------|------|
| `project ls` | GET | `/api/v1/projects` |
| `project use` | *纯本地操作*，存入 config.json | — |
| `project current` | *纯本地操作*，读 config.json | — |
| `project info` | GET | `/api/v1/projects/{id}` |
| `project create` | POST | `/api/v1/projects` |
| `project rm` | DELETE | `/api/v1/projects/{id}` |

### 5.3 `project use` 的匹配逻辑

```
输入 "My Agent"
  │
  ├─ 精确匹配 project name? → 命中
  │
  ├─ 精确匹配 project ID?   → 命中
  │
  ├─ 模糊匹配 (唯一前缀)?   → 命中 + 提示 "Matched: My Agent (proj_abc123)"
  │
  └─ 多个匹配 / 无匹配      → 报错 + 列出候选
```

存储：

```json
{
  "active_project": {
    "id": "proj_abc123",
    "name": "My Agent"
  }
}
```

---

## 6. 文件系统命令 — 暂略

> 路径格式：`[project:]<path>`
>
> 路径解析规则：
> - 无冒号 → 用 active project
> - 有冒号 → 冒号前为 project name 或 ID
>
> 详细设计后续补充。

---

## 7. Access 模块 — 详细设计

### 7.1 架构定位

Access 层是 PuppyOne 云端文件系统的"连接器"层。它不是 CLI 的主角（主角是文件系统命令），而是让外部系统能够持续、自动地与 PuppyOne 数据保持同步的一种机制。

```
PuppyOne 云端
    │
    │  /api/v1/access/openclaw/*
    │
    ▼
┌───────────────────────────────────────────────────────┐
│  Access Layer                                         │
│                                                       │
│  ┌─────────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ Agent        │  │ Sandbox  │  │ MCP Client       │ │
│  │ (本地文件夹  │  │ (Docker  │  │ (Cursor/Claude   │ │
│  │  双向同步)   │  │  沙盒)   │  │  Desktop 接入)   │ │
│  └──────┬──────┘  └──────────┘  └──────────────────┘ │
│         │          (future)       (future)            │
└─────────┼─────────────────────────────────────────────┘
          │
          ▼
    用户本地文件夹
    ~/.openclaw/workspace
```

### 7.2 现状分析

当前 "access agent" 在 CLI 中以 `puppyone openclaw` 形式存在，功能已完整实现：

| 组件 | 位置 | 功能 |
|------|------|------|
| `openclaw.js` | `cli/src/commands/openclaw.js` | 所有子命令: up/down/status/logs/connect/disconnect/remove/trigger |
| `daemon.js` | `cli/src/daemon.js` | 后台 daemon: Long Poll 监听变更、chokidar 监听本地文件、双向增量同步 |
| `global.js` | `cli/src/commands/global.js` | 全局命令: ls/ps/status (跨 workspace 视图) |
| `registry.js` | `cli/src/registry.js` | 全局注册表: `~/.puppyone/registry.json` |
| `state.js` | `cli/src/state.js` | Per-workspace 状态: `.puppyone/state.json` |
| `connect.js` | `cli/src/commands/connect.js` | 旧版 connect 命令（有 OpenClaw 和 sync 两种模式） |
| 后端 router | `backend/src/access/openclaw/router.py` | connect/pull/push/changes/upload-url/confirm-upload/status/disconnect |
| 后端 service | `backend/src/access/openclaw/service.py` | 业务逻辑: 认证、cursor-based 增量同步、S3 presigned URL |
| 后端 notifier | `backend/src/sync/notifier.py` | `ChangeNotifier`: Long Poll 通知中心 |

**同步协议概要：**

```
Daemon (CLI)                          Backend
    │                                    │
    │  GET /changes?cursor=N&timeout=30  │
    │  (Long Poll — 挂起等待)       ───►  │
    │                                    │  等待 ChangeNotifier
    │                                    │  ...有人在 Web UI 改了文件...
    │                                    │  ChangeNotifier.notify()
    │  { has_changes: true }        ◄─── │
    │                                    │
    │  GET /pull?cursor=N           ───►  │
    │  { nodes: [...], cursor: M }  ◄─── │  cursor-based 增量
    │                                    │
    │  写入本地文件                        │
    │                                    │
    │  ── 本地文件变化 (chokidar) ──      │
    │                                    │
    │  POST /push (JSON/MD)         ───►  │
    │  POST /upload-url (大文件)    ───►  │  S3 presigned
    │  PUT S3                       ───►  │  直传 S3
    │  POST /confirm-upload         ───►  │
```

### 7.3 认证：Access Key

Access Agent 使用 `X-Access-Key` 而非 JWT：

**为什么不用 JWT？**
- daemon 是长期运行的后台进程，JWT 1h 过期不实际
- daemon 不需要"用户身份"，它代表的是一个 Agent（机器人），不是一个人
- Access Key 绑定到 Agent，Agent 绑定到 Project → 权限明确且固定

**Key 的来源和生命周期：**

```
Web UI: 创建 Agent → 自动生成 mcp_api_key → 用户复制
                                            │
CLI:  puppyone access agent up <path> --key <key>
                                            │
      ┌─────────────────────────────────────┘
      │
      ▼
  首次连接:
    POST /access/openclaw/connect
    Header: X-Access-Key: cli_xxxxx
    → 验证 key → 返回 agent_id, project_id, source_id, nodes
    → CLI 存入 <workspace>/.puppyone/state.json

  后续使用:
    access key 从 state.json 读取
    不需要再传 --key
```

**Key 存储：**

```json
// <workspace>/.puppyone/state.json
{
  "connection": {
    "access_key": "cli_xxxxx",
    "api_url": "http://localhost:9090",
    "source_id": "src_xxx",
    "agent_id": "agt_xxx",
    "project_id": "proj_xxx"
  },
  "cursor": 8847,
  "files": {
    "README.md": { "node_id": "nd_xxx", "version": 3, "hash": "sha256:..." },
    "report.pdf": { "node_id": "nd_yyy", "version": 1, "hash": "sha256:...", "s3": true }
  }
}
```

同时在全局注册表中记录：

```json
// ~/.puppyone/registry.json
{
  "workspaces": {
    "/Users/me/.openclaw/workspace": {
      "access_key": "cli_xxxxx",
      "api_url": "http://localhost:9090",
      "agent_id": "agt_xxx",
      "project_id": "proj_xxx",
      "registered_at": "2026-02-22T10:00:00.000Z",
      "updated_at": "2026-02-22T15:30:00.000Z"
    }
  }
}
```

### 7.4 命令设计

#### 新命令层级

```
puppyone access agent <subcommand>
puppyone openclaw <subcommand>            ← alias（向后兼容）
```

#### `access agent up <path>`

启动同步。最常用命令——一键完成 "连接 + 初始同步 + 启动 daemon"。

```bash
# 首次（需要 access key）
$ puppyone access agent up ~/workspace --key cli_xxxxx
  PuppyOne CLI v0.7.0

  Authenticating...    Connected to "My Agent"
  Syncing...           5 pulled, 2 pushed, 0 conflicts
  Daemon starting...   PID 42381

  Sync is running in background.
    Status:  puppyone access agent status ~/workspace
    Logs:    puppyone access agent logs ~/workspace
    Stop:    puppyone access agent down ~/workspace

# 再次启动（key 已保存，无需再传）
$ puppyone access agent up ~/workspace
  PuppyOne CLI v0.7.0

  Reconciling...       done
  Daemon starting...   PID 42390

  Sync is running in background.

# daemon 已在运行
$ puppyone access agent up ~/workspace
  Daemon already running (PID 42390).
  Use `puppyone access agent down ~/workspace` to stop, then `up` again.
```

**安全保护：**
- 路径 `/`, `~`, `/usr`, `/etc`, `/tmp` 等系统目录 → 拒绝并报错
- 路径不存在 → 自动 `mkdir -p`
- 路径是文件 → 报错

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `<path>` | required | 绝对或相对路径，解析为绝对路径 |
| `--key <key>` | optional | Access Key (首次必填，后续从 state.json 读) |
| `--name <name>` | optional | 连接别名 (显示用) |

#### `access agent down <path>`

```bash
$ puppyone access agent down ~/workspace
  Stopping daemon...  stopped (PID 42390)
```

仅停止 daemon 进程。工作区保持注册状态，`state.json` 保留。下次 `up` 可立即恢复。

#### `access agent remove <path>`

```bash
$ puppyone access agent remove ~/workspace
  Daemon stopped.
  Disconnected from cloud.
  Workspace unregistered. Local files preserved.
```

完整清理：停止 daemon → 调 `/disconnect` API → 从全局 registry 移除。本地文件不删。

#### `access agent ls`

跨所有工作区的概要视图。

```bash
$ puppyone access agent ls

  Agent Connections

  PATH                             NAME          STATUS        FILES   LAST SYNC
  ~/workspace                      My Agent      ● Syncing     142     2s ago
  ~/research                       Research      ○ Stopped     67      3d ago

  2 connections, 1 active
```

**数据来源：**
- `~/.puppyone/registry.json` → 已注册的工作区列表
- `<workspace>/.puppyone/daemon.pid` → daemon 是否存活
- `<workspace>/.puppyone/stats.json` → 最后同步时间、文件数等

#### `access agent ps`

只看正在运行的 daemon 进程和活跃传输。

```bash
$ puppyone access agent ps

  Agent Processes

  PID     WORKSPACE              UPTIME     CURSOR   FILES
  42390   ~/workspace            2h 15m     8847     142

  1 process
```

#### `access agent status [path]`

详细状态。不指定 path 则显示所有。

```bash
$ puppyone access agent status ~/workspace

  Workspace: /Users/me/workspace
  Name:      My Agent

  Connection
    API:        http://localhost:9090
    Agent:      agt_xxx
    Project:    proj_abc123

  Daemon
    Status:     ● Running (PID 42390)
    Uptime:     2h 15m
    Cursor:     8847

  Sync
    Files:      142 tracked
    Last Sync:  2s ago
```

#### `access agent logs <path>`

```bash
$ puppyone access agent logs ~/workspace           # 最近 30 行
$ puppyone access agent logs ~/workspace -n 100    # 最近 100 行
$ puppyone access agent logs ~/workspace -f        # 实时跟踪 (tail -f)
```

#### `access agent trigger <path>`

```bash
$ puppyone access agent trigger ~/workspace
  Trigger sent. Check logs for sync activity.
```

向 daemon 发 `SIGUSR1`，触发一次即时同步循环。

### 7.5 Daemon 架构

```
                   ┌──────────────────────────────────────┐
                   │  Daemon Process (Node.js)             │
                   │                                       │
                   │  ┌─────────────┐  ┌─────────────────┐│
                   │  │ Long Poll   │  │ File Watcher    ││
                   │  │ Loop        │  │ (chokidar)      ││
                   │  │             │  │                  ││
                   │  │ GET /changes│  │ watch <folder>   ││
                   │  │ 超时→重连   │  │ add/change/unlink││
                   │  └──────┬──────┘  └───────┬─────────┘│
                   │         │                  │          │
                   │         ▼                  ▼          │
                   │  ┌───────────────────────────────┐   │
                   │  │  Sync Engine                   │   │
                   │  │                                │   │
                   │  │  • pull: cursor-based 增量      │   │
                   │  │  • push: inline (JSON/MD)      │   │
                   │  │         S3 presigned (其他)     │   │
                   │  │  • conflict: backup + cloud wins│   │
                   │  │  • state: 更新 state.json      │   │
                   │  │  • stats: 更新 stats.json      │   │
                   │  └───────────────────────────────┘   │
                   │                                       │
                   │  PID: <workspace>/.puppyone/daemon.pid│
                   │  Log: <workspace>/.puppyone/daemon.log│
                   └──────────────────────────────────────┘
```

**文件类型路由：**

| 文件类型 | 分类 | Push 方式 | Pull 方式 |
|----------|------|-----------|-----------|
| `.json` | inline | POST `/push` (content in body) | 从 `/pull` 返回的 `node.content` |
| `.md`, `.markdown` | inline | POST `/push` (content in body) | 从 `/pull` 返回的 `node.content` |
| 其他 (`.pdf`, `.png`, `.mp4` 等) | S3 | POST `/upload-url` → PUT S3 → POST `/confirm-upload` | 从 `node.download_url` 下载 |

**Daemon 生命周期：**

```
up → spawnDaemon()
     │
     ├── 写 PID 到 .puppyone/daemon.pid
     ├── 输出重定向到 .puppyone/daemon.log
     ├── detached + unref (父进程可退出)
     │
     ├── 启动 chokidar watcher
     ├── 启动 Long Poll loop
     │
     ├── 定期写 stats.json
     │
     ├── SIGTERM → 优雅退出
     ├── SIGUSR1 → 立即触发一次同步
     └── 异常 → 写日志 + 退出
```

### 7.6 文件存储布局

```
~/.puppyone/                            ← 全局 (所有 workspace 共享)
├── config.json                         ← JWT / API URL / active_project
└── registry.json                       ← 所有 workspace 注册信息

<workspace>/                            ← 用户的工作文件
├── README.md                           ← 同步的文件
├── data/
│   └── users.json
├── report.pdf
└── .puppyone/                          ← Per-workspace 元数据 (gitignore)
    ├── state.json                      ← connection + cursor + file map
    ├── daemon.pid                      ← daemon PID
    ├── daemon.log                      ← daemon 日志
    ├── stats.json                      ← daemon 运行统计
    └── backups/                        ← 冲突文件备份
        └── README.md.1740350400
```

### 7.7 向后兼容 + 迁移

| 现有命令 | 新命令 | 处理 |
|----------|--------|------|
| `puppyone openclaw up` | `puppyone access agent up` | `openclaw` 注册为 `access agent` 的 alias |
| `puppyone openclaw down` | `puppyone access agent down` | 同上 |
| `puppyone oc up` | `puppyone access agent up` | `oc` alias 保留 |
| `puppyone connect --key` | `puppyone access agent up --key` | `connect --key` 逻辑合并到 `access agent up` |
| `puppyone connect -p` | `puppyone access agent up -p` | sync mode 暂时保留但标记 deprecated |
| `puppyone ls` (全局) | `puppyone access agent ls` | 过渡期保留，后续 `ls` 改为文件列表 |
| `puppyone ps` | `puppyone access agent ps` | 保留为快捷方式 |
| `puppyone status` | `puppyone access agent status` | 保留为快捷方式 |

**迁移策略：**

1. **Phase A (现在)**：`access agent` 为正式入口，`openclaw`/`oc` 为 alias；`ls`/`ps`/`status` 同时存在
2. **Phase B (文件命令上线后)**：`puppyone ls` 改为文件列表；`access agent ls` 为唯一的连接列表入口；全局 `ps`/`status` 可保留为 access agent 快捷方式（无歧义）

### 7.8 后端 API 汇总

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/api/v1/access/openclaw/connect` | POST | X-Access-Key | CLI 首次连接，注册 SyncSource |
| `/api/v1/access/openclaw/pull` | GET | X-Access-Key | 拉取 (cursor=0 全量, cursor>0 增量) |
| `/api/v1/access/openclaw/changes` | GET | X-Access-Key | Long Poll 等待变更 |
| `/api/v1/access/openclaw/push` | POST | X-Access-Key | 推送 JSON/MD 变更 |
| `/api/v1/access/openclaw/upload-url` | POST | X-Access-Key | 获取 S3 presigned 上传 URL |
| `/api/v1/access/openclaw/confirm-upload` | POST | X-Access-Key | 确认 S3 上传完成 |
| `/api/v1/access/openclaw/status` | GET | X-Access-Key | 连接状态 |
| `/api/v1/access/openclaw/disconnect` | DELETE | X-Access-Key | 断开连接 |

---

## 8. config.json 完整结构

```json
{
  "api_url": "http://localhost:9090",

  "api_key": "eyJhbGciOi...",
  "refresh_token": "abc123...",
  "user_email": "user@example.com",
  "token_expires_at": 1740350400,

  "active_project": {
    "id": "proj_abc123",
    "name": "My Agent"
  },

  "openclaw_connections": [
    {
      "access_key": "cli_xxxxx",
      "api_url": "http://localhost:9090",
      "folder": "/Users/me/workspace"
    }
  ]
}
```

| 字段 | 用途 | 写入时机 |
|------|------|----------|
| `api_url` | 后端地址 | `auth login` |
| `api_key` | JWT access token | `auth login` |
| `refresh_token` | JWT refresh token | `auth login` |
| `user_email` | 用户邮箱 | `auth login` |
| `token_expires_at` | JWT 过期时间戳 (秒) | `auth login` (新增) |
| `active_project` | 当前活跃项目 | `project use` |
| `openclaw_connections` | access agent 连接列表 | `access agent up` |

---

## 9. 实施优先级

### Phase 1: Auth 重构

> 依赖：无。当前代码可直接重构。

- [ ] `puppyone auth login/logout/whoami` 子命令组 (旧命令保留为 hidden alias)
- [ ] 自动 token 刷新 (`api.js` 内拦截 + `POST /auth/refresh`)
- [ ] `token_expires_at` 写入 config
- [ ] `whoami` 显示 active project + 正确的 CLI 版本
- [ ] `logout` 只清认证字段，保留 api_url 和 active_project

### Phase 2: Project 上下文

> 依赖：Phase 1 (需要 JWT)

- [ ] `project ls` — 调 `GET /api/v1/projects`
- [ ] `project use <name|id>` — 模糊匹配 + 存入 config
- [ ] `project current` — 读 config
- [ ] 路径解析器 `parseProjectPath("Research:data/file.json")`

### Phase 3: Access Agent 迁移

> 依赖：无（独立于 Phase 1/2，可并行）

- [ ] 注册 `access agent` 子命令组，把 `openclaw.js` 逻辑挂载上去
- [ ] `openclaw` / `oc` 注册为 alias
- [ ] `puppyone ls/ps/status` 保留为 `access agent ls/ps/status` 的快捷方式
- [ ] 清理 `connect.js` (OpenClaw mode 合并入 `access agent up`; sync mode 标记 deprecated)
- [ ] 全局 `--json` 输出模式确保 access agent 所有命令可被脚本消费

### Phase 4: 文件系统命令

> 依赖：Phase 1 + Phase 2

- [ ] 详细设计 (另文)
- [ ] `ls`, `cat`, `cp`, `tree`, `info`, `rm`, `mkdir`

---

## 10. 设计决策记录

| # | 决策 | 原因 | 备选 |
|---|------|------|------|
| D1 | Active project 用全局 config，不用目录绑定 | PuppyOne 不是代码项目工具，用户可能在任意目录操作；gcloud 模式最通用 | vercel link (目录绑定) |
| D2 | Access Key 独立于 JWT | daemon 长期运行，JWT 1h 过期不实际；Agent 是机器身份不是人类身份 | JWT + 自动刷新 (复杂度过高) |
| D3 | 旧命令保留为 hidden alias | 不 break 现有用户/脚本 | 直接删除 (不友好) |
| D4 | token 刷新在 api.js 内部透明处理 | 所有命令自动享受，无需每个命令单独处理 | 每个命令自己 catch 401 (重复代码) |
| D5 | `project use` 匹配项目名时先精确后模糊 | 减少用户输入；但保持确定性 (多匹配时报错) | 只支持 ID (太严格) |
