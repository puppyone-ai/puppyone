# 在 OpenClaw 中使用 PuppyOne 作为工作目录

本文档说明如何通过 AGFS（Agent File System）将 PuppyOne 的云端内容挂载为本地 POSIX 文件系统，使 OpenClaw Agent 能够用标准的 `bash`、`cat`、`ls`、`echo`、`vim` 等命令直接读写 PuppyOne 项目数据。

## 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│  用户本地机器                                                 │
│                                                             │
│  OpenClaw Agent                                             │
│    ↓ POSIX syscalls (read/write/readdir/stat...)            │
│  agfs-fuse  (FUSE 挂载点: ~/puppyone-workspace)              │
│    ↓ HTTP REST (localhost:8080)                              │
│  agfs-server  (puppyonefs plugin)                           │
│    ↓ HTTP REST + X-Internal-Secret                          │
├─────────────────────────────────────────────────────────────┤
│  PuppyOne Cloud                                             │
│    Internal API → ContentNodeService → PostgreSQL / S3      │
└─────────────────────────────────────────────────────────────┘
```

整个流程对 OpenClaw 完全透明：Agent 以为自己在操作本地文件，实际数据存储在 PuppyOne 云端。

---

## 前提条件

| 项目 | 要求 |
|------|------|
| 操作系统 | Linux（agfs-fuse 依赖 FUSE） |
| Go | 1.21+ |
| FUSE | `fuse3` + `libfuse3-dev`（或对应发行版的包） |
| PuppyOne | 一个运行中的 PuppyOne 后端实例 |
| OpenClaw | 已安装并可用 |

### 安装 FUSE（Linux）

```bash
# Debian / Ubuntu
sudo apt-get install fuse3 libfuse3-dev

# CentOS / RHEL
sudo yum install fuse3 fuse3-devel

# Arch
sudo pacman -S fuse3
```

> macOS 暂不支持 agfs-fuse。如果你在 macOS 上工作，可以在 Linux 虚拟机或远程服务器上运行 agfs-fuse，然后通过 sshfs 或 NFS 共享挂载点。

---

## 第一步：构建 agfs-server 和 agfs-fuse

从项目根目录开始：

```bash
# 1. 构建 agfs-server（包含 puppyonefs 插件）
cd agfs-master/agfs-server
make build
# 产物: ./build/agfs-server

# 2. 构建 agfs-fuse
cd ../agfs-fuse
make build
# 产物: ./build/agfs-fuse
```

如果没有 `make`，也可以直接用 `go build`：

```bash
# agfs-server
cd agfs-master/agfs-server
go build -o build/agfs-server ./cmd/server/

# agfs-fuse
cd agfs-master/agfs-fuse
go build -o build/agfs-fuse ./cmd/agfs-fuse/
```

验证构建成功：

```bash
./agfs-master/agfs-server/build/agfs-server --version
./agfs-master/agfs-fuse/build/agfs-fuse --version
```

---

## 第二步：获取 PuppyOne 配置信息

你需要从 PuppyOne 获取三项信息：

### 2.1 Internal API Secret

这是 PuppyOne 后端部署时配置的 `INTERNAL_API_SECRET` 环境变量。

- **自托管部署**：在你的部署配置（Railway / Docker / .env）中查找 `INTERNAL_API_SECRET`
- **开发环境**：在 `backend/.env` 文件中查找

```bash
# 示例：在后端目录查找
grep INTERNAL_API_SECRET backend/.env
```

### 2.2 项目 ID（Project ID）

在 PuppyOne 前端界面中：

1. 打开你要挂载的项目
2. 进入 **Settings** 页面
3. 复制项目 ID（格式如 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`）

或者通过 URL 获取：浏览器地址栏中 `/projects/` 后面的 UUID 就是项目 ID。

### 2.3 根节点信息（Root Accesses）

根节点决定了挂载后能看到哪些顶层目录。你需要获取要暴露的文件夹的：

- `node_id` — 节点 UUID
- `node_name` — 显示名称（将作为挂载点下的目录名）
- `node_type` — 通常是 `folder`

获取方式：

1. 在 PuppyOne 前端的 **Data** 页面中，点击你想要暴露的根文件夹
2. 在 URL 或节点详情中复制节点 ID
3. 也可以通过 Internal API 直接查询：

```bash
# 列出项目的根节点
curl -H "X-Internal-Secret: YOUR_SECRET" \
  "https://your-api-url/internal/nodes/ROOT_NODE_ID/children?project_id=YOUR_PROJECT_ID"
```

---

## 第三步：创建配置文件

创建 `config.puppyone.yaml`（可以放在任意位置）：

```yaml
server:
  address: ":8080"
  log_level: "info"

plugins:
  puppyonefs:
    enabled: true
    path: "/puppyone"
    config:
      # ====== 必填：替换为你的实际值 ======

      # PuppyOne 后端 API 地址
      api_url: "https://your-api-url.example.com"

      # Internal API Secret
      api_secret: "your-internal-secret-here"

      # 项目 ID
      project_id: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

      # 根节点列表
      root_accesses:
        - node_id: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          node_name: "docs"
          node_type: "folder"

      # ====== 可选配置 ======

      # 元数据缓存 TTL（秒），默认 30
      # 降低此值 = 数据更新更及时，但延迟更高
      # 提高此值 = 读取更快，但可能看到过期数据
      cache_ttl: 30

      # 只读模式，默认 false
      readonly: false
```

**多根目录示例**（挂载后会显示为多个顶层文件夹）：

```yaml
      root_accesses:
        - node_id: "aaa-..."
          node_name: "docs"
          node_type: "folder"
        - node_id: "bbb-..."
          node_name: "data"
          node_type: "folder"
        - node_id: "ccc-..."
          node_name: "configs"
          node_type: "folder"
```

**本地开发示例**（后端运行在 localhost:9090）：

```yaml
      api_url: "http://localhost:9090"
      api_secret: "dev-secret"
```

---

## 第四步：启动 agfs-server

```bash
./agfs-master/agfs-server/build/agfs-server -c config.puppyone.yaml
```

看到类似输出说明启动成功：

```
INFO  puppyonefs: initialized for project xxx (api=https://..., roots=1, cache_ttl=30s, readonly=false)
INFO  puppyonefs instance 'puppyonefs' mounted at /puppyone
INFO  Starting AGFS server on :8080
```

> **提示**：可以用 `-addr :9000` 覆盖端口，用于避免与其他服务冲突。

### 验证 agfs-server 是否正常

```bash
# 列出挂载的插件
curl http://localhost:8080/api/v1/readdir?path=/

# 列出 PuppyOne 挂载点的根目录
curl http://localhost:8080/api/v1/readdir?path=/puppyone

# 读取某个文件的内容
curl "http://localhost:8080/api/v1/read?path=/puppyone/docs/readme.md"
```

---

## 第五步：FUSE 挂载到本地目录

```bash
# 创建挂载点目录
mkdir -p ~/puppyone-workspace

# 挂载
./agfs-master/agfs-fuse/build/agfs-fuse \
  --agfs-server-url http://localhost:8080 \
  --mount ~/puppyone-workspace
```

挂载成功后，你可以直接用标准命令操作：

```bash
# 列出文件
ls ~/puppyone-workspace/puppyone/

# 读取文件
cat ~/puppyone-workspace/puppyone/docs/readme.md

# 写入文件
echo "Hello from local!" > ~/puppyone-workspace/puppyone/docs/hello.md

# 创建目录
mkdir ~/puppyone-workspace/puppyone/docs/new-folder
```

### agfs-fuse 常用参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--agfs-server-url` | agfs-server 地址 | `http://localhost:8080` |
| `--mount` | 本地挂载点路径 | （必填） |
| `--cache-ttl` | FUSE 层缓存 TTL | `5s` |
| `--debug` | 开启调试输出 | `false` |
| `--allow-other` | 允许其他用户访问 | `false` |

### 卸载

```bash
# 方法 1：在 agfs-fuse 终端按 Ctrl+C

# 方法 2：手动卸载
fusermount -u ~/puppyone-workspace
```

---

## 第六步：配置 OpenClaw

编辑 OpenClaw 配置文件（通常是 `~/.config/openclaw/config.json` 或项目级配置），将 workspace 指向挂载点：

```json
{
  "agents": {
    "defaults": {
      "workspace": "~/puppyone-workspace/puppyone"
    }
  }
}
```

> **路径说明**：`~/puppyone-workspace` 是 FUSE 挂载点，`/puppyone` 是 agfs-server 中配置的插件路径（`path: "/puppyone"`）。

完成后，OpenClaw Agent 的所有文件操作都会透明地映射到 PuppyOne 云端数据。

---

## 使用示例

配置完成后，OpenClaw Agent 可以像操作本地文件一样操作 PuppyOne 数据：

```bash
# Agent 浏览项目文件
ls -la docs/
tree docs/ -L 2

# Agent 读取 JSON 数据（自动 pretty-print）
cat docs/api-config.json

# Agent 编辑 Markdown 文档
echo "## New Section\n\nContent here." >> docs/readme.md

# Agent 创建新的 JSON 配置
echo '{"key": "value", "enabled": true}' > docs/settings.json

# Agent 创建新目录并添加文件
mkdir -p docs/guides
echo "# Getting Started" > docs/guides/quickstart.md

# Agent 重命名/移动文件
mv docs/old-name.md docs/new-name.md

# Agent 删除文件（移入 PuppyOne 回收站，可恢复）
rm docs/deprecated.md
```

---

## 文件类型映射

PuppyOne 节点类型与文件系统的对应关系：

| PuppyOne 节点类型 | 文件系统表现 | 权限 | 说明 |
|---|---|---|---|
| `folder` | 目录 | `drwxr-xr-x` | 可读写 |
| `json` | `.json` 文件 | `-rw-r--r--` | 内容为 pretty-printed JSON |
| `markdown` | `.md` 文件 | `-rw-r--r--` | 内容为原始 Markdown 文本 |
| `file` (S3) | 二进制文件 | `-rw-r--r--` | 通过 S3 presigned URL 传输 |
| synced (notion/github/…) | 只读文件 | `-r--r--r--` | 内容取 preview 数据，不可修改 |

**创建文件时的类型推断**（根据文件扩展名）：

| 文件名 | 创建的节点类型 |
|--------|---------------|
| `*.json` | json |
| `*.md` / `*.markdown` | markdown |
| 其他 | file（S3 存储） |

---

## 完整启动脚本

为方便日常使用，可以创建一个启动脚本 `start-puppyone-workspace.sh`：

```bash
#!/bin/bash
set -e

# === 配置 ===
AGFS_SERVER="./agfs-master/agfs-server/build/agfs-server"
AGFS_FUSE="./agfs-master/agfs-fuse/build/agfs-fuse"
CONFIG="./config.puppyone.yaml"
MOUNT_POINT="$HOME/puppyone-workspace"
SERVER_PORT="8080"

# === 检查 ===
if [ ! -f "$AGFS_SERVER" ]; then
  echo "Error: agfs-server not found. Run: cd agfs-master/agfs-server && make build"
  exit 1
fi
if [ ! -f "$AGFS_FUSE" ]; then
  echo "Error: agfs-fuse not found. Run: cd agfs-master/agfs-fuse && make build"
  exit 1
fi
if [ ! -f "$CONFIG" ]; then
  echo "Error: config file not found at $CONFIG"
  exit 1
fi

# === 创建挂载点 ===
mkdir -p "$MOUNT_POINT"

# === 启动 agfs-server（后台） ===
echo "Starting agfs-server on port $SERVER_PORT..."
$AGFS_SERVER -c "$CONFIG" -addr ":$SERVER_PORT" &
SERVER_PID=$!
sleep 2

# 检查 server 是否成功启动
if ! kill -0 $SERVER_PID 2>/dev/null; then
  echo "Error: agfs-server failed to start"
  exit 1
fi

# === 挂载 FUSE ===
echo "Mounting PuppyOne workspace at $MOUNT_POINT..."
$AGFS_FUSE --agfs-server-url "http://localhost:$SERVER_PORT" --mount "$MOUNT_POINT" &
FUSE_PID=$!
sleep 1

echo ""
echo "✓ PuppyOne workspace ready at: $MOUNT_POINT/puppyone"
echo "  agfs-server PID: $SERVER_PID"
echo "  agfs-fuse   PID: $FUSE_PID"
echo ""
echo "To stop: kill $FUSE_PID $SERVER_PID && fusermount -u $MOUNT_POINT"

# === 等待退出 ===
trap "kill $FUSE_PID $SERVER_PID 2>/dev/null; fusermount -u $MOUNT_POINT 2>/dev/null" EXIT
wait
```

使用方式：

```bash
chmod +x start-puppyone-workspace.sh
./start-puppyone-workspace.sh
```

---

## 故障排查

### agfs-server 启动失败

| 错误 | 原因 | 解决 |
|------|------|------|
| `puppyonefs: api_url is required` | 配置文件缺少 `api_url` | 检查 `config.puppyone.yaml` |
| `puppyonefs: api_secret is required` | 配置文件缺少 `api_secret` | 填入 Internal API Secret |
| `API error 403` | Secret 不正确 | 确认 `api_secret` 与后端 `INTERNAL_API_SECRET` 一致 |
| `API error 404` | 项目 ID 或节点 ID 不存在 | 核实 `project_id` 和 `root_accesses` 中的 ID |

### agfs-fuse 挂载失败

| 错误 | 原因 | 解决 |
|------|------|------|
| `fusermount: fuse device not found` | FUSE 未安装 | 安装 `fuse3` 和 `libfuse3-dev` |
| `Transport endpoint is not connected` | 上次未正常卸载 | 执行 `fusermount -u ~/puppyone-workspace` |
| `mount point is not empty` | 挂载点目录不为空 | 清空目录或换一个路径 |
| `connection refused` | agfs-server 未运行 | 先启动 agfs-server |

### 文件操作问题

| 现象 | 原因 | 解决 |
|------|------|------|
| `ls` 结果过期 | 缓存未失效 | 等待 `cache_ttl` 秒或降低 TTL |
| 写入 `.json` 文件报错 | 内容不是合法 JSON | 确保写入的内容可被 `json.Unmarshal` 解析 |
| 无法修改 synced 节点 | notion/github 等同步节点只读 | 这些节点不支持写入 |
| `cat` 文件显示空 | `size_bytes` 未更新 | 后端已修复此问题，确保使用最新版本 |

### 日志调试

```bash
# agfs-server 开启 debug 日志
# 在 config.yaml 中设置:
server:
  log_level: "debug"

# agfs-fuse 开启 debug
./agfs-fuse --agfs-server-url http://localhost:8080 --mount ~/puppyone-workspace --debug
```

---

## 高级配置

### 只读模式

如果只需要 Agent 读取数据而不修改：

```yaml
      readonly: true
```

### 多项目挂载

可以在同一个 agfs-server 中挂载多个 PuppyOne 项目：

```yaml
plugins:
  puppyonefs:
    instances:
      - name: "project-a"
        enabled: true
        path: "/project-a"
        config:
          api_url: "https://api.puppyone.app"
          api_secret: "secret-a"
          project_id: "proj-a-id"
          root_accesses:
            - node_id: "..."
              node_name: "root"
              node_type: "folder"

      - name: "project-b"
        enabled: true
        path: "/project-b"
        config:
          api_url: "https://api.puppyone.app"
          api_secret: "secret-b"
          project_id: "proj-b-id"
          root_accesses:
            - node_id: "..."
              node_name: "root"
              node_type: "folder"
```

挂载后目录结构：

```
~/puppyone-workspace/
├── project-a/
│   └── root/
│       ├── file1.json
│       └── file2.md
└── project-b/
    └── root/
        ├── data.json
        └── readme.md
```

### 性能调优

| 参数 | 建议 | 说明 |
|------|------|------|
| `cache_ttl`（agfs-server 插件） | 30-60s | 元数据缓存，越高延迟越低但数据越可能过期 |
| `--cache-ttl`（agfs-fuse） | 5-10s | FUSE 层缓存 |

对于 Agent 密集读取场景（如反复 `cat` 大量文件），建议提高 `cache_ttl` 到 60s。对于写入为主的场景，保持默认 30s。

---

## 快速参考

```bash
# 一键构建
cd agfs-master/agfs-server && make build && cd ../agfs-fuse && make build && cd ../..

# 启动 server
./agfs-master/agfs-server/build/agfs-server -c config.puppyone.yaml

# 挂载（另一个终端）
mkdir -p ~/puppyone-workspace
./agfs-master/agfs-fuse/build/agfs-fuse \
  --agfs-server-url http://localhost:8080 \
  --mount ~/puppyone-workspace

# 验证
ls ~/puppyone-workspace/puppyone/

# 卸载
fusermount -u ~/puppyone-workspace
```
