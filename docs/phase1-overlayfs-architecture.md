# 阶段 1：OverlayFS 改造 — 详细技术方案

## 一、目标

用 OverlayFS 替代现有的"全量复制"方式，实现：

| 指标 | 现在（全量复制） | 改造后（OverlayFS） |
|------|----------------|-------------------|
| 启动一个 Agent 沙盒 | 下载所有文件到 temp 目录 | 共享 Lower 已有，只创建空 Upper |
| 10 个 Agent 并发 | 10 × 全量下载 | 1 份 Lower + 10 个空 Upper |
| Agent 改了 1 个文件 | 全量读回所有文件 | 只扫描 Upper 的 diff |
| 存储 | 每个 Agent 一份完整拷贝 | 共享 Lower + Agent 只存改动 |

## 二、核心设计：不破坏现有架构，加一条新路径

```
现有路径（保留，不动）：
  Agent → DockerSandbox.start_with_files() → 全量复制 → volume mount → 全量读回

新路径（新增，通过路由选择）：
  Agent → OverlaySandbox.start() → 共享 Lower + 独立 Upper → overlay mount → 增量读回
```

**路由逻辑：** 在 `SandboxService` 层加一个开关，根据配置或节点类型选择使用哪个沙盒后端。

## 三、架构总图

```
                    macOS 宿主机
                         │
                    Docker Desktop
                    (LinuxKit VM)
                         │
    ┌────────────────────┼────────────────────┐
    │                    │                    │
    │   Docker Volume    │                    │
    │   "cb-lower"       │                    │
    │   (共享只读数据)    │                    │
    │        │           │                    │
    │   ┌────┴────┐  ┌───┴────┐  ┌───────┐   │
    │   │Agent A  │  │Agent B │  │Sync   │   │
    │   │Container│  │Contain.│  │Worker │   │
    │   │         │  │        │  │       │   │
    │   │/lower   │  │/lower  │  │更新   │   │
    │   │ (ro)    │  │ (ro)   │  │cb-lower│  │
    │   │         │  │        │  │Volume  │   │
    │   │tmpfs    │  │tmpfs   │  └───────┘   │
    │   │/upper   │  │/upper  │               │
    │   │ (rw)    │  │ (rw)   │               │
    │   │         │  │        │               │
    │   │overlay  │  │overlay │               │
    │   │/workspace│ │/workspace              │
    │   │ (merged)│  │(merged)│               │
    │   └────────┘  └────────┘               │
    │                                         │
    └─────────────────────────────────────────┘
```

## 四、组件详解

### 4.1 Docker Volume "cb-lower"（共享只读层）

一个持久的 Docker Volume，存放从 S3+PG 同步下来的文件。所有 Agent 容器以只读方式挂载。

```bash
# 创建（一次性）
docker volume create cb-lower
```

**内容结构：**
```
cb-lower/
├── {project_id}/
│   ├── {node_id_1}.json          # JSON 节点 → 序列化为文件
│   ├── {node_id_2}.md            # Markdown 节点
│   ├── {node_id_3}/              # 文件夹节点 → 子目录
│   │   ├── {child_id_1}.json
│   │   └── {child_id_2}.pdf      # S3 文件 → 下载到本地
│   └── .metadata.json            # 节点元数据（id, name, type, version 等）
```

### 4.2 Sync Worker（下行同步：S3+PG → Volume）

一个后台进程/容器，负责保持 `cb-lower` Volume 和 S3+PG 数据的同步。

**同步策略：**
```
首次同步：全量拉取
后续同步：增量 — 比对 content_nodes.updated_at 和 .metadata.json 中的时间戳
```

**同步频率：**
- 懒模式：Agent 启动前触发一次同步
- 定时模式：每 30s 检查一次是否有更新
- 事件模式（未来）：PG NOTIFY 触发

**实现方式：** 一个挂载了 `cb-lower` Volume 的容器，运行同步脚本：

```bash
docker run --rm \
  -v cb-lower:/data \
  -e SUPABASE_URL=... \
  -e SUPABASE_KEY=... \
  sync-worker python sync.py
```

### 4.3 Agent 容器（OverlayFS 挂载）

每个 Agent 容器启动时，在容器内部做 OverlayFS mount：

```bash
docker run -d --rm \
  --cap-add=SYS_ADMIN \
  -v cb-lower:/lower:ro \
  overlay-sandbox \
  /entrypoint.sh
```

**entrypoint.sh：**
```bash
#!/bin/sh
# 1. 创建 tmpfs（upper/work 必须在真实文件系统上，不能在 overlay 上）
mount -t tmpfs tmpfs /tmp/overlay
mkdir -p /tmp/overlay/upper /tmp/overlay/work

# 2. 挂载 OverlayFS
mount -t overlay overlay \
  -o lowerdir=/lower,upperdir=/tmp/overlay/upper,workdir=/tmp/overlay/work \
  /workspace

# 3. 保持容器运行，等待 Agent 命令
tail -f /dev/null
```

**Agent 看到的视图：**
```
/workspace/           ← OverlayFS merged 目录
├── node_1.json       ← 来自 Lower（只读，Agent 改了会 copy-up 到 Upper）
├── node_2.md         ← 来自 Lower
└── report.pdf        ← 来自 Lower

Agent 执行: echo '{"count": 99}' > /workspace/node_1.json

/tmp/overlay/upper/   ← 只有改动的文件出现在这里
└── node_1.json       ← Agent 的修改
```

### 4.4 增量写回（Upper diff → S3+PG）

Agent 执行完成后，只需扫描 Upper 目录：

```python
# 在容器内执行
changed_files = exec("find /tmp/overlay/upper -type f")
# 结果：只有 Agent 真正改动的文件

# 对每个改动文件
for file in changed_files:
    content = exec(f"cat /tmp/overlay/upper/{file}")
    # 写回 S3+PG（通过 VersionService）
```

**对比现有流程：**
```
现在：读回所有文件（不管改没改） → 全部和数据库比对 → 写回
新：只读 Upper 中的文件（只有改动的） → 直接写回
```

## 五、新增文件和模块

### 5.1 后端新模块

```
backend/src/sandbox/
├── docker_sandbox.py      ← 现有，保留不动
├── e2b_sandbox.py         ← 现有，保留不动
├── overlay_sandbox.py     ← 新建：OverlayFS 沙盒实现
├── sync_worker.py         ← 新建：Lower 同步逻辑
├── service.py             ← 修改：加路由逻辑
└── base.py                ← 现有，保留不动
```

### 5.2 Docker 构建文件

```
sandbox/
├── Dockerfile             ← 现有
├── Dockerfile.overlay     ← 新建：OverlayFS Agent 容器镜像
└── entrypoint-overlay.sh  ← 新建：容器入口脚本（做 overlay mount）
```

## 六、OverlaySandbox 类设计

### 6.1 类签名

```python
class OverlaySandbox(SandboxBase):
    """基于 OverlayFS 的沙盒实现"""
    
    VOLUME_NAME = "cb-lower"
    IMAGE_NAME = "overlay-sandbox"
```

### 6.2 核心方法

#### `start(session_id, project_id, node_ids, readonly)`

```
流程：
  1. 确保 cb-lower Volume 存在
  2. 触发 Sync Worker 同步该项目的文件到 Volume
  3. 创建 Agent 容器：
     docker run -d --rm \
       --cap-add=SYS_ADMIN \
       -v cb-lower:/lower:ro \
       --name sandbox-{session_id} \
       overlay-sandbox
  4. 等待容器就绪（overlay mount 完成）
  5. 注册 session
```

#### `exec(session_id, command)`

```
和现有 DockerSandbox.exec() 完全一样：
  docker exec <container_id> sh -c "<command>"
```

#### `read_upper_diff(session_id)`

```
新方法 — 只读取 Agent 改动的文件：
  1. 在容器内执行: find /tmp/overlay/upper -type f
  2. 对每个文件读取内容
  3. 返回 {path: content} 字典
```

#### `stop(session_id)`

```
流程：
  1. 读取 Upper diff（如果需要写回）
  2. docker stop <container_id>
  3. 容器被 --rm 自动删除，tmpfs 上的 Upper 自动清除
  （不需要手动清理 temp 文件！）
```

### 6.3 与现有 DockerSandbox 的关系

```python
# SandboxService 路由逻辑
class SandboxService:
    def __init__(self):
        self.docker_sandbox = DockerSandbox()       # 现有
        self.overlay_sandbox = OverlaySandbox()      # 新增
    
    async def start(self, session_id, files, **kwargs):
        use_overlay = kwargs.get("use_overlay", False)
        
        if use_overlay:
            return await self.overlay_sandbox.start(session_id, ...)
        else:
            return await self.docker_sandbox.start_with_files(session_id, files, ...)
```

## 七、Sync Worker 设计

### 7.1 同步流程

```python
class SyncWorker:
    """同步 S3+PG 数据到 Docker Volume"""
    
    async def sync_project(self, project_id: str):
        """同步一个项目的所有内容到 cb-lower Volume"""
        
        # 1. 查询所有 content_nodes
        nodes = node_repo.list_by_project(project_id)
        
        # 2. 读取 Volume 中的 .metadata.json
        metadata = read_volume_metadata(project_id)
        
        # 3. 增量对比
        for node in nodes:
            vol_meta = metadata.get(node.id)
            if vol_meta and vol_meta["updated_at"] >= node.updated_at:
                continue  # 未变化，跳过
            
            # 4. 同步变化的文件
            if node.preview_json:
                write_to_volume(f"{project_id}/{node.id}.json", 
                               json.dumps(node.preview_json))
            elif node.preview_md:
                write_to_volume(f"{project_id}/{node.id}.md", 
                               node.preview_md)
            elif node.s3_key:
                content = await s3.download(node.s3_key)
                write_to_volume(f"{project_id}/{node.id}", content)
        
        # 5. 更新 .metadata.json
        write_volume_metadata(project_id, nodes)
```

### 7.2 Volume 操作方式

Sync Worker 作为一个临时容器运行，挂载 `cb-lower` Volume 进行写入：

```bash
docker run --rm \
  -v cb-lower:/data \
  -e SUPABASE_URL=... \
  -e SUPABASE_KEY=... \
  sync-worker python -m src.sandbox.sync_worker --project-id=xxx
```

或者在后端进程中直接操作（通过 `docker exec` 或 `docker cp`）。

## 八、Agent 写回流程改造

### 8.1 现有流程（全量）

```
Agent 执行完成
  → read_file() 读回每个文件的完整内容
  → 和数据库对比
  → update_node() 写回
```

### 8.2 新流程（增量）

```
Agent 执行完成
  → read_upper_diff() 只读取 Upper 中的改动文件
  → 对每个改动文件：
      如果是修改已有文件 → update_node() 写回（含版本记录）
      如果是新建文件 → create_node()
      如果是 whiteout 文件(.wh.*) → delete_node()
  → create_folder_snapshot() 记录这次操作
```

### 8.3 Whiteout 文件

OverlayFS 用 whiteout 文件表示"删除"：
```
Lower:  /workspace/old-file.json      ← 原始文件
Upper:  /workspace/.wh.old-file.json  ← whiteout，表示 Agent 删除了这个文件
```

写回时检测 `.wh.` 前缀，转换为 delete 操作。

## 九、容器镜像

### 9.1 Dockerfile.overlay

```dockerfile
FROM alpine:3.19

# 安装工具
RUN apk add --no-cache jq bash coreutils findutils

# 复制入口脚本
COPY entrypoint-overlay.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# 创建必要的目录
RUN mkdir -p /lower /workspace /tmp/overlay

ENTRYPOINT ["/entrypoint.sh"]
```

### 9.2 entrypoint-overlay.sh

```bash
#!/bin/sh
set -e

# 创建 tmpfs（必须，避免 nested overlay 问题）
mount -t tmpfs tmpfs /tmp/overlay
mkdir -p /tmp/overlay/upper /tmp/overlay/work

# 挂载 OverlayFS
mount -t overlay overlay \
  -o lowerdir=/lower,upperdir=/tmp/overlay/upper,workdir=/tmp/overlay/work \
  /workspace

echo "OverlayFS mounted successfully"

# 保持容器运行
exec tail -f /dev/null
```

## 十、实施步骤

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | 创建 Dockerfile.overlay + entrypoint 脚本，构建镜像 | 无 |
| 2 | 实现 OverlaySandbox 类（start/exec/read_upper_diff/stop） | 步骤 1 |
| 3 | 实现 SyncWorker（S3+PG → Docker Volume 同步） | 无 |
| 4 | 修改 SandboxService 加路由逻辑 | 步骤 2 |
| 5 | 修改 agent/service.py 的写回逻辑（增量写回） | 步骤 2, 4 |
| 6 | 端到端测试 | 全部 |

## 十一、风险和降级

| 风险 | 应对 |
|------|------|
| Docker Desktop 不支持 --cap-add=SYS_ADMIN | 降级到现有的全量复制模式 |
| OverlayFS mount 失败 | 容器 entrypoint 检测失败后 fallback 到普通 bind mount |
| Sync Worker 来不及同步 | Agent 启动前强制触发一次同步，等待完成 |
| macOS Docker Volume 性能 | Volume 在 LinuxKit VM 内部，不受 VirtioFS 影响 |

## 十二、配置

```python
# config.py 新增
SANDBOX_USE_OVERLAY: bool = False    # 是否启用 OverlayFS 模式
OVERLAY_VOLUME_NAME: str = "cb-lower"
OVERLAY_IMAGE_NAME: str = "overlay-sandbox"
SYNC_INTERVAL_SECONDS: int = 30
```

**开关逻辑：** `SANDBOX_USE_OVERLAY=true` 时走 OverlayFS 路径，`false` 时走现有全量复制。默认关闭，手动开启测试。

---

*本方案保留现有架构不动，在旁边加一条新的 OverlayFS 路径。通过配置开关切换，风险可控。*
