# CLI 规范

PuppyOne 有两个 CLI 工具，职责分明：

- **`puppyone`** — 控制平面操作（登录、项目管理、Access Point 管理、连接管理）
- **`mut`** — 数据平面操作（clone、commit、push、pull——类 Git）

```
┌─────────────────────────────────────────────────────────────┐
│                    PuppyOne (Server)                        │
│                                                             │
│   Project A                                                 │
│   ├── Access Point 1 → https://api.puppyone.com/mut/ap_xxx  │
│   ├── Access Point 2 → https://api.puppyone.com/mut/ap_yyy  │
│   └── Access Point 3 → https://api.puppyone.com/mut/ap_zzz  │
│       (每个 access point 有不同的权限和范围)                  │
│                                                             │
│   puppyone: 创建项目、创建 access point、管理权限             │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ access point URL
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    MUT (Client)                             │
│                                                             │
│   - 只认 access point URL                                    │
│   - 不知道"项目"、"平台"等概念                                │
│   - clone / commit / push / pull                            │
│   - 权限由 server 控制，client 只是执行                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. MUT CLI（数据平面）

### 用户体验

#### 首次使用

```bash
# 1. 登录 PuppyOne
puppyone login

# 2. 创建项目（自动生成 access point）
puppyone project create "My Knowledge Base"
# → Created project: my-knowledge-base
# → Access point: https://api.puppyone.com/mut/ap_abc123
# → Clone with: mut clone https://api.puppyone.com/mut/ap_abc123

# 3. MUT clone（用 access point URL）
mut clone https://api.puppyone.com/mut/ap_abc123 ./my-kb
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
```

#### 多人/多 Agent 协作

```bash
mut clone https://api.puppyone.com/mut/ap_abc123 ./team-kb
cd team-kb/
mut pull          # 拉取别人的更新
mut commit -m "my changes"
mut push
mut log           # 查看历史
mut diff 5 8      # 对比版本
mut rollback 5    # 回滚
```

#### 已有本地文件

```bash
puppyone project create "Existing Data"
# → Access point: https://api.puppyone.com/mut/ap_xyz789

mut clone https://api.puppyone.com/mut/ap_xyz789 ./temp
mv ./temp/.mut ~/my-existing-data/
rm -rf ./temp

cd ~/my-existing-data/
mut commit -m "import existing files"
mut push
```

### 命令参考

| 命令 | 说明 | 示例 |
|------|------|------|
| `mut clone <url> [dir]` | 克隆 access point 到本地 | `mut clone https://api.puppyone.com/mut/ap_abc ./kb` |
| `mut commit -m "msg"` | 创建本地版本快照 | `mut commit -m "update"` |
| `mut push` | 推送到云端 | |
| `mut pull` | 拉取云端最新 | |
| `mut status` | 查看本地与云端差异 | |
| `mut log` | 查看版本历史 | |
| `mut diff <v1> <v2>` | 对比两个版本 | `mut diff 5 8` |
| `mut rollback <ver>` | 回滚到指定版本 | `mut rollback 5` → 创建 v9 |

### 输出示例

#### `mut status`

```
Access Point: https://api.puppyone.com/mut/ap_abc123
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
  "server": "https://api.puppyone.com/mut/ap_abc123",
  "credential": "ak_xxxxxxxx"
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

## 2. PuppyOne CLI（控制平面）

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

```bash
puppyone access create <project> [options]

Options:
  --type <type>        connector 类型 (direct|agent|sandbox|datasource|filesystem|mcp)
  --scope <path>       路径范围 (default: /)
  --permission <perm>  权限 (read|write|rw, default: rw)
  --config <json>      connector 特有配置 (JSON string)
  --name <name>        access point 名称 (可选)

Examples:
  puppyone access create my-project
  puppyone access create my-project --type agent --scope /data
  puppyone access create my-project --type sandbox --permission read --config '{"runtime":"python"}'
```

```bash
puppyone access list <project>

Output:
  ak_abc123  direct  /       rw    default
  ak_xyz789  agent   /data   rw    research-bot
  ak_qwe456  sandbox /code   read  readonly-sandbox
```

```bash
puppyone access delete <access-key>
```

### 文件系统操作

所有 `fs` 命令使用 path-based Tree API（`/api/v1/tree/{projectId}/...`），路径就是 ID，无需 UUID：

| 命令 | 后端端点 | 说明 |
|------|---------|------|
| `fs ls [path]` | `GET /tree/{pid}/ls?path=` | 列目录 |
| `fs tree [path]` | `GET /tree/{pid}/tree?path=` | 递归目录树 |
| `fs cat <path>` | `GET /tree/{pid}/cat?path=` | 读文件 |
| `fs mkdir <path>` | `POST /tree/{pid}/mkdir` | 创建目录 |
| `fs touch <path>` | `POST /tree/{pid}/write` | 创建空文件（按扩展名推断 type） |
| `fs write <path>` | `POST /tree/{pid}/write` | 写入文件 |
| `fs mv <src> <dst>` | `POST /tree/{pid}/move` | 移动/重命名 |
| `fs rm <path>` | `POST /tree/{pid}/rm` | 删除（移入 .trash） |
| `fs info <path>` | `GET /tree/{pid}/stat?path=` | 文件/目录元信息 |
| `fs versions <path>` | `GET /tree/{pid}/versions?path=` | 版本历史 |
| `fs diff <path> <v1> <v2>` | `GET /tree/{pid}/diff?path=&v1=&v2=` | 版本对比 |
| `fs rollback <path> <ver>` | `POST /tree/{pid}/rollback` | 回滚到指定版本 |

#### 输出示例

```bash
$ puppyone fs ls
📁 docs/
📄 readme.md        (1.2 KB, modified 2h ago)
📄 config.json      (256 B, modified 1d ago)
📁 src/
```

```bash
$ puppyone fs versions docs/readme.md
Path: docs/readme.md
Current version: v5

v5  ● HEAD   user:abc123   "Updated introduction"     2m ago    +1 ~0 -0
v4           agent:bot01   "Auto-fix formatting"      1h ago    +0 ~1 -0
v3           user:abc123   "Added section 3"          3h ago    +1 ~0 -0
v2           sync:notion   "Synced from Notion"       1d ago    +0 ~1 -0
v1           user:abc123   "Initial create"           2d ago    +1 ~0 -0
```

### 连接管理

```bash
puppyone conn add notion <url>       # 连接数据源
puppyone conn add folder ~/path      # 挂载本地文件夹
puppyone conn add mcp "name"         # 创建 MCP 端点
puppyone conn add sandbox "name"     # 创建沙盒
puppyone conn ls                     # 列出所有连接
puppyone conn rm <id>                # 删除连接
```

### 其他命令

```bash
puppyone agent chat          # 与 Agent 聊天
puppyone status              # 项目总览
puppyone tool ls             # 列出工具
puppyone ingest <file/url>   # 导入文件/URL
puppyone publish create <path>  # 创建公开链接
```

### 输出格式

所有命令支持双模式输出：
- 默认：人类可读的格式化输出
- `--json`：机器可读的 JSON 输出

---

## 完整示例

### 个人项目

```bash
puppyone login
puppyone project create "Notes"
# → Access point: https://api.puppyone.com/mut/ap_abc

mut clone https://api.puppyone.com/mut/ap_abc ./notes
cd notes/
echo "# My Notes" > README.md
mut commit -m "init"
mut push
```

### 团队协作

```bash
# 管理员
puppyone project create "Team Wiki"
puppyone access create team-wiki --permission rw
# → https://api.puppyone.com/mut/ap_team123

# 团队成员
mut clone https://api.puppyone.com/mut/ap_team123 ./wiki
cd wiki/
# ... 工作 ...
mut commit -m "update"
mut push
```

### Agent 接入

```bash
# 为 Agent 创建只读 access point
puppyone access create my-project --permission read --name "research-bot"
# → https://api.puppyone.com/mut/ap_bot456

# Agent 使用
mut clone https://api.puppyone.com/mut/ap_bot456 ./workspace
mut pull  # 只能拉取，不能推送
```
