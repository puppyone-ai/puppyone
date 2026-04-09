# puppyone data

远程直接操作 PuppyOne 云端文件系统的 CRUD 命令。

## 概述

`puppyone data` 提供 POSIX 风格的文件操作命令，直接调用后端 Content API 读写 MUT 内容树。所有写操作经过 MUT 引擎（clone→push），自动产生版本记录和审计日志。

```
  puppyone data ──→  Content API ──→ MutOps  ←── 前端 Web UI
  (远程直接操作)      /api/v1/content/{pid}/...

  mut push/pull ──→  MUT Protocol ──→ MutOps
  (本地 sync)        /api/v1/mut/{pid}/...
```

`puppyone data` 和 `mut` 最终都走 MutOps，版本历史和审计日志完全一致。区别在于：

- **`puppyone data`** — 远程直接操作，无需本地 clone。适合快速查看/修改、脚本自动化、AI agent。
- **`mut`** — 本地工作目录 + sync 协议（git-like）。适合持续性开发、多文件协作。

`puppyone data` 只做 **CRUD + 回收站**。版本管理（log、diff、rollback）由 `mut` 负责。

## 认证与项目

使用 JWT 认证（用户已通过 `puppyone auth login` 登录）。

项目通过 `--project <id>` 指定，或使用 `puppyone project use` 设置的活跃项目。

---

## Bash 文件操作覆盖表

标准 bash 文件系统操作与 `puppyone data` 的完整对照。

### 文件读取/显示

| Bash 命令 | `puppyone data` | 备注 |
|-----------|----------------|------|
| `cat` | ✅ `cat` | |
| `head -n N` | — | `data cat \| head` |
| `tail -n N` | — | `data cat \| tail` |
| `less` / `more` | — | `data cat \| less` |
| `strings` | — | 不适用 |
| `hexdump` / `xxd` / `od` | — | 不适用 |
| `file` (MIME 检测) | ✅ `stat` | stat 输出含 mime_type |

### 文件写入/创建

| Bash 命令 | `puppyone data` | 备注 |
|-----------|----------------|------|
| `echo "x" > file` | ✅ `write` | 覆盖写入 |
| `echo "x" >> file` | 🔜 `append` | 第二期 |
| `touch` | ✅ `touch` | 创建空文件 |
| `tee` | — | 不适用 |
| `truncate` | — | 不适用 |
| `mktemp` | — | 不适用 |
| `dd` | — | 不适用 |

### 文件复制/移动/删除

| Bash 命令 | `puppyone data` | 备注 |
|-----------|----------------|------|
| `cp` | ✅ `cp` | CLI 层 read + write |
| `cp -r` | ✅ `cp` | CLI 层 tree + bulk write |
| `mv` | ✅ `mv` | |
| `rm` | ✅ `rm` | 默认进回收站 |
| `rm -r` | ✅ `rm` | 支持删除文件夹 |
| `rm -f` | ✅ `rm --force` | 永久删除 |
| `rmdir` | ✅ `rm` | rm 已覆盖 |
| `shred` | — | 不适用（MUT 有版本历史） |
| `rsync` | — | 由 `mut push/pull` 负责 |
| `scp` | — | `puppyone data` 本身就是远程操作 |

### 目录操作

| Bash 命令 | `puppyone data` | 备注 |
|-----------|----------------|------|
| `ls` | ✅ `ls` | |
| `ls -la` | ✅ `ls --long` | |
| `ls -R` | ✅ `tree` | |
| `tree` | ✅ `tree` | |
| `mkdir` | ✅ `mkdir` | |
| `mkdir -p` | ✅ `mkdir` | 后端自动创建中间目录 |
| `pwd` | — | N/A，始终从项目根开始 |
| `cd` | — | N/A |
| `pushd` / `popd` / `dirs` | — | N/A |

### 文件信息/元数据

| Bash 命令 | `puppyone data` | 备注 |
|-----------|----------------|------|
| `stat` | ✅ `stat` | |
| `file` | ✅ `stat` | stat 含 mime_type |
| `du` / `du -sh` | — | `data tree --json \| jq` |
| `df` | — | 不适用 |
| `wc` | — | `data cat \| wc` |
| `md5sum` / `sha256sum` | ✅ `stat` | stat 含 content_hash |
| `readlink` / `realpath` | — | N/A（无符号链接） |

### 文件搜索

| Bash 命令 | `puppyone data` | 备注 |
|-----------|----------------|------|
| `find` | 🔜 `find` | 第二期（CLI 层 tree + glob 过滤） |
| `grep` / `grep -r` | 🔜 `grep` | 第二期（需后端接口） |
| `locate` | — | 不适用 |

### 文件内容处理

| Bash 命令 | `puppyone data` | 备注 |
|-----------|----------------|------|
| `sed` | — | `data cat \| sed ... \| data write` |
| `awk` | — | `data cat \| awk ... \| data write` |
| `sort` | — | `data cat \| sort` |
| `uniq` | — | `data cat \| uniq` |
| `cut` / `paste` / `tr` | — | `data cat \| ...` |
| `split` / `csplit` | — | 不适用 |
| `jq` (JSON 处理) | — | `data cat \| jq ... \| data write` |

### 文件对比

| Bash 命令 | `puppyone data` | 备注 |
|-----------|----------------|------|
| `diff` | — | 版本对比由 `mut diff` 负责 |
| `cmp` / `comm` / `sdiff` | — | 不适用 |
| `patch` | — | 不适用 |

### 版本管理

| Bash/Git 命令 | `puppyone data` | 备注 |
|--------------|----------------|------|
| `git log` | — | 由 `mut log` 负责 |
| `git diff` | — | 由 `mut diff` 负责 |
| `git checkout` | — | 由 `mut checkout` / `mut rollback` 负责 |
| `git status` | — | 由 `mut status` 负责 |

### 不适用的操作

以下 bash 操作在 PuppyOne 云端文件系统中不适用：

| 类别 | 命令 | 原因 |
|------|------|------|
| 权限 | `chmod` / `chown` / `chgrp` / `umask` | MUT 无文件级权限（通过 access point scope 管理） |
| 链接 | `ln` / `ln -s` | MUT 不支持符号链接 |
| 压缩 | `tar` / `gzip` / `zip` | 不适用 |
| 编码 | `iconv` / `base64` | 不适用 |
| 监控 | `inotifywait` / `fswatch` / `tail -f` | 由 `mut` sync daemon 负责 |
| 挂载 | `mount` / `umount` | 不适用 |
| 传输 | `curl` / `wget` / `ftp` | `puppyone data` 本身就是远程操作 |

---

## 命令参考

### 读操作

#### `ls` — 列目录

```bash
puppyone data ls [path]
```

| 参数/选项 | 说明 |
|----------|------|
| `[path]` | 目录路径，省略则为项目根目录 |
| `--long` | 详细模式（含大小、类型、content hash） |

```bash
puppyone data ls                      # 项目根目录
puppyone data ls docs                 # docs/ 目录
puppyone data ls docs --long          # 详细列表
```

输出示例：

```
$ puppyone data ls docs
📁 architecture     3 items
📄 README.md        1.2 KB
```

#### `cat` — 读文件

```bash
puppyone data cat <path>
```

将文件内容输出到 stdout。JSON 文件输出格式化 JSON，其他输出原始文本。

```bash
puppyone data cat docs/readme.md
puppyone data cat config.json
```

#### `tree` — 目录树

```bash
puppyone data tree [path]
```

| 参数/选项 | 说明 |
|----------|------|
| `[path]` | 起始路径，省略则为项目根 |
| `--depth <n>` | 最大递归深度，默认无限 |

```bash
puppyone data tree
puppyone data tree docs --depth 2
```

#### `stat` — 文件信息

```bash
puppyone data stat <path>
```

输出文件/目录的元数据：类型、大小、content hash、mime type。

```bash
puppyone data stat docs/readme.md
```

---

### 写操作

#### `write` — 写文件

```bash
puppyone data write <path> [options]
```

| 选项 | 说明 |
|-----|------|
| `--content <text>` | 内联内容 |
| `--file <local-path>` | 从本地文件读取内容 |
| `--type <json\|markdown\|file>` | 文件类型（默认按扩展名自动检测） |
| `-m, --message <msg>` | 自定义 commit message（默认 `edit {path}`） |

支持三种输入方式：

```bash
puppyone data write docs/note.md --content "# Hello"           # 内联
puppyone data write docs/config.json --file ./local.json       # 本地文件
echo '{"key":"val"}' | puppyone data write docs/data.json      # stdin 管道
```

#### `touch` — 创建空文件

```bash
puppyone data touch <path>
```

```bash
puppyone data touch docs/draft.md
```

#### `mkdir` — 创建目录

```bash
puppyone data mkdir <path>
```

自动创建中间目录。

```bash
puppyone data mkdir notes
puppyone data mkdir deep/nested/folder
```

#### `cp` — 复制

```bash
puppyone data cp <src> <dst>
```

CLI 层实现（read + write）。

```bash
puppyone data cp docs/template.md docs/new-doc.md
```

#### `mv` — 移动/重命名

```bash
puppyone data mv <src> <dst>
```

```bash
puppyone data mv docs/old.md docs/new.md
puppyone data mv old-folder new-folder
```

#### `rm` — 删除

```bash
puppyone data rm <path>
```

| 选项 | 说明 |
|-----|------|
| `--force` | 永久删除（跳过回收站） |

默认移到 `.trash`，可通过 `restore` 恢复。

```bash
puppyone data rm docs/draft.md             # → 进回收站
puppyone data rm docs/draft.md --force     # → 永久删除
puppyone data rm old-folder                # 整个文件夹
```

---

### 回收站

#### `trash` — 查看回收站

```bash
puppyone data trash
```

#### `restore` — 从回收站恢复

```bash
puppyone data restore <trash-path> [original-path]
```

```bash
puppyone data restore .trash/draft_1712345678.md docs/draft.md
```

---

### 第二期：搜索与高级操作

```bash
puppyone data find <pattern>              # 按文件名搜索（CLI 层 tree + glob 过滤）
puppyone data grep <pattern> [path]       # 按内容搜索（需后端接口）
puppyone data append <path> --content "x" # 追加写入（CLI 层 read + append + write）
```

---

## Commit Message

所有写操作自动产生 MUT commit，`who` 字段为 `user:{user_id}`。

| 命令 | 默认 message | `-m` 自定义 |
|------|-------------|------------|
| `write` | `edit {path}` | ✅ |
| `touch` | `create {path}` | ✅ |
| `mkdir` | `mkdir {path}` | ✅ |
| `cp` | `copy {src} → {dst}` | ✅ |
| `mv` | `moved {src} → {dst}` | ✅ |
| `rm` | `trash {path}` / `delete {path}` | ✅ |
| `restore` | `restore {path}` | ✅ |

---

## 输出格式

所有命令支持 `--json` 标志，输出机器可读的 JSON（和 `puppyone` 其他命令一致）：

```bash
$ puppyone data ls docs --json
{
  "success": true,
  "entries": [
    {"name": "architecture", "type": "folder", "children_count": 5},
    {"name": "README.md", "type": "markdown", "size_bytes": 1234, "content_hash": "abc123"}
  ]
}
```

---

## Unix 管道

`cat` 输出到 stdout，可以和本地工具自由组合，无需内置 `head`/`tail`/`wc`/`grep`/`sort`：

```bash
puppyone data cat docs/readme.md | grep "TODO"
puppyone data cat docs/readme.md | wc -l
puppyone data cat docs/readme.md | head -20
puppyone data cat config.json | jq '.version = "2.0"' | puppyone data write config.json
```

---

## 后端 API 映射

| CLI 命令 | HTTP | 后端端点 |
|---------|------|---------|
| `data ls` | GET | `/api/v1/content/{pid}/ls?path=...` |
| `data cat` | GET | `/api/v1/content/{pid}/cat?path=...` |
| `data tree` | GET | `/api/v1/content/{pid}/tree?path=...&max_depth=...` |
| `data stat` | GET | `/api/v1/content/{pid}/stat?path=...` |
| `data write` | POST | `/api/v1/content/{pid}/write` |
| `data touch` | POST | `/api/v1/content/{pid}/write`（空内容） |
| `data mkdir` | POST | `/api/v1/content/{pid}/mkdir` |
| `data cp` | GET `cat` + POST `write`（CLI 层组合） | — |
| `data mv` | POST | `/api/v1/content/{pid}/mv` |
| `data rm` | POST | `/api/v1/content/{pid}/rm` |
| `data trash` | GET | `/api/v1/content/{pid}/trash` |
| `data restore` | POST | `/api/v1/content/{pid}/restore` |

所有后端端点已存在，无需后端改动。

---

## 实现文件

| 文件 | 说明 |
|------|------|
| `cli/src/commands/data.js` | 命令实现 |
| `cli/bin/puppyone.js` | 注册 `registerData(program)` |

