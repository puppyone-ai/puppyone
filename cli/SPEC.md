# PuppyOne CLI — Interface Specification

> Version: 0.7.0 | 2026-02-22

## Quick Start

```bash
npm install -g puppyone
puppyone openclaw up ~/.openclaw/workspace --key <access-key> -u <api-url>
```

`up` 自动完成：注册工作区 → 认证 → 初始同步 → 启动后台 daemon。
**终端立刻返回，同步在后台持续运行。** 路径是必填参数，可在任意目录下执行。

之后再次启动只需：
```bash
puppyone openclaw up ~/.openclaw/workspace
```

查看所有同步中的工作区：
```bash
puppyone ls
puppyone ps
```

---

## 命令结构

```
puppyone
├── openclaw (oc)              # OpenClaw Agent 工作区管理
│   ├── up <path> [--key]      # 注册 + 连接 + 同步 + 启动 daemon
│   ├── down <path>            # 停止后台 daemon
│   ├── remove <path>          # 停止 + 断连 + 注销工作区
│   ├── disconnect <path>      # 同 remove
│   ├── logs <path> [-f]       # 查看同步日志
│   └── trigger <path>         # 强制立即同步
│
├── ls                         # 列出所有注册工作区 + 状态
├── ps                         # 列出所有运行中 daemon + 传输
├── status [path]              # 工作区详细状态（省略 path = 全部）
│
├── login                      # JWT 登录（Sync 模式）
├── logout                     # 退出登录
├── whoami                     # 查看当前登录状态
├── connect <folder>           # 通用文件夹同步连接
├── sync                       # 一次性同步
├── watch                      # 持续监听（前台）
├── pull                       # 一次性拉取
└── disconnect                 # 断开连接（通用）
```

---

## 全局命令

### `puppyone ls`

列出所有注册的工作区及同步状态。

```
PuppyOne Workspaces

  PATH                             NAME          STATUS        FILES   LAST SYNC
  ~/.openclaw/workspace            My Agent      ● Syncing     142     2s ago
  ~/projects/app                   App Data      ● Up to date   67     5m ago
  ~/research                       —             ○ Stopped      —      1h ago

  3 workspaces, 2 active
```

### `puppyone ps`

列出所有运行中的 daemon 进程及活跃传输。

```
PuppyOne Processes

  PID     WORKSPACE                      UPTIME     CURSOR   FILES
  42381   ~/.openclaw/workspace          2h 15m     8847     142
  42420   ~/projects/app                 45m        1203      67

  Active Transfers:
  ↑ report.pdf             45.2 / 120.0 MB   37%  ████████░░░░░░░░░░░░

  2 processes, 1 active transfer
```

### `puppyone status [path]`

单个工作区的详细状态（省略 path 则显示所有工作区）。

```
Workspace: ~/.openclaw/workspace
Name:      My Agent

  Connection
    API:        http://localhost:9090
    Agent:      019c850e-ab2c-7f64-a021-bc3b56df6db5
    Project:    proj_abc123

  Daemon
    Status:     ● Running (PID 42381)
    Uptime:     2h 15m
    Cursor:     8847

  Sync
    Files:      142 tracked
    Last Sync:  2s ago
    Conflicts:  1
      - notes.md (2h ago)
```

---

## OpenClaw 模式命令

### `puppyone openclaw up <path>`

**一键启动**：注册工作区 → 连接 → 初始同步 → 启动后台 daemon。

```bash
puppyone openclaw up ~/my-workspace --key <access-key> [-u <api-url>]
```

| 参数/选项 | 必填 | 默认值 | 说明 |
|-----------|------|--------|------|
| `<path>` | **是** | — | 工作区文件夹的绝对或相对路径 |
| `--key` | 首次必填 | — | Access Key（来自 PuppyOne UI） |
| `-u, --api-url` | 否 | `http://localhost:9090` | PuppyOne API 地址 |

**安全检查**：拒绝 `/`、`~`、`/usr` 等危险路径。

**首次运行输出：**
```
PuppyOne CLI v0.7.0

  Authenticating...    Connected to "My Agent"
  Syncing...           2 pulled, 3 pushed, 0 conflicts
  Daemon starting...   PID 42381

Sync is running in background.
  Status:  puppyone openclaw status /Users/me/workspace
  Logs:    puppyone openclaw logs /Users/me/workspace
  Stop:    puppyone openclaw down /Users/me/workspace
```

### `puppyone openclaw down <path>`

停止后台 daemon（保留注册信息，`puppyone ls` 仍可见为 "Stopped"）。

```bash
puppyone openclaw down ~/my-workspace
```

### `puppyone openclaw remove <path>`

停止 daemon → 断开云端连接 → 从全局注册表移除。本地文件不删除。

```bash
puppyone openclaw remove ~/my-workspace
```

### `puppyone openclaw logs <path>`

```bash
puppyone openclaw logs ~/my-workspace          # 最近日志
puppyone openclaw logs ~/my-workspace -f       # 实时跟踪
```

### `puppyone openclaw trigger <path>`

向 daemon 发送 SIGUSR1 信号，触发一次立即同步。

---

## 架构

### 进程模型

每个工作区运行一个独立的 daemon 进程。全局状态通过注册表和统计文件聚合。

```
~/.puppyone/                       ← 全局目录
├── config.json                    ← 认证、API URL
└── registry.json                  ← 所有工作区注册表

<workspace>/.puppyone/             ← Per-workspace
├── state.json                     ← 同步状态（文件映射 + 连接信息 + cursor）
├── daemon.pid                     ← daemon 进程 PID
├── daemon.log                     ← daemon 日志
├── stats.json                     ← daemon 实时统计（ls/ps/status 读取）
└── backups/                       ← 冲突备份
```

### stats.json

Daemon 在以下时机更新：
- 启动时：写入 `pid`, `started_at`
- 每次 pull/long-poll 完成：更新 `last_sync_at`, `files_tracked`, `cursor`
- S3 传输开始/完成：更新 `transfers.active[]`
- 冲突发生：写入 `conflicts[]`
- 错误：写入 `last_error`

`puppyone ls` / `puppyone ps` / `puppyone status` 读取该文件呈现实时数据。

### registry.json

全局工作区注册表。`openclaw up` 注册，`openclaw remove` 注销，`openclaw down` 保留。

### Daemon 通信

- Cloud → Local：HTTP Long Poll（`/access/openclaw/changes`，30s 超时，指数退避）
- Local → Cloud：chokidar 文件监听 → push API / S3 presigned upload
- CLI → Daemon：通过 `stats.json` + `daemon.pid` 间接通信（只读）
- CLI → Daemon 控制：SIGTERM（停止）、SIGUSR1（触发同步）

### 文件分流

| 文件类型 | 上传通道 | 下载通道 |
|----------|----------|----------|
| `.json`, `.md`, `.markdown` | API body (`/push`) | API body (`/pull`) |
| 其他所有文件 | S3 Presigned URL | S3 Presigned URL |

---

## 后端 API 端点

| CLI 操作 | HTTP | 端点 | 认证 |
|----------|------|------|------|
| connect | POST | `/api/v1/access/openclaw/connect` | X-Access-Key |
| pull | GET | `/api/v1/access/openclaw/pull?cursor=N` | X-Access-Key |
| long poll | GET | `/api/v1/access/openclaw/changes?cursor=N&timeout=30` | X-Access-Key |
| push (inline) | POST | `/api/v1/access/openclaw/push` | X-Access-Key |
| upload URL | POST | `/api/v1/access/openclaw/upload-url` | X-Access-Key |
| confirm upload | POST | `/api/v1/access/openclaw/confirm-upload` | X-Access-Key |
| status | GET | `/api/v1/access/openclaw/status` | X-Access-Key |
| disconnect | DELETE | `/api/v1/access/openclaw/disconnect` | X-Access-Key |

---

## 全局配置

路径：`~/.puppyone/config.json`

```json
{
  "api_url": "http://localhost:9090",
  "api_key": null
}
```

---

## 忽略的文件

硬编码忽略（不可配置）：
```
.puppyone/
.git/
node_modules/
__pycache__/
.DS_Store
.env
```

---

## 退出码

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | 通用错误 |
