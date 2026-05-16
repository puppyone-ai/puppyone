# PuppyOne 产品愿景与架构原理

> **Historical — current model is in
> [07-version-engine-supplement.md](07-version-engine-supplement.md).**
> The MUT wire protocol described below has been removed; PuppyOne is
> now a Git server that takes over MUT server's role. Read this doc
> for the original problem framing, but consult the supplement for
> any current architecture decision.

> MUT = Git for AI Agents. PuppyOne = GitHub for MUT.

---

## 1. 问题定义

我们要构建一个给 AI Agent 使用的共享上下文库（Context Base），核心挑战是：

| 编号 | 问题 | 说明 |
|------|------|------|
| P1 | Agent 的交互界面是文件系统 | Agent 需要用 bash 命令操作文件（cat, ls, echo, 脚本等），不能要求 Agent 用 SQL 或 API |
| P2 | 并发访问 | 可能 1000 个 agent 同时读，100 个 agent 同时写 |
| P3 | 版本管理 | Agent 改错了要能回滚，每次改动要可追溯 |
| P4 | 冲突解决 | 两个 agent 同时改同一文件时，需要检测和处理冲突 |
| P5 | 权限隔离 | 不同 agent 看到不同的文件子集，有的只读有的可写 |
| P6 | 资源效率 | 1000 个 agent 不能需要 1000 倍的存储和内存 |
| P7 | 可上云 | 方案需要支持多用户云端部署，不能只限于单机 |

Agent 生态高度碎片化——不同用户、不同框架、不同部署方式下，对"数据怎么给 Agent 用"的需求完全不同：

| 用户场景 | Agent 在哪里跑 | 怎么访问数据 | 有没有本地文件系统 | 需要我们管沙盒吗 |
|---------|--------------|------------|------------------|----------------|
| 用我们的 CloudBot | 我们的 Docker | 本地文件夹 | 有（容器内） | 需要 |
| OpenClaw on Mac mini | 用户的 Docker | 本地文件夹 | 有（宿主机） | 不需要 |
| Claude Code on Mac | 无沙盒（用户进程） | 本地文件夹 | 有（项目目录） | 不需要 |
| Cursor on Mac | 无沙盒（用户进程） | 本地文件夹 | 有（项目目录） | 不需要 |
| n8n on VM | n8n 进程 | REST API | 不需要 | 不需要 |
| Manus（云端） | Manus 自己的沙盒 | REST API | 不需要 | 不需要 |
| AWS Lambda | Lambda 临时环境 | REST API / SDK | 无持久文件系统 | 不需要 |
| 自定义 Python Agent | 用户进程 | 文件夹 或 SDK | 可选 | 不需要 |
| Railway + OpenClaw | Railway 容器 | 容器内文件夹（临时） | 有（但会被销毁） | 不需要 |
| EC2 + 100 个 Agent | VM 上的 Docker | 本地文件夹 | 有 | 不需要 |

**核心洞察**：这些问题（P1-P7）本质上就是版本控制系统要解决的问题——Git 已经解决了并发、版本、冲突、隔离。我们选择构建 **MUT（Managed Unified Tree）**，一个专为 AI Agent 设计的类 Git 版本控制协议，然后用 PuppyOne 作为它的托管平台。

**不变量**（无论哪种场景永远成立）：

1. **MUT tree 是唯一的内容真相源**：Merkle tree 存储在 S3，PG 只是控制平面
2. **所有写入都经过 MUT 协议**：clone → modify → push，无例外无后门
3. **接口层可替换**：给 Agent 提供数据的方式（文件夹 / API / MCP）是可插拔的

---

## 2. 核心技术决策

P1-P7 不是 7 个独立问题——它们交织在一起。我们把技术方案拆成 7 个维度，每个维度解决一组 P：

```
维度 1: 后端存储 (2.1)      → P3 版本管理 · P6 资源效率 · P7 可上云
维度 2: Agent 接口层 (2.2)  → P1 文件系统界面 · P2 并发访问（写隔离）
维度 3: 写隔离实现 (2.3)    → P2 并发访问 · P6 资源效率
维度 4: 版本与同步 (2.4)    → P3 版本管理
维度 5: 并发策略 (2.5)      → P2 并发访问
维度 6: 冲突解决 (2.6)      → P4 冲突解决
维度 7: 隔离/沙盒 (2.7)     → P1 文件系统界面 · P5 权限隔离
```

反过来看——每个 P 由哪些维度解决：

| 问题 | 由哪些维度解决 | 核心答案 |
|------|--------------|---------|
| **P1** 文件系统界面 | 2.2 接口层 + 2.7 沙盒 | MUT clone 展开为普通文件夹；或走 Tree API / MCP 跳过文件系统 |
| **P2** 并发访问 | 2.2 接口层 + 2.3 写隔离 + 2.5 并发策略 | 各 Agent 各自 clone 独立工作区（APFS/OverlayFS/cp -r），push 时乐观并发检测 |
| **P3** 版本管理 | 2.1 存储 + 2.4 版本与同步 | Merkle tree (S3) + mut_commits (PG)，per-commit 整树 snapshot |
| **P4** 冲突解决 | 2.6 冲突解决 | MUT handle_push 内置 3-way merge，按文件类型选算法 |
| **P5** 权限隔离 | §4 权限模型 + 2.7 沙盒 | MUT scope (path-based)，clone 时前置过滤，push 时拒绝越权 |
| **P6** 资源效率 | 2.1 存储 + 2.3 写隔离 | Content-addressable S3 天然去重 + OverlayFS/APFS CoW 写时复制 |
| **P7** 可上云 | 2.1 存储 | PuppyOneServerRepo 解构到 S3 + PG，API 完全无状态 |

### 2.1 后端存储：MUT tree (S3) + 控制平面 (PG) — P3 P6 P7

| 方案 | 描述 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| A. 纯文件系统 | 本地磁盘/NFS | 简单，Agent 天然兼容 | 无版本管理，无并发控制，无审计 | ❌ 淘汰 |
| B. 纯数据库 (PG) | 所有数据存 PG | 有事务、版本、并发 | 大文件存 PG 成本过高，不适合做文件系统 | ❌ 淘汰 |
| C. 纯对象存储 (S3) | 所有数据存 S3 | 大文件便宜，可跨机器 | 无事务，元数据查询慢 | ❌ 单独用不够 |
| **D. Merkle tree (S3) + 控制平面 (PG)** | **S3 存 content-addressable 对象（Merkle tree），PG 存项目/连接/版本指针** | **Git 级别的版本管理 + 云端无状态部署** | **需要 MUT 协议层** | **✅ 选定** |

```
S3 存什么（数据平面 — MUT tree）：
└── mut/{project_id}/objects/     ← content-addressable blobs
    ├── ab/cdef1234...            ← 文件内容（按 hash 存储，不可变）
    ├── 12/3456abcd...            ← tree 对象（目录结构）
    └── ...                       ← 相同内容只存一份

PG 存什么（控制平面 — 不持有文件内容）：
├── projects.mut_root_hash        ← 当前 Merkle tree 根 hash
├── mut_scope_state               ← 每个 scope 的 (scope_hash, head_commit_id)
├── mut_commits                   ← commit 历史（commit_id 16-hex, who, when, changes, root_hash）
├── audit_logs                    ← 审计日志（commit_id 放在 metadata JSONB）
├── connections                   ← Agent/connector 注册 + scope 权限 + access_key
├── organizations / profiles      ← 用户/组织管理
└── ...                           ← 其他控制平面表
```

**与旧设计的关键区别**：PG 中没有 `file_metadata`、`file_versions`、`content_nodes` 这类逐文件记录。版本管理在 commit 级别（整棵树的 snapshot），不是文件级别。这和 Git 的模型完全一致。

### 2.2 Agent 接口层："先写后合并"（✅ 选定） — P1 P2

Agent 需要文件系统界面，但后端是 S3 中的 Merkle tree。中间需要一个翻译层。

#### 核心模式

```
Agent 需要看到普通文件系统 → 需要把 Merkle tree 展开为本地文件
多个 Agent 可能同时写同一个文件 → 需要写隔离，各写各的
改完之后要合并回去 → 需要变更检测和冲突解决
```

这就是 MUT 的 clone → modify → push 模式（和 Git 完全一致）：

```
┌────────────────────────────────────────────────────────┐
│ 1. Clone（获取工作副本）                                 │
│    MUT tree → 展开为本地文件夹，形成独立工作区             │
│                                                        │
│ 2. Modify（隔离编辑）                                    │
│    Agent 在自己的工作区里自由读写，不影响其他 Agent        │
│                                                        │
│ 3. Push（提交变更）                                      │
│    对比本地工作区和 base version 的差异                    │
│    差异 → MUT handler 做 3-way merge + 版本记录          │
└────────────────────────────────────────────────────────┘
```

**"先写后合并"是所有冲突解决的前提。没有写隔离，冲突在发生的瞬间数据就丢失了，无法回溯。**

#### 被排除的方案及理由

**方案 2A/2B：共享目录 / Docker Volume（❌ 无写隔离）**

```
多个 Agent 共享同一个目录 → 一个 Agent 的写入立刻覆盖另一个 → 数据丢失，无法检测冲突
```

**方案 2D：工具拦截层（❌ 无法穷举）**

```
Agent 的 read/write/exec ──> 拦截层 ──> 转写为 S3+PG 操作
```

排除理由：无法穷举所有 bash 行为。Agent 可以执行任意脚本（`python script.py` 内部的文件操作无法拦截）、使用管道（`cat a.txt | grep x > b.txt`）、调用 git 等复杂工具。维护成本不可控。

**方案 2E：FUSE 虚拟文件系统（❌ 语义鸿沟）**

```
Agent Docker ──> FUSE 挂载点 ──> 直接读写 S3
```

排除理由——语义鸿沟无法弥合。FUSE 工作在系统调用层面（open/read/write/close），但应用程序对文件的操作意图存在于应用层，FUSE 看不到：

| 用户意图 | FUSE 实际看到的 | 语义差距 |
|---------|---------------|---------|
| 改 JSON 一个字段 | 整个文件 truncate + rewrite | 不知道只改了一个字段，误判为全文件替换 |
| vim `:w` 保存 | 写 .swp → rename → rename → delete（4 步） | 不知道这是一次保存，可能把中间状态同步 |
| `sed -i 's/old/new/'` | 创建临时文件 → 写入 → rename | 临时文件不该被同步 |
| git commit | 多个 .git/ 下文件的写入 + rename | 中间状态同步会导致 git 仓库损坏 |

每种应用的文件操作模式都不同，FUSE 必须为每种做特殊处理，而这些模式是无穷的。

#### 方案对比矩阵

| 场景 | 共享目录 (2A/2B) | **clone → push (2C)** | 工具拦截 (2D) | FUSE (2E) |
|------|-----------------|------------------------|-------------|---------|
| 写隔离能力 | ❌ 无 | **✅ 有** | ✅ 有 | ✅ 有 |
| bash 全兼容 | ✅ | **✅** | ❌ | ✅ |
| 实现复杂度 | 低 | 中 | 极高 | 中 |
| 1000 Agent 只读 | 1份共享 | **content-addressable 共享** | N/A | 1000个FUSE进程 |
| 100 Agent 写同一文件 | 覆盖丢失 | **各写各的副本** | 可拦截 | 可拦截 |
| **结论** | **❌ 淘汰** | **✅ 选定** | **❌ 淘汰** | **❌ 淘汰** |

### 2.3 写隔离实现：按平台选择 — P2 P6

"先写后合并"是模式，具体怎么创建"隔离的工作副本"因平台而异：

| 平台 | 技术 | 原理 | 适用场景 |
|------|------|------|---------|
| Linux (EC2/Railway) | **OverlayFS** | 内核原生 CoW：共享只读 Lower + 每 Agent 独立 Upper，写时复制 | 1000 Agent 大规模，存储最省 |
| macOS (Mac mini/本地开发) | **APFS Clone** (`cp -cR`) | APFS 原生 CoW，克隆速度与文件大小无关，零额外存储 | 1-10 Agent 本地开发 |
| 通用 Fallback | **全量复制** (`cp -r`) | 每个 Agent 完整复制一份 | 任何平台，单 Agent 或小数据量 |
| 无本地文件系统 (n8n/Lambda) | **不需要** | 走 REST API / MCP，不经过文件系统层 | 纯 API 模式 |

**核心原则：不管用哪种技术，MUT 的 clone → push 模式和冲突解决逻辑完全相同，与平台无关。**

**资源消耗对比**（工作区 500MB、1000 Agent）：

| 场景 | OverlayFS (CoW) | 全量复制 | 节省 |
|------|-----------------|---------|------|
| 1000 Agent 全部只读 | 1份 Lower ≈ **500MB** | 500MB × 1000 = **500GB** | 99.9% |
| 100 Agent 各改1个10KB文件 | 500MB + 1MB ≈ **501MB** | 500MB × 100 = **50GB** | 99% |
| 10 Agent 各改10个文件 | 500MB + 几MB ≈ **503MB** | 500MB × 10 = **5GB** | 90% |

此外，MUT Merkle tree 的 content-addressable 存储在云端也提供了天然去重——1000 个 Agent clone 同一棵树，S3 中的 blob 对象只有一份。只有被修改的文件才会产生新的 blob。

### 2.4 版本与同步：MUT 协议（类 Git） — P3

**版本管理粒度：整体 commit，不是 per-file**

```
旧思路（已废弃）：
  每个文件有独立的 version 号（file_versions 表）
  改一个文件 → 该文件 version++
  回滚 = 取某个文件的历史版本

MUT 方式（当前实现）：
  整棵树有一个 root_hash + version（mut_commits 表）
  改任何文件 → 产生新的 commit（新 root_hash）
  回滚 = 把整棵树恢复到某个 commit 的 root_hash

  这和 Git 完全一致。
```

**同步机制：客户端驱动的 MUT 协议**

```
MUT Server (PuppyOne)                    MUT Client (CLI daemon / Agent)
┌───────────────────────┐                ┌───────────────────────┐
│                       │                │                       │
│  Merkle tree (S3)     │   clone        │  本地工作区文件         │
│  mut_commits (PG)     │ ◄──────────── │  .mut/config.json     │
│  scope (connections)  │                │                       │
│                       │   push         │  Agent 在本地自由编辑   │
│  MUT Handlers:        │ ◄──────────── │  改完 commit + push   │
│  - 3-way merge        │                │                       │
│  - scope 权限检查      │   pull         │  拉取其他人的改动       │
│  - audit 日志          │ ─────────────► │                       │
│  - version 递增        │                │                       │
└───────────────────────┘                └───────────────────────┘

没有服务端 daemon。
没有服务端 FileWatcher。
Client 决定什么时候 push/pull — 和 Git 一模一样。
```

**内部写入（Web UI / Agent / Connector）通过 MutOps**

```
所有内部 channel → MutOps → MutEphemeralClient.clone() → modify → push()
                                                              │
                                              MUT Handlers: scope + merge + audit + version
```

MutOps 是所有 channel 操作 MUT tree 的**唯一入口**。不管是前端编辑、Agent 执行、Connector 同步，还是 Ingest 导入，最终都通过 MutOps 写入。

### 2.5 并发策略：乐观并发（✅ 选定） — P2

| 方案 | 描述 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| 悲观锁 | 写前加锁，同时只有一个 agent 能写某个文件 | 无冲突 | 并发写被阻塞，性能差 | ❌ |
| **乐观并发** | **各自 clone 独立工作区，push 时检测冲突** | **写入不阻塞，并发性能好** | **冲突在 push 时处理** | **✅ 选定** |

**CRDT、OT、Git 三方合并等不是和"乐观并发"并列的方案，而是在乐观并发检测到冲突后，具体用什么算法来解决冲突。它们完全可以组合使用。**

### 2.6 冲突解决：按文件类型组合算法 — P4

| 算法 | 原理 | 优点 | 缺点 | 适用文件类型 |
|------|------|------|------|-------------|
| **Last-Writer-Wins** | 时间戳最新的覆盖旧的 | 最简单，零复杂度 | 丢失先写入的改动 | 二进制文件、不重要的配置 |
| **Agent 优先级** | 高优先级 Agent 的版本胜出 | 简单，可控 | 低优先级 Agent 的改动被丢弃 | 有明确主从关系的场景 |
| **三方合并 (Git diff3)** | Base + Ours + Theirs 三方 diff，改不同部分自动合并，改同一部分标记冲突 | 成熟、文本文件效果好 | 二进制文件无法 diff；同区域冲突仍需兜底 | .md / .txt / .json / .yaml / 代码 |
| **OT** | 把改动转化为操作序列（insert/delete），通过变换函数保证操作可交换 | 实时协同体验好（Google Docs 用的） | 实现极复杂；需要中心服务器排序操作 | 实时文本协同编辑 |
| **CRDT** | 数据结构本身保证合并无冲突（如 G-Counter、LWW-Register、RGA） | 天然无冲突，可去中心化，支持离线 | 文件级 CRDT 复杂度高；需保留操作历史，存储开销大 | 共享计数器、列表、集合等结构化数据 |
| **人工/AI 审核** | 冲突标记后放入队列 | 最安全，关键文件不会被错误合并 | 慢，阻塞后续操作 | 关键配置、不可自动合并的文件 |

**决策——按文件类型组合**（MUT handler 在 push 时自动执行）：

```
MUT handle_push 检测到 client 的 base_commit_id ≠ 当前 head_commit_id
    │
    ├── .md / .txt / .json / .yaml / 代码文件
    │   → Git 三方合并 (diff3)
    │   改不同部分 → 自动合并
    │   改同一部分 → 标记冲突 → 返回 conflicts 数组
    │
    ├── 二进制文件（图片/视频/音频）
    │   → Last-Writer-Wins
    │   （二进制文件无法 diff，只能整体替换）
    │
    └── 关键配置文件
        → 人工/AI 审核队列（不允许自动合并）
```

**push 的完整内部流程**：

```
handle_push(files, base_commit_id, who, scope)
  │
  ├─ 1. Scope 权限检查：所有 file path 在 scope 范围内？
  │     │
  │     ├─ 有越权 → 拒绝 push，返回 403
  │     │
  │     └─ 通过 → 继续
  │
  ├─ 2. 读 scope 当前状态：old_scope_hash + old_head_commit_id
  │     │
  │     ├─ base_commit_id == old_head_commit_id → 快速路径，无需合并
  │     │
  │     └─ NO → 有人先改了，需要合并
  │              │
  │              ├─ 3. 取出 base tree (base_commit_id 对应的 root_hash)
  │              │      取出 current tree (old_scope_hash 导航出的子树)
  │              │      取出 client tree (push 带的文件)
  │              │
  │              └─ 4. 三方合并 (对每个有差异的文件)
  │                    │
  │                    ├─ 文本文件 → diff3 合并
  │                    │   改不同区域 → 自动合并
  │                    │   改同一区域 → 记录冲突
  │                    │
  │                    └─ 二进制 → LWW 兜底
  │
  ├─ 5. 生成 new_scope_hash + new_commit_id（hash 而非递增 int）
  │        commit_id = sha256(scope_path, new_scope_hash,
  │                           created_at_iso(μs), who)[:16]
  │
  ├─ 6. CAS 原子更新 mut_scope_state.(scope_hash, head_commit_id)
  │        失败 → 重试 handle_push
  │
  └─ 7. Post-commit：记录 mut_commits + audit_logs + 触发 graft
         return {
           status: "ok" | "merged" | "conflict",
           commit_id: "<16-hex>",
           merged: bool, conflicts: [...], merged_changes: [...],
         }
```

### 2.7 沙盒：Docker 容器（可选） — P1 P5

沙盒是可选能力。谁需要沙盒取决于 Agent 的交互方式和谁管执行环境：

| 场景 | 交互方式 | 谁管沙盒 | 我们需要提供沙盒吗 |
|------|---------|---------|------------------|
| CloudBot (内置 Agent) | 文件系统 (bash) | 我们管 | ✅ 需要 — Docker 容器沙盒 |
| Manus 沙盒模式 | 文件系统 (bash) | 我们管 | ✅ 需要 — 和 CloudBot 相同 |
| OpenClaw on Mac | 文件系统 (bash) | OpenClaw 管 | ❌ 只提供 MUT 协议 |
| Claude Code / Cursor | 文件系统 (bash) | 用户自己 | ❌ 只提供 MUT 协议 |
| n8n / Lambda | API (REST) | 无需沙盒 | ❌ 只提供 API |
| Manus API 模式 | API (REST) | 无需沙盒 | ❌ 只提供 API |

> 同一个外部 Agent（如 Manus）可能有两种接入方式。如果 Manus 返回 bash 命令让我们执行，它就需要我们的沙盒。如果 Manus 通过 REST API 读写数据，则不需要沙盒。

---

## 3. 系统架构

### 3.1 MUT 通道模型

所有对 MUT tree 的读写，不论来源，都经过同一条路径：

```
┌──────────────────────────────────────────────────────────────┐
│                      上层: Channels                           │
│                                                              │
│  各 Channel 只负责:                                           │
│    1. 认证 (JWT / Access Key / 内部调用)                       │
│    2. 触发条件 (人类点击 / cron / webhook / FSEvent)            │
│    3. 调用 MutOps                                             │
│                                                              │
│  ┌────────┐ ┌────────┐ ┌──────┐ ┌───────┐ ┌──────┐ ┌──────┐ │
│  │ Web UI │ │ Ingest │ │ MCP  │ │Agent/ │ │ Data │ │  FS  │ │
│  │(Human) │ │(Upload)│ │Endpt │ │Sandbox│ │Source│ │ Sync │ │
│  └───┬────┘ └───┬────┘ └──┬───┘ └──┬────┘ └──┬───┘ └──┬───┘ │
└──────┼──────────┼─────────┼────────┼─────────┼────────┼──────┘
       │          │         │        │         │        │
       ▼          ▼         ▼        ▼         ▼        ▼
┌──────────────────────────────────────────────────────────────┐
│                     中层: MutOps                              │
│                     (唯一的操作入口)                           │
│                                                              │
│  写: write_file / delete / mkdir / move / bulk_write         │
│  读: read_file / list_dir / list_tree / stat                 │
│                                                              │
│  内部: clone → modify → push (MutEphemeralClient)            │
│  HTTP: content_router (REST) + protocol_router (MUT wire)    │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
╔══════════════════════════════════════════════════════════════╗
║                    底层: MUT Server Handlers                  ║
║                                                              ║
║   handle_clone() · handle_push() · handle_pull() · negotiate ║
║                                                              ║
║   每次操作自动执行:                                            ║
║   ✓ Scope 权限检查        ✓ 冲突检测 (3-way merge)            ║
║   ✓ Merkle tree 一致性     ✓ 版本记录 (mut_commits)           ║
║   ✓ 审计日志 (audit_logs)  ✓ Post-commit hook                ║
╚══════════════════════════════════════════════════════════════╝
                           │
                           ▼
              ┌────────────┴────────────┐
              │   S3 (Merkle objects)    │
              │   PG (控制平面)          │
              └─────────────────────────┘
```

### 3.2 场景矩阵

> **区分标准是交互方式，不是操作者身份（人/Agent/SaaS）** — 同一操作者可以有多种接入方式。

```
交互方式                    ┌──────────┬──────────────┬────────────┬───────────┬──────────┐
                           │ MUT      │ Channel      │ Interface  │ 写隔离技术 │ Sandbox  │
                           │ Handlers │ (MutOps)     │            │           │          │
───────────────────────────┼──────────┼──────────────┼────────────┼───────────┼──────────┤
文件系统模式 — 我们管沙盒:                                                                │
  CloudBot (内置 Agent)     │ ✅       │ Agent/Sandbox│ MutOps内部 │ Fallback  │ ✅ Docker │
  Manus 沙盒模式            │ ✅       │ Agent/Sandbox│ MutOps内部 │ Fallback  │ ✅ Docker │
───────────────────────────┼──────────┼──────────────┼────────────┼───────────┼──────────┤
文件系统模式 — Client 端:                                                                 │
  OpenClaw on Mac           │ ✅       │ FS Sync      │ MUT协议HTTP│ APFS Clone│ ❌       │
  OpenClaw on EC2           │ ✅       │ FS Sync      │ MUT协议HTTP│ OverlayFS │ ❌       │
  Claude Code / Cursor      │ ✅       │ FS Sync      │ MUT协议HTTP│ APFS Clone│ ❌       │
  Railway + OpenClaw        │ ✅       │ FS Sync      │ MUT协议HTTP│ Fallback  │ ❌       │
───────────────────────────┼──────────┼──────────────┼────────────┼───────────┼──────────┤
API 模式:                                                                                 │
  Web UI (前端)             │ ✅       │ Web UI       │ Tree API   │ 不需要    │ ❌       │
  n8n / Zapier              │ ✅       │ —            │ Tree API   │ 不需要    │ ❌       │
  Manus API 模式            │ ✅       │ —            │ Tree API   │ 不需要    │ ❌       │
  Lambda / Serverless       │ ✅       │ —            │ Tree API   │ 不需要    │ ❌       │
  自定义Agent (SDK)          │ ✅       │ —            │ Tree API   │ 不需要    │ ❌       │
───────────────────────────┼──────────┼──────────────┼────────────┼───────────┼──────────┤
MCP 模式:                                                                                 │
  Claude Desktop / Cursor   │ ✅       │ MCP Endpoint │ Internal   │ 不需要    │ ❌       │
───────────────────────────┼──────────┼──────────────┼────────────┼───────────┼──────────┤
SaaS 数据同步:                                                                            │
  Notion 双向同步            │ ✅       │ Datasource   │ MutOps内部 │ 不需要    │ ❌       │
  Gmail 同步                │ ✅       │ Datasource   │ MutOps内部 │ 不需要    │ ❌       │
  GitHub 同步               │ ✅       │ Datasource   │ MutOps内部 │ 不需要    │ ❌       │
───────────────────────────┼──────────┼──────────────┼────────────┼───────────┼──────────┤
混合模式:                                                                                  │
  OpenClaw + Notion 同步     │ ✅       │ FS + Notion  │ MUT+MutOps │ APFS Clone│ ❌       │
  EC2 + 100 个 Agent        │ ✅       │ 多FS Sync    │ MUT协议HTTP│ OverlayFS │ ❌       │
```

**关键规律**：
- **MUT Handlers**：**所有场景都经过**（不可拆卸），这是版本/权限/审计的统一保障
- **写隔离**：**仅文件系统模式需要**（API / MCP 模式不需要，因为写入是原子的 HTTP 请求）
- **Sandbox**：**仅内置 CloudBot / Manus 沙盒模式需要**（可拆卸）
- **Interface 有三种**：MutOps 内部调用（服务端 channel）、Tree API HTTP（前端/外部 API）、MUT 协议 HTTP（CLI daemon）
- **凡是在文件系统上读写的，都需要 MUT clone**——不管是人手动改文件、Agent 执行 bash、还是 Manus 返回命令
- **凡是通过 REST API / MCP 读写的，不需要 clone**——直接调 MutOps（内部自动 clone → push），自己管请求粒度
- 多个 channel 可以同时运行（如 OpenClaw + Notion：Agent 在本地文件夹改了 → push → Notion connector 检测到变更 → 推到 Notion）
- 新增 channel 只需调用 `MutOps.write_file()`，不需要碰 MUT 内核

### 3.3 两种 HTTP 接口

MutOps 通过两个 router 对外暴露：

```
content_router — Content API（面向前端和内部服务）：
  POST /api/v1/content/{project_id}/write    → MutOps.write_file()
  POST /api/v1/content/{project_id}/mkdir    → MutOps.mkdir()
  POST /api/v1/content/{project_id}/mv       → MutOps.move()
  POST /api/v1/content/{project_id}/rm       → MutOps.delete()
  GET  /api/v1/content/{project_id}/ls       → MutOps.list_dir()
  GET  /api/v1/content/{project_id}/cat      → MutOps.read_file()

protocol_router — MUT 线协议（面向 CLI daemon / 远程 client）：
  POST /api/v1/mut/{project_id}/clone
  POST /api/v1/mut/{project_id}/push
  POST /api/v1/mut/{project_id}/pull
  POST /api/v1/mut/{project_id}/negotiate
```

两者殊途同归——都通过 MutOps 调用同一套 MUT Handlers。

---

## 4. 权限模型 — P5

Agent 权限完全由 **MUT scope**（`access_points.config.scope`）定义，path-based：

```json
{
  "path": "docs/",
  "exclude": ["docs/internal/"],
  "mode": "rw"
}
```

权限在 MUT clone/push 时**前置过滤**——clone 只给你 scope 内的文件，push 只允许改 scope 内的路径。

| 维度 | 说明 |
|------|------|
| 粒度 | path prefix + exclude（一条规则管一棵子树） |
| 执行点 | MUT handler 在 clone/push 时强制执行 |
| 新建文件 | scope 内新建的文件自动有权限 |
| 文件移动 | path 变了权限自动跟随 |
| 管理成本 | 1 个 scope 定义，不是 N 个文件 = N 行记录 |

---

## 5. 问题解决速查表

| 问题 | 由哪个组件解决 | 怎么解决 |
|------|--------------|---------|
| P1 文件系统界面 | MUT clone + MutOps | `mut clone` 把 Merkle tree 展开为普通文件夹，Agent bash 全兼容；或走 Tree API / MCP 跳过文件系统 |
| P2 并发访问 | MUT 乐观并发 | 各 Agent 各自 clone 独立工作区，push 时 MUT handler 自动 3-way merge |
| P3 版本管理 | MUT Merkle tree + mut_commits | 每次 push 产生新 commit（root_hash 变化），`mut_commits` 记录完整历史；回滚 = 恢复到某 commit 的 root_hash |
| P4 冲突解决 | MUT handle_push 内置 3-way merge | push 时 client 的 `base_commit_id` ≠ 当前 `head_commit_id` → 自动三方合并；真冲突返回 conflicts 数组 |
| P5 权限隔离 | MUT scope (access_points.config.scope) | path-based 权限，clone 时只给 scope 内文件，push 时拒绝越权写入 |
| P6 资源效率 | Content-addressable S3 | 相同内容只存一份 blob（Merkle tree 天然去重）；Agent workspace 用 APFS Clone (macOS) / cp -r (Linux) |
| P7 可上云 | PuppyOneServerRepo 解构 | MUT server 解构到 S3 + PG，API 服务完全无状态（锁用内存 threading.Lock），可水平扩展 |

---

## 6. 总结

```
MUT = Git for AI Agents
  ├── Merkle tree (S3)  — 文件内容 + 树结构（唯一 SOT）
  ├── mut_commits (PG)  — 版本历史
  ├── audit_logs (PG)   — 审计日志
  ├── scope (PG)        — 权限边界
  └── clone / push / pull / negotiate — 协议

PuppyOne = GitHub for MUT
  ├── 项目/组织/用户管理
  ├── Agent/Connector/MCP/Sandbox 统一注册（access_points 表）
  ├── Access Point（URL + credential）
  ├── Web UI + Tree API + MUT Protocol
  └── Datasource connectors (Gmail/Notion/GitHub/...)
```

| 层 | 职责 | 一句话 | 代码模块 |
|----|------|-------|---------|
| **MUT Handlers** | 版本/冲突/权限/审计 | 所有写入的最终闸门 | `mut_engine/server_repo.py` + MUT 核心库 |
| **MutOps** | 统一操作入口 | 所有 channel 的读写都走这里 | `mut_engine/ops.py` |
| **Channels** | 触发 + 认证 | Web UI / Agent / Connector / Ingest / MCP / FS Sync | `connectors/`, `endpoints/`, `content/` |
| **Storage** | 数据持久化 | S3 (blobs) + PG (控制平面) | `mut_engine/backends/` |
| **Sandbox** | Agent 执行环境 | Docker / E2B（可选） | `sandbox/` |
