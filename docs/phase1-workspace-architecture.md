# 阶段 1：Workspace Provider 架构（最终版）

> 支持多平台，核心逻辑与平台无关。
> 支持两种 Agent 接入方式：用户自己的 Agent 和我们的 Agent。

---

## 一、核心设计

```
                    ┌─────────────────────┐
                    │    Merge Daemon      │  ← 平台无关
                    │  冲突检测 + 三方合并  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  WorkspaceProvider   │  ← 抽象接口
                    │  (create / diff /    │
                    │   cleanup)           │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼───────┐ ┌─────▼──────┐ ┌──────▼───────┐
     │ APFS Provider  │ │ OverlayFS  │ │ Fallback     │
     │ (macOS)        │ │ Provider   │ │ Provider     │
     │                │ │ (Linux)    │ │ (全量复制)    │
     │ cp -cR clone   │ │ mount -t   │ │ cp -r        │
     │ hash diff      │ │ overlay    │ │ diff -rq     │
     └────────────────┘ │ scan upper │ └──────────────┘
                        └────────────┘
```

**Merge Daemon 和 WorkspaceProvider 完全解耦。** 
Merge Daemon 只关心"Agent 改了什么"，不关心"工作区怎么创建的"。

---

## 二、WorkspaceProvider 抽象接口

```python
class WorkspaceProvider(ABC):

    async def create_workspace(
        self, agent_id: str, project_id: str, base_snapshot_id: int
    ) -> WorkspaceInfo:
        """
        为 Agent 创建隔离的工作区
        
        Args:
            agent_id: Agent 标识
            project_id: 项目 ID
            base_snapshot_id: 基于哪个 folder_snapshot 创建（三方合并的 Base）
        
        Returns:
            WorkspaceInfo(path="/tmp/cb-agent-a", base_snapshot_id=5)
        """

    async def detect_changes(self, agent_id: str) -> WorkspaceChanges:
        """
        检测 Agent 改了什么
        
        Returns:
            WorkspaceChanges(
                modified={"node_1.json": "{...}"},   # 修改/新建的文件
                deleted=["old_file.json"],             # 删除的文件
                base_snapshot_id=5,                    # 基准版本
            )
        """

    async def cleanup(self, agent_id: str) -> None:
        """清理 Agent 的工作区"""

    async def sync_lower(self, project_id: str) -> SyncResult:
        """
        同步 S3+PG 数据到本地 Lower 目录
        
        Returns:
            SyncResult(synced=3, skipped=97, total=100)
        """
```

---

## 三、macOS 实现（APFS Clone）

### 3.1 目录结构

```
/tmp/contextbase/
├── lower/                          ← 共享基准数据（从 S3+PG 同步）
│   └── {project_id}/
│       ├── {node_id_1}.json
│       ├── {node_id_2}.md
│       ├── {node_id_3}.pdf
│       └── .metadata.json          ← 同步元数据（版本号、时间戳）
│
├── workspaces/                     ← 每个 Agent 独立的工作区
│   ├── {agent_id_a}/               ← APFS Clone of lower/{project_id}/
│   │   ├── {node_id_1}.json        ← CoW：未改动时和 lower 共享磁盘块
│   │   ├── {node_id_2}.md
│   │   └── {node_id_3}.pdf
│   │
│   └── {agent_id_b}/               ← 另一个 Agent 的独立工作区
│       └── ...
│
└── .workspace_registry.json        ← 记录每个工作区的 base_snapshot_id
```

### 3.2 每一步发生了什么

#### Step 1: sync_lower（数据同步）

```
触发时机：Agent 启动前，或定时任务

Supabase PG:
  SELECT id, preview_json, preview_md, s3_key, updated_at
  FROM content_nodes
  WHERE project_id = 'xxx'

对比 .metadata.json 中每个节点的 updated_at：
  没变 → 跳过
  变了 → 重新写入文件

Supabase S3:
  大文件（s3_key 不为空）→ 下载到 lower/

结果：/tmp/contextbase/lower/{project_id}/ 是最新状态
```

#### Step 2: create_workspace（创建工作区）

```
macOS APFS Clone:
  cp -cR /tmp/contextbase/lower/{project_id}/ /tmp/contextbase/workspaces/{agent_id}/

发生了什么：
  - 新建 workspaces/{agent_id}/ 目录
  - 每个文件创建 APFS clone（clonefile 系统调用）
  - 每个文件共享底层数据块（零额外存储）
  - 总耗时：100 个文件 ~毫秒，1000 个文件 ~1-2 秒

记录 base_snapshot_id：
  写入 .workspace_registry.json:
  {"agent_id": {"base_snapshot_id": 5, "project_id": "xxx", "created_at": "..."}}
```

#### Step 3: Docker 挂载

```
docker run \
  --read-only \
  --cap-drop ALL \
  -v /tmp/contextbase/workspaces/{agent_id}:/workspace \
  agent-sandbox-image

Agent 容器看到的：
  /workspace/
  ├── {node_id_1}.json    ← APFS clone，读取时和 lower 一样
  ├── {node_id_2}.md
  └── {node_id_3}.pdf

Agent 改文件时：
  echo '{"count": 99}' > /workspace/{node_id_1}.json
  
  macOS APFS 自动处理：
  - 原来的数据块不动（lower 不受影响）
  - 新数据写到新的数据块（CoW）
  - 只有这一个文件占额外空间
```

#### Step 4: detect_changes（检测改动）

```
遍历 workspace 中的每个文件，和 lower 中的对应文件做 hash 对比：

for file in workspaces/{agent_id}/*:
    lower_hash = hash(lower/{project_id}/{file})
    workspace_hash = hash(workspaces/{agent_id}/{file})
    
    if lower_hash != workspace_hash:
        modified[file] = read(workspaces/{agent_id}/{file})

检查 lower 中有但 workspace 中没有的文件 → deleted

返回：
  WorkspaceChanges(
      modified={"node_id_1.json": '{"count": 99}'},
      deleted=[],
      base_snapshot_id=5,
  )
```

#### Step 5: Merge Daemon（冲突检测 + 三方合并）

```
收集所有 Agent 的 changes：
  Agent A: modified={"node_1.json": '{"count": 2}'},   base=snapshot#5
  Agent B: modified={"node_1.json": '{"count": 99}'},  base=snapshot#5

对每个被修改的文件：
  1. 检查：有几个 Agent 改了这个文件？
  
  只有 1 个 Agent 改了 → 直接采用，无冲突
  
  多个 Agent 改了同一个文件 → 三方合并：
    Base    = file_versions 中 snapshot#5 时 node_1.json 的内容 = {"count": 1}
    Ours    = Agent A 的版本 = {"count": 2}
    Theirs  = Agent B 的版本 = {"count": 99}
    
    JSON diff3：
      字段 "count": Base=1, A=2, B=99 → 冲突！
      
    按策略解决：
      LWW（Last Writer Wins）→ 采用后完成的 Agent 的版本
      Agent 优先级 → 高优先级 Agent 胜出
      人工审核 → 放入审核队列
```

#### Step 6: 写回（含版本记录）

```
合并结果写回 Supabase：
  1. node_service.update_node(node_id, preview_json=merged_content,
                              operator_type="system", operation="merge")
  2. file_versions 表自动创建新版本（阶段 0 已实现）
  3. 创建 folder_snapshot 记录这次合并操作

更新 Lower：
  sync_lower() 拉取最新数据到 /tmp/contextbase/lower/
```

#### Step 7: 清理

```
rm -rf /tmp/contextbase/workspaces/{agent_id}/
从 .workspace_registry.json 中删除记录
```

---

## 四、Linux 实现（OverlayFS，未来）

### 4.1 目录结构

```
/mnt/contextbase/
├── lower/{project_id}/             ← 共享基准（同 macOS）
├── upper/{agent_id}/               ← OverlayFS Upper（自动记录改动）
├── work/{agent_id}/                ← OverlayFS 内部工作目录
└── merged/{agent_id}/              ← OverlayFS Merged（挂进容器）
```

### 4.2 操作对比

| 步骤 | macOS (APFS) | Linux (OverlayFS) |
|------|-------------|-------------------|
| 创建工作区 | `cp -cR lower/ workspace/` | `mount -t overlay ... merged/` |
| Agent 写入 | APFS CoW → workspace 独立数据块 | OverlayFS CoW → upper 目录 |
| 检测改动 | hash 对比 lower vs workspace | `find upper/ -type f`（直接扫描） |
| 检测删除 | 对比文件列表 | 检查 `.wh.*` whiteout 文件 |
| 清理 | `rm -rf workspace/` | `umount merged/ && rm -rf upper/ work/` |
| Docker 挂载 | `-v workspace:/workspace` | `-v merged:/workspace` |

### 4.3 Merge Daemon 代码完全一样

```python
# Merge Daemon 不关心平台
async def process_agent_completion(self, agent_id: str):
    # 调用抽象接口
    changes = await self.workspace_provider.detect_changes(agent_id)
    
    # 以下代码 macOS 和 Linux 100% 相同
    base = self.get_snapshot(changes.base_snapshot_id)
    
    for file_path, new_content in changes.modified.items():
        node_id = self.path_to_node_id(file_path)
        base_content = self.get_base_content(node_id, base)
        current_content = self.get_current_content(node_id)
        
        if base_content == current_content:
            # 没有其他人改过 → 直接采用
            self.write_back(node_id, new_content)
        else:
            # 有其他人也改了 → 三方合并
            merged = self.three_way_merge(base_content, current_content, new_content)
            self.write_back(node_id, merged)
```

---

## 五、Fallback 实现（任何平台）

如果 APFS clone 失败或不在 macOS 上：

```python
class FallbackWorkspaceProvider(WorkspaceProvider):
    async def create_workspace(self, agent_id, project_id, base_snapshot_id):
        # 普通全量复制
        shutil.copytree(lower_path, workspace_path)
        return WorkspaceInfo(path=workspace_path, base_snapshot_id=base_snapshot_id)
```

功能完全一样，只是创建工作区稍慢。Merge Daemon 代码不变。

---

## 六、路由逻辑

```python
import platform

def get_workspace_provider() -> WorkspaceProvider:
    system = platform.system()
    
    if system == "Darwin":  # macOS
        return APFSWorkspaceProvider()
    elif system == "Linux":
        if _can_use_overlayfs():
            return OverlayFSWorkspaceProvider()
        else:
            return FallbackWorkspaceProvider()
    else:
        return FallbackWorkspaceProvider()
```

---

## 七、文件清单

### 新建

| 文件 | 用途 |
|------|------|
| `backend/src/workspace/provider.py` | 抽象接口 WorkspaceProvider |
| `backend/src/workspace/apfs_provider.py` | macOS APFS Clone 实现 |
| `backend/src/workspace/overlayfs_provider.py` | Linux OverlayFS 实现（预留） |
| `backend/src/workspace/fallback_provider.py` | 全量复制兜底 |
| `backend/src/workspace/sync_worker.py` | S3+PG → Lower 同步（从 sandbox/ 移过来） |
| `backend/src/workspace/merge_daemon.py` | 冲突检测 + 三方合并 |

### 修改

| 文件 | 改动 |
|------|------|
| `backend/src/sandbox/service.py` | 集成 WorkspaceProvider |
| `backend/src/agent/service.py` | 使用 WorkspaceProvider 创建/检测/清理 |
| `backend/src/config.py` | 新增 WORKSPACE_PROVIDER 配置 |

---

## 八、实施顺序

| 步骤 | 内容 | 先做 |
|------|------|------|
| 1 | WorkspaceProvider 抽象接口 | ✅ |
| 2 | APFSWorkspaceProvider（macOS） | ✅ |
| 3 | FallbackWorkspaceProvider（兜底） | ✅ |
| 4 | SyncWorker（S3+PG → Lower） | ✅ |
| 5 | MergeDaemon（冲突检测 + 三方合并） | ✅ |
| 6 | 集成到 agent/service.py | ✅ |
| 7 | OverlayFSWorkspaceProvider（Linux） | 后做 |

---

---

## 九、两种 Agent 接入方式

### 方式 1：我们的 Agent（前端配置，用户无感知）

```
用户在前端配置 Agent → 点击执行
    │
    ▼
后端 agent/service.py：
    ① WorkspaceProvider.sync_lower()    同步数据
    ② WorkspaceProvider.create_workspace()  创建工作区
    ③ SandboxService.start_with_files()    启动 Docker 容器 + bind mount
    ④ Agent 执行 bash 命令
    ⑤ WorkspaceProvider.detect_changes()   检测改动
    ⑥ MergeDaemon.process_agent_changes()  冲突检测 + 三方合并
    ⑦ 写回 Supabase（含版本记录）
    ⑧ WorkspaceProvider.cleanup()          清理
```

用户不需要配置任何路径，全部由后端自动处理。

### 方式 2：用户自己的 Agent（Cursor / Claude Desktop / OpenClaw 等）

```
用户自己启动 Docker 容器：
    docker run -v /tmp/contextbase/workspaces/{agent_id}:/workspace my-agent

    用户只需要知道一个路径：
    /tmp/contextbase/workspaces/{agent_id}
    
    这个路径由我们的 API 返回（或用户在前端看到）。
```

**用户的 Agent 完成后，通知我们的后端：**

```
POST /api/v1/workspace/{agent_id}/complete

后端执行：
    ① WorkspaceProvider.detect_changes()   检测改动
    ② MergeDaemon.process_agent_changes()  冲突检测 + 三方合并
    ③ 写回 Supabase
    ④ WorkspaceProvider.cleanup()
```

### 两种方式的区别

| | 我们的 Agent | 用户自己的 Agent |
|--|---|---|
| 谁启动容器 | 我们的后端 | 用户自己 |
| 谁挂载目录 | 后端自动 | 用户指定路径 |
| 冲突检测 | 自动 | Agent 完成后调 API |
| 版本管理 | 自动 | 自动（调 API 后触发） |
| 前端配置 | 配置 Agent 即可 | 拿到 workspace 路径即可 |

**底层完全一样：同一个 Lower 目录、同一个 WorkspaceProvider、同一个 MergeDaemon。**

---

## 十、下一步：接入 Agent 流程

### 待实现

| 步骤 | 内容 |
|------|------|
| 1 | 修改 agent/service.py，沙盒启动前调用 sync_lower + create_workspace |
| 2 | 修改 agent/service.py，写回时调用 detect_changes + MergeDaemon |
| 3 | 新增 API：POST /workspace/{agent_id}/complete（给外部 Agent 用） |
| 4 | 新增 API：GET /workspace/{project_id}/path（返回工作区路径） |
| 5 | 端到端测试 |

---

*本方案将"工作区创建"（平台相关）和"冲突解决"（平台无关）完全解耦。
支持我们的 Agent 和用户自己的 Agent 两种接入方式。
先在 macOS 上用 APFS Clone 跑通整个流程，生产环境切换到 OverlayFS 只需替换一个 Provider。*
