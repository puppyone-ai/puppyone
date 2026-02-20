# Agent Context Base 技术方案决策报告

## 一、问题定义

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

---

## 二、决策维度

我们将技术方案拆成 5 个独立维度，每个维度有多个备选：

```
维度 1: 后端存储      → 数据最终持久化在哪里
维度 2: Agent 接口层  → Agent 怎么和数据交互
维度 3: 同步机制      → 多 Agent 之间怎么看到彼此的改动
维度 4: 冲突解决      → 两个 Agent 改同一文件怎么办
维度 5: 隔离/沙盒     → Agent 的执行环境怎么隔离
```

---

## 三、维度 1：后端存储

### 备选方案

| 方案 | 描述 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| A. 纯文件系统 | 本地磁盘/NFS | 简单，Agent 天然兼容 | 无版本管理，无并发控制，无审计 | ❌ 淘汰 |
| B. 纯数据库 (PG) | 所有数据存 PG | 有事务、版本、并发 | 大文件（视频/音频）存 PG 成本过高 | ❌ 淘汰 |
| C. 纯对象存储 (S3) | 所有数据存 S3 | 大文件便宜，可跨机器 | 无事务，元数据查询慢 | ❌ 淘汰 |
| **D. S3 + PG 混合** | **PG 存元数据/小文件/版本链，S3 存大文件内容** | **兼具两者优点** | **需要维护两套存储的一致性** | **✅ 选定** |

### 决策理由

- Agent 会处理各种文件：JSON/Markdown（小）、MP4/音频（大）
- 小文件的元数据和版本信息需要事务保证 → PG
- 大文件需要低成本存储 → S3
- 两者结合是业界标准做法（GitHub、Notion 都是类似架构）

### 存储结构

```
PG 存什么：
├── file_metadata (路径、大小、MIME、权限)
├── file_versions (版本号、时间戳、操作者、S3 key)
├── file_operations (操作日志：谁在何时做了什么)
├── small_file_content (< 256KB 的文件直接存 PG，避免 S3 roundtrip)
└── access_policies (哪个 agent/access point 能访问什么)

S3 存什么：
└── 文件内容本体（按版本号存储，不可变对象）
    s3://bucket/v42/data/config.json
    s3://bucket/v42/media/video.mp4
```

---

## 四、维度 2：Agent 接口层

Agent 需要文件系统界面，但后端是 S3+PG。中间需要一个翻译层。这是整个架构中最关键的维度之一。

> **本节在分层架构中的位置：**
> - 本节决定的"写隔离 + 先写后合并"模式 → 对应 **L3-Folder**（接口层）和 **L2**（协同层）的协作方式
> - "基础快照"（后文的 Lower）→ 对应 **L2.5** 维护的本地缓存
> - "每 Agent 独立工作区"（后文的 Upper）→ 对应 **L3-Folder** 的 WorkspaceProvider
> - OverlayFS / APFS Clone / 全量复制 → 仅是写隔离的**平台级实现技术**

### 核心模式："先写后合并"

在讨论具体技术方案之前，先明确我们要解决的根本问题：

```
Agent 需要看到普通文件系统 → 需要把 S3+PG 的数据变成本地文件
多个 Agent 可能同时写同一个文件 → 需要写隔离，各写各的
改完之后要合并回去 → 需要变更检测和冲突解决
```

这就是"先写后合并"模式：

```
┌────────────────────────────────────────────────────────┐
│ 1. 基础快照（L2.5 维护）                                 │
│    S3+PG 的数据同步到本地，形成一份"共享快照"              │
│                                                        │
│ 2. 工作区隔离（L3-Folder 负责）                           │
│    为每个 Agent 创建独立的工作区副本                       │
│    Agent 在副本里自由读写，不影响其他 Agent                │
│                                                        │
│ 3. 变更检测 + 合并（L2.5 检测 → L2 合并）                 │
│    Agent 写完后，对比"工作区"和"基础快照"的差异             │
│    差异 → 送进 L2 做乐观锁检测 + 三方合并 + 版本记录      │
└────────────────────────────────────────────────────────┘
```

**"先写后合并"是所有冲突解决的前提。没有写隔离，冲突在发生的瞬间数据就丢失了，无法回溯。**

### 写隔离的实现技术（按平台选择）

"先写后合并"是模式，具体怎么创建"隔离的工作区副本"因平台而异：

| 平台 | 技术 | 原理 | 适用场景 |
|------|------|------|---------|
| Linux (EC2/Railway) | **OverlayFS** | 内核原生 CoW：共享只读 Lower + 每 Agent 独立 Upper，写时复制 | 1000 Agent 大规模，存储最省 |
| macOS (Mac mini/本地开发) | **APFS Clone** (`cp -cR`) | APFS 原生 CoW，克隆速度与文件大小无关，零额外存储 | 1-10 Agent 本地开发 |
| 通用 Fallback | **全量复制** (`cp -r`) | 每个 Agent 完整复制一份 | 任何平台，单 Agent 或小数据量 |
| 无本地文件系统 (n8n/Lambda) | **不需要** | 走 REST API / SDK，不经过文件系统层 | 纯 API 模式 |

**核心原则：不管用哪种技术，"先写后合并"的模式和冲突解决逻辑（L2）完全相同，与平台无关。**

### 被排除的方案及理由

在确定"先写后合并"之前，我们评估了其他 Agent 接口方案：

#### 方案 2A/2B：共享目录 / Docker Volume（❌ 无写隔离）

```
多个 Agent 共享同一个目录 → 一个 Agent 的写入立刻覆盖另一个 → 数据丢失，无法检测冲突
```

#### 方案 2D：工具拦截层（❌ 无法穷举）

```
Agent 的 read/write/exec ──> 拦截层 ──> 转写为 S3+PG 操作
```

- **排除理由**：无法穷举所有 bash 行为。Agent 可以执行任意脚本（`python script.py` 内部的文件操作无法拦截）、使用管道（`cat a.txt | grep x > b.txt`）、调用 git 等复杂工具。维护成本不可控。

#### 方案 2E：FUSE 虚拟文件系统（❌ 语义鸿沟）

```
Agent Docker ──> FUSE 挂载点 ──> 直接读写 S3+PG
```

- **排除理由：语义鸿沟无法弥合。** FUSE 工作在系统调用层面（open/read/write/close），但应用程序对文件的操作意图存在于应用层，FUSE 看不到：

| 用户意图 | FUSE 实际看到的 | 语义差距 |
|---------|---------------|---------|
| 改 JSON 一个字段 | 整个文件 truncate + rewrite | 不知道只改了一个字段，误判为全文件替换 |
| vim `:w` 保存 | 写 .swp → rename → rename → delete（4 步） | 不知道这是一次保存，可能把中间状态同步 |
| `sed -i 's/old/new/'` | 创建临时文件 → 写入 → rename | 临时文件不该被同步 |
| git commit | 多个 .git/ 下文件的写入 + rename | 中间状态同步会导致 git 仓库损坏 |

- 每种应用的文件操作模式都不同，FUSE 必须为每种做特殊处理，而这些模式是无穷的

### 方案对比矩阵

| 场景 | 共享目录 (2A/2B) | **先写后合并 (2C)** | 工具拦截 (2D) | FUSE (2E) |
|------|-----------------|---------------------|-------------|---------|
| 写隔离能力 | ❌ 无 | **✅ 有** | ✅ 有 | ✅ 有 |
| bash 全兼容 | ✅ | **✅** | ❌ | ✅ |
| 实现复杂度 | 低 | 中 | 极高 | 中 |
| 1000 Agent 只读 | 1份共享 | **1份快照共享** | N/A | 1000个FUSE进程 |
| 100 Agent 写同一文件 | 覆盖丢失 | **各写各的副本** | 可拦截 | 可拦截 |
| **结论** | **❌ 淘汰** | **✅ 选定** | **❌ 淘汰** | **❌ 淘汰** |

### OverlayFS 深入：大规模场景下的关键优化

OverlayFS 是 Linux 内核原生的联合文件系统，专门适合大规模（100-1000 Agent）场景的资源优化：

```
Agent Docker ──bind mount──> OverlayFS merged 目录
                                ├── Lower (基础快照，只读共享，L2.5 维护)
                                └── Upper (每 Agent 独立可写层，L3-Folder 管理)
```

- **Lower Layer** = L2.5 从 S3+PG 同步到本地的基础快照，所有 Agent 共享一份
- **Upper Layer** = 每个 Agent 独立的可写层，写操作自动 Copy-on-Write
- **Merged View** = Agent 实际看到的合成视图（未改的文件穿透读 Lower，改过的读 Upper）
- **Whiteout 文件** (.wh.xxx) = OverlayFS 标记删除操作的机制

**资源消耗对比**（工作区 500MB、1000 Agent）：

| 场景 | OverlayFS (CoW) | 全量复制 | 节省 |
|------|-----------------|---------|------|
| 1000 Agent 全部只读 | 1份 Lower ≈ **500MB** | 500MB × 1000 = **500GB** | 99.9% |
| 100 Agent 各改1个10KB文件 | 500MB + 1MB ≈ **501MB** | 500MB × 100 = **50GB** | 99% |
| 10 Agent 各改10个文件 | 500MB + 几MB ≈ **503MB** | 500MB × 10 = **5GB** | 90% |

**OverlayFS 不是架构的必要条件** — 没有 OverlayFS（macOS/小规模），"先写后合并"模式依然完整工作，只是全量复制时存储效率低。OverlayFS 是 L2.5 + L3-Folder 在 Linux 大规模场景下的一个性能优化手段。

---

## 五、维度 3：同步机制

> **本节在分层架构中的位置：**
> - 下行同步（PUSH）→ **L2.5** 从 S3+PG 拉数据到本地基础快照
> - 上行合并（PULL）→ **L2.5** 检测工作区变更 → 调 **L2** commit
> - 权限检查、冲突解决 → **L2** CollaborationService
>
> 本节使用"基础快照"和"工作区"等通用术语描述同步流程。
> 在 OverlayFS 场景下，"基础快照" = Lower Layer，"工作区" = Upper + Merged。
> 在 APFS Clone / 全量复制场景下，"基础快照" = 原始目录，"工作区" = Clone / Copy。

### 同步架构

```
S3 + PG (源头真相, L1)
    │                      ▲
    ▼                      │
L2.5 PUSH              L2.5 PULL → L2 commit
(下行同步)              (上行合并: 变更检测 → 冲突解决 → 版本记录)
S3+PG → 基础快照        工作区变更 → L2
    │                      ▲
    ▼                      │
基础快照 ←───── 各 Agent 工作区
(共享只读)      (每个 Agent 独立)
```

| 方向 | L 层归属 | 职责 |
|------|---------|------|
| PUSH（下行） | L2.5 | 定期从 S3+PG 拉取最新数据到本地基础快照 |
| PULL（上行） | L2.5 检测 → L2 写入 | 扫描各 Agent 工作区的变更，送入 L2 做合并 |

### 下行同步（S3+PG → 基础快照 → Agent）

L2.5 更新基础快照后，Agent 的可见性取决于写隔离技术：

- **OverlayFS 模式**：Agent 没改过的文件 → 穿透读 Lower → 自动看到新内容（零带宽）；改过的 → 读 Upper → 不受影响
- **APFS Clone / 全量复制模式**：每个 Agent 是独立副本，下行更新需要 diff + patch 或重新创建工作区

**对于只读 Agent，下行同步是零成本的 — 更新 1 份基础快照，所有 Agent 自动可见（OverlayFS 穿透机制）或被通知拉取。**

### 上行合并（工作区变更 → L2）

L2.5 定期检测各 Agent 工作区的变更：

```
扫描 Agent A 工作区:
  ├── config.json (修改)     → 准备提交
  ├── new-file.md (新建)     → 准备提交
  └── old-file (删除)        → 准备提交
      (OverlayFS 用 .wh.xxx whiteout 文件标记删除)
      (APFS Clone / cp -r 用 hash 对比检测删除)

对每个变更，L2.5 调 L2.commit()：
  1. L2 查权限表 → 该 Agent 有权改这个文件吗？
  2. L2 查版本表 → 乐观锁检测（base_version vs current_version）
  3. 无冲突 → 写入 L1 (S3+PG)，记录版本
  4. 有冲突 → L2 ConflictService 三方合并（见维度 4）
```

### 权限类型定义

| 权限级别 | 缩写 | 说明 |
|----------|------|------|
| 只读 | R | 只能读取文件，不能做任何修改 |
| 只读+追加 | RA | 可以读、可以新建文件，不能改/删已有文件 |
| 读写受限 | RW- | 可以读写，但不能删除 |
| 完全读写 | RW | 读、写、改、删都可以 |

### 各权限场景下的同步行为

#### 场景 1：1000 Agent 全部只读（R）

```
S3+PG ──L2.5 PUSH──> 基础快照 (1份)
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
          Agent 1      Agent 2  ... Agent 1000
          工作区: 只读   工作区: 只读   工作区: 只读
```

| 指标 | 值 |
|------|-----|
| 存储 | 基础快照 1 份 + 1000 个只读工作区（OverlayFS 模式下 ≈ 1 份数据量）|
| 同步带宽 | L2.5 更新基础快照即可，Agent 自动可见（OverlayFS）或按需拉取 |
| 冲突 | 不存在 |

#### 场景 2：只读 + 追加（RA）

Agent 可以往文件夹里加新文件，但不能改已有文件。

```
基础快照:                    Agent A 工作区:
├── data.json  (不可改)     └── report-a.md  (新建 ✅)
└── config.yaml (不可改)    
                            Agent B 工作区:
                            └── report-b.md  (新建 ✅)

如果 Agent A 试图修改 data.json → L2 commit 时拒绝（权限不足）
```

| 指标 | 值 |
|------|-----|
| 存储 | 基础快照 1 份 + 每个工作区只有新建文件 |
| 同步 | L2.5 PULL 收集工作区中的新文件 → L2 commit → 写入 L1 |
| 冲突 | 几乎不存在（除非两个 Agent 新建了同名文件 → 自动重命名） |
| 权限执行 | L2 commit 时检查：修改已有文件的操作 → 拒绝 |

#### 场景 3：混合权限（同一文件夹下不同文件不同权限）

```
/workspace/
├── shared-config.json    ← 所有 Agent 可读，不可写 (R)
├── public-data/          ← 所有 Agent 可读，不可写 (R)
├── agent-a-workspace/    ← 只有 Agent A 可读写 (RW)
├── agent-b-workspace/    ← 只有 Agent B 可读写 (RW)
└── dropbox/              ← 所有 Agent 可追加，不可改已有文件 (RA)
```

权限表存在 PG 中（L1），L2 在 commit 时强制执行：

```
┌──────────────────────┬───────────┬───────────┐
│ 路径模式              │ Agent A   │ Agent B   │
├──────────────────────┼───────────┼───────────┤
│ /shared-config.json  │ R         │ R         │
│ /public-data/*       │ R         │ R         │
│ /agent-a-workspace/* │ RW        │ 不可见     │
│ /agent-b-workspace/* │ 不可见     │ RW        │
│ /dropbox/*           │ RA        │ RA        │
└──────────────────────┴───────────┴───────────┘
```

**权限不在文件系统层面执行，而是在 L2 commit 时执行：**

```
Agent A 在容器里执行: echo "hack" > /workspace/shared-config.json

文件系统允许写入（写隔离层不管权限）→ 写入 Agent A 的工作区

L2.5 PULL 检测到变更 → 调 L2.commit()
→ L2 查 PG 权限表：Agent A 对此文件只有 R 权限
→ 拒绝 commit，撤销工作区中的该文件
→ 通知 Agent A："权限不足，改动已撤销"
```

| 指标 | 值 |
|------|-----|
| 存储 | 基础快照 1 份 + 每个工作区只有该 Agent 的合法改动 |
| 权限执行 | L2 commit 时根据 PG 权限表检查 |
| 可见性控制 | 可通过不同的基础快照内容控制 Agent 看到不同文件 |
| 冲突 | 只在两个 Agent 都有 RW 权限的文件上可能发生 |

#### 场景 4：100 Agent 同时写同一文件

```
基础快照: config.json = {"count": 1, "name": "old"}

Agent A 工作区: config.json = {"count": 2, "name": "old"}    ← 改了 count
Agent B 工作区: config.json = {"count": 1, "name": "new"}    ← 改了 name
```

L2.5 检测到变更 → L2 ConflictService 三方比较：

```
字段 count: Base=1, A=2, B=1 → 只有 A 改了 → 采用 A 的值
字段 name:  Base="old", A="old", B="new" → 只有 B 改了 → 采用 B 的值
合并结果: {"count": 2, "name": "new"} → 无冲突，自动合并

但如果都改了同一个字段：
Agent A 工作区: config.json = {"count": 2}
Agent B 工作区: config.json = {"count": 99}
→ count: A=2, B=99 → 真正的冲突 → 进入冲突解决策略
```

### 同步频率策略

| 模式 | 下行间隔 | 上行间隔 | 适用场景 |
|------|---------|---------|---------|
| 懒同步 | 30s-60s | 任务完成时 | Agent 独立工作，不需要实时看到彼此的改动 |
| 常规同步 | 5s-10s | 5s-10s | Agent 需要较快看到彼此的改动 |
| 事件驱动 | PG NOTIFY 触发 | Agent 写入时触发 | 需要准实时协作 |

### 带宽分析

| 操作 | 带宽 |
|------|------|
| 基础快照更新（PUSH 下行） | 只传变更的文件，增量同步 |
| 工作区变更合并（PULL 上行） | 只传各 Agent 的改动文件 |
| 只读 Agent 看到更新 | **零带宽**（OverlayFS 穿透机制）或按需 diff（Clone/Copy 模式） |
| 变更通知 | PG NOTIFY，~100 bytes/条 |
| 1000 Agent 只读 + 1个 Agent 每秒改 10 次 | ~1MB/s 通知 + 按需下载（对比全量推送的 ~100MB/s） |

### 写隔离为什么是必须的

```
没有写隔离的问题（共享目录 / Docker Volume）：

Agent A 写 config.json → 直接落盘
Agent B 同时写 config.json → 直接覆盖 Agent A 的内容
→ 没有任何中间层能检测到冲突 → 数据直接丢失

有写隔离的优势（先写后合并模式）：

Agent A 写 config.json → 落到 Agent A 的工作区
Agent B 写 config.json → 落到 Agent B 的工作区
→ 两份改动都安全保存，互不影响
→ L2.5 + L2 有充足的时间和信息来检测和解决冲突
```

---

## 六、维度 4：冲突解决

冲突解决需要在两个层面做决策，这两个层面相互独立：

```
层面 1：并发策略 — Agent 写入时阻不阻塞？
  ├── 悲观锁：写前加锁，同一时间只有一个 Agent 能写
  └── 乐观并发：各自写，事后检测冲突

层面 2：冲突解决算法 — 检测到冲突后，用什么方法解决？
  ├── Last-Writer-Wins（时间戳优先）
  ├── Agent 优先级
  ├── 三方合并（Git 风格 diff3）
  ├── OT（Operational Transformation）
  ├── CRDT（Conflict-free Replicated Data Types）
  └── 人工/AI 审核队列
```

**CRDT、OT、Git 三方合并等不是和"乐观并发"并列的方案，而是在乐观并发检测到冲突后，具体用什么算法来解决冲突。它们完全可以组合使用。**

### 层面 1：并发策略

| 方案 | 描述 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| 悲观锁 | 写前加锁，同时只有一个 agent 能写某个文件 | 无冲突 | 并发写被阻塞，性能差 | ❌ |
| **乐观并发** | **各自写工作区，L2 commit 时检测冲突** | **写入不阻塞，并发性能好** | **冲突在后期处理** | **✅ 选定** |

### 层面 2：冲突解决算法

#### 所有备选算法详解

| 算法 | 原理 | 优点 | 缺点 | 适用文件类型 |
|------|------|------|------|-------------|
| **Last-Writer-Wins** | 时间戳最新的覆盖旧的 | 最简单，零复杂度 | 丢失先写入的改动 | 二进制文件、不重要的配置 |
| **Agent 优先级** | 高优先级 Agent 的版本胜出 | 简单，可控 | 低优先级 Agent 的改动被丢弃 | 有明确主从关系的场景 |
| **三方合并 (Git diff3)** | Base + Ours + Theirs 三方 diff，改不同部分自动合并，改同一部分标记冲突 | 成熟、文本文件效果好 | 二进制文件无法 diff；同区域冲突仍需兜底 | .md / .txt / .json / .yaml / 代码 |
| **OT** | 把改动转化为操作序列（insert/delete），通过变换函数保证操作可交换 | 实时协同体验好（Google Docs 用的） | 实现极复杂；需要中心服务器排序操作 | 实时文本协同编辑 |
| **CRDT** | 数据结构本身保证合并无冲突（如 G-Counter、LWW-Register、RGA） | 天然无冲突，可去中心化，支持离线 | 文件级 CRDT 复杂度高；需保留操作历史，存储开销大 | 共享计数器、列表、集合等结构化数据 |
| **人工/AI 审核** | 冲突标记后放入队列 | 最安全，关键文件不会被错误合并 | 慢，阻塞后续操作 | 关键配置、不可自动合并的文件 |

#### 各算法在我们架构中的落地分析

**Git 三方合并 — 主力算法，适用大部分场景：**

```
Base (基础快照 / L2.5 sync_state 中记录的版本): config.json v1
Agent A 工作区: config.json (Agent A 的改动)
Agent B 工作区: config.json (Agent B 的改动)

L2 ConflictService:
  1. diff3(base, A, B)
  2. 不同区域的改动 → 自动合并
  3. 相同区域的改动 → 冲突标记，进审核队列
```

实现成本低，Node.js/Python 生态有现成的 diff3 库。适合 .md / .txt / .json / .yaml 等文本文件。

**CRDT — 适用特定数据结构：**

```
例：多个 Agent 往一个共享列表追加条目

Agent A 追加: ["task-1"]
Agent B 追加: ["task-2"]

CRDT (G-Set / RGA):
  合并结果: ["task-1", "task-2"]  ← 天然无冲突，自动合并
```

局限性：
- 文本文件需要用 RGA/YATA 等序列 CRDT，存储开销大
- 二进制文件无法用 CRDT
- 需要在文件格式上做特殊适配

**落地建议**：不在文件系统层面全面用 CRDT，而是在特定业务数据上启用（如 Agent 的共享任务列表、状态寄存器等）。可以通过文件命名约定（如 `.crdt.json`）标记哪些文件使用 CRDT 合并。

**OT — 当前不适用，但预留接口：**

```
OT 需要：
  1. 中心服务器对操作实时排序
  2. 每次编辑都实时发送操作序列
  3. 所有客户端保持连接

我们的场景：
  - Agent 在容器里离线编辑文件
  - 改动在工作区里累积，L2.5 定期 PULL 到 L2
  - 没有实时操作流
```

**落地建议**：如果未来有 Agent 实时协同编辑同一个文件的需求（类似 Google Docs 场景），可以引入 OT。当前"先写后合并"的模式下，Git 三方合并更合适。

### 决策：按文件类型组合使用多种算法

```
L2 ConflictService 检测到冲突
    │
    ├── .md / .txt / .json / .yaml / 代码文件
    │   → Git 三方合并 (diff3)
    │   改不同部分 → 自动合并
    │   改同一部分 → 标记冲突 → 人工/AI 审核
    │
    ├── .crdt.json 等 CRDT 标记的文件
    │   → CRDT 自动合并（天然无冲突）
    │
    ├── 二进制文件（图片/视频/音频）
    │   → Last-Writer-Wins 或 Agent 优先级
    │   （二进制文件无法 diff，只能整体替换）
    │
    └── 关键配置文件（通过 PG 标记）
        → 人工/AI 审核队列（不允许自动合并）
```

### 冲突检测方法

```
L2.5 检测到 Agent A 和 Agent B 的工作区都改了 config.json
→ 依次调 L2.commit()，第二个 commit 触发冲突检测

三方比较（Git 风格）：
  Base  (sync_state 记录的上次同步版本):  config.json 合并前的内容
  Ours  (当前 L1 版本，Agent A 先提交的): Agent A 的改动
  Theirs(Agent B 的工作区):               Agent B 的改动

if Base == Ours:    → A 没改，B 改了 → 采用 B 的版本
if Base == Theirs:  → B 没改，A 改了 → 采用 A 的版本
if Ours == Theirs:  → 都改了但改成一样的 → 采用任一版本
else:               → 真正的冲突 → 根据文件类型选择对应的解决算法
```

### L2.5 PULL + L2 commit 的完整工作流程

```
1. L2.5 扫描所有 Agent 工作区，收集改动文件列表
   变更检测方式因平台而异：
   - OverlayFS: 扫描 Upper Layer（whiteout 文件 .wh.xxx 表示删除）
   - APFS Clone / cp -r: 对比工作区和基础快照的 hash
   - FileWatcher (规划中): 实时监听文件系统事件

2. 对每个改动，L2.5 调 L2.commit()：
   a. L2 检查权限表 → 无权的改动直接拒绝
   b. L2 乐观锁检测 → base_version vs current_version
   c. 无冲突 → 写入 L1 (S3+PG)，记录版本
   d. 有冲突 → L2 ConflictService 按文件类型三方合并

3. L2 commit 成功后：
   - 更新 PG 版本链（记录 who/when/what/用了什么算法）
   - 上传新版本到 S3
   - L2.5 更新 sync_state（last_sync_version）
   - L2.5 PUSH 刷新基础快照（让其他 Agent 看到最新内容）
```

---

## 七、维度 5：隔离/沙盒

**沙盒是可选积木。** 谁需要沙盒取决于 Agent 的交互方式和谁管执行环境。

| 场景 | 交互方式 | 谁管沙盒 | 我们需要提供沙盒吗 |
|------|---------|---------|------------------|
| CloudBot (内置 Agent) | 文件系统 (bash) | 我们管 | ✅ 需要 — Docker 容器沙盒 |
| Manus 沙盒模式 | 文件系统 (bash) | 我们管 | ✅ 需要 — 和 CloudBot 相同 |
| OpenClaw on Mac | 文件系统 (bash) | OpenClaw 管 | ❌ 只提供数据文件夹 |
| Claude Code / Cursor | 文件系统 (bash) | 用户自己 | ❌ 只提供数据文件夹 |
| n8n / Lambda | API (REST) | 无需沙盒 | ❌ 只提供 API |
| Manus API 模式 | API (REST) | 无需沙盒 | ❌ 只提供 API |

> **注意：同一个外部 Agent（如 Manus）可能有两种接入方式。** 如果 Manus 返回 bash 命令让我们执行，它就需要我们的沙盒（和 CloudBot 基础设施完全相同）。如果 Manus 通过 REST API 读写数据，则不需要沙盒。

### 我们提供的沙盒方案（文件系统模式使用）

| 方案 | 描述 | 结论 |
|------|------|------|
| 无隔离 | Agent 直接在宿主机运行 | ❌ 安全风险：Agent 能访问整个主机，包括所有 Docker 容器 |
| OS 用户隔离 | 不同用户运行不同 Agent | ❌ 粒度粗，管理复杂 |
| **Docker 容器** | **每个 Agent 在独立容器中运行** | **✅ 进程隔离 + 文件系统隔离 + 网络隔离** |

### 决策理由（来自 OpenClaw 代码调研）

- 非沙盒模式下，Agent 的 `exec` 工具可以执行任意 shell 命令，访问宿主机全部文件系统
- 如果运行用户有 Docker 权限（在 docker 组），Agent 甚至能通过 `docker exec` 穿透进其他容器
- Docker 容器沙盒：无 Docker CLI、无 `/var/run/docker.sock`、根文件系统只读、`--cap-drop ALL`、`--security-opt no-new-privileges`

### Docker + 写隔离结合方式

**Linux (OverlayFS 模式)：**

```bash
# 宿主机上为每个 agent 创建 OverlayFS 挂载
mount -t overlay overlay \
  -o lowerdir=/mnt/lower,upperdir=/mnt/upper-agent-a,workdir=/mnt/work-a \
  /mnt/merged-agent-a

# 然后把 merged 目录挂进 Docker 容器
docker run \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --network none \
  -v /mnt/merged-agent-a:/workspace \
  agent-sandbox-image
```

**macOS (APFS Clone 模式)：**

```bash
# APFS Clone 创建工作区副本（零额外存储，瞬间完成）
cp -cR /tmp/contextbase/lower/project-1/ /tmp/contextbase/workspaces/agent-a/

# Agent 容器挂载工作区
docker run \
  --read-only \
  --cap-drop ALL \
  -v /tmp/contextbase/workspaces/agent-a:/workspace \
  agent-sandbox-image
```

**外部 Agent（OpenClaw 等，不需要我们的沙盒）：**

```bash
# 我们只负责准备工作区目录，OpenClaw 自己负责沙盒
# Step 1: 调 API 创建工作区
curl -X POST http://localhost:8000/api/v1/workspace/create \
  -d '{"project_id": "xxx", "agent_id": "openclaw-1"}'
# → {"workspace_path": "/tmp/contextbase/workspaces/openclaw-1"}

# Step 2: OpenClaw 把这个目录挂载给自己的 Agent
# Step 3: Agent 完成后，调 API 提交变更
curl -X POST http://localhost:8000/api/v1/workspace/openclaw-1/complete?project_id=xxx
```

---

## 八、最终架构总图

### 通用架构（适用于所有平台）

```
┌─────────────── 云端 (L1 + L2) ────────────────────────┐
│                                                        │
│   ┌──────────┐        ┌──────────┐                     │
│   │  L1: S3  │        │  L1: PG  │                     │
│   │ 文件内容 │        │ 元数据   │                     │
│   │ 大文件   │        │ 版本链   │                     │
│   │          │        │ 操作日志 │                     │
│   │          │        │ 权限表   │                     │
│   └────┬─────┘        └────┬─────┘                     │
│        └────────┬──────────┘                           │
│    ┌────────────┴────────────┐                         │
│    │   L2: Collaboration     │ ← 唯一写入闸门          │
│    │   乐观锁 + 三方合并      │                         │
│    │   版本管理 + 审计日志     │                         │
│    └────────────┬────────────┘                         │
│                 │                                      │
└─────────────────┼──────────────────────────────────────┘
                  │
┌─────────────────┼──── 每个部署节点（云 VM 或本地机）────┐
│                 │                                      │
│    ┌────────────┴────────────┐                         │
│    │  L2.5: Sync Service     │ ← 后台双向同步          │
│    │  PUSH: L1 → 基础快照    │                         │
│    │  PULL: 工作区变更 → L2   │                         │
│    └────────────┬────────────┘                         │
│                 │                                      │
│    ┌────────────┴────────────┐                         │
│    │  L3: 基础快照            │ ← L2.5 维护的本地缓存   │
│    │  (共享只读，只有一份)     │                         │
│    └──┬─────────┬─────────┬──┘                         │
│       │         │         │                            │
│    工作区 A  工作区 B  工作区 C  (L3-Folder: 每 Agent   │
│       │         │         │      独立的写隔离副本)      │
│       │         │         │                            │
│  ┌────┴───┐ ┌───┴────┐ ┌─┴──────┐                     │
│  │  L4:   │ │  L4:   │ │  L4:   │  (沙盒容器, 可选)    │
│  │Docker A│ │Docker B│ │Docker C│                      │
│  │/work   │ │/work   │ │/work   │                      │
│  │space   │ │space   │ │space   │                      │
│  └────────┘ └────────┘ └────────┘                      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### OverlayFS 优化（Linux 大规模场景）

上图中的"基础快照"和"工作区"在不同平台上有不同的实现方式。**OverlayFS 是 Linux 上的高效实现**：

```
基础快照  = OverlayFS Lower Layer  (所有 Agent 共享，只读)
工作区    = OverlayFS Upper Layer  (每 Agent 独立，CoW 写时复制)
Agent 视图 = OverlayFS Merged View (Lower + Upper 合成，Agent 操作的目录)
```

在 macOS 上用 APFS Clone (`cp -cR`)，在通用平台上用 `cp -r`，架构逻辑完全不变。

---

## 九、各问题的解决方式速查表

> **注意：本节沿用维度分析中的术语（Sync Daemon / Merge Daemon / OverlayFS），与第十一节的分层架构（L1-L4）对应关系如下：**
> - Sync Daemon / Merge Daemon → L2.5 Sync Service（后台双向同步）
> - 冲突解决 / 权限检查 → L2 CollaborationService（写入闸门）
> - OverlayFS / APFS Clone → L3-Folder WorkspaceProvider（文件系统接口）
> - **详细的分层速查表见第十五节。**

| 问题 | 由哪个组件解决 | 怎么解决 |
|------|--------------|---------|
| P1 文件系统界面 | L3-Folder（写隔离工作区）+ Docker bind mount | Agent 看到普通文件系统，bash 命令全兼容，完全无感知 |
| P2 并发访问 | "先写后合并" + 基础快照共享 | 读共享一份基础快照（零额外开销），写各自独立工作区（无锁竞争）|
| P3 版本管理 | PG 版本链 + S3 不可变存储 | 每次合并创建新版本，旧版本永远可回溯 |
| P4 冲突解决 | L2.5 检测变更 + L2 冲突合并 | 乐观并发写入 Upper；L2.5 PULL 变更 → L2 按文件类型选算法（diff3 / CRDT / LWW / 审核队列） |
| P5 权限隔离 | PG 权限表 + L2 权限检查 + Docker 挂载控制 | 每个 Agent 只挂载被允许的目录；非法写入在 L2 commit 时被拒绝 |
| P6 资源效率 | 平台级 CoW 优化（OverlayFS / APFS Clone） | 1000 只读 Agent ≈ 1 份存储（~500MB）；写只存增量（~KB 级） |
| P7 可上云 | S3+PG 云端 + VM 上部署节点 | 存储在云端（S3+PG），计算节点可弹性伸缩（K8s Pod） |

---

## 十、核心技术选型总结

```
后端存储:    S3 + PG 混合存储（Supabase + AWS S3）
接口层:      三种形态按需选择
             ├── L3-Folder: 本地文件夹（OverlayFS / APFS Clone / 全量复制）
             ├── L3-API:    REST 端点（/api/v1/collab/*, /api/v1/workspace/*）
             └── L3-SDK:    Python/JS/Go 包（规划中）
同步机制:    L2.5 Sync Service (后台双向同步服务)
             ├── 职责 1 — PULL: 从外部系统拉取变更 → 翻译 → L2.commit()
             ├── 职责 2 — PUSH: 监听 L2 写入事件 → 翻译 → 推到外部系统
             ├── 职责 3 — 状态管理: 身份映射 + 同步版本追踪 + 变更检测
             ├── FilesystemAdapter: 本地文件夹双向同步 (OpenClaw/Cursor)
             ├── NotionAdapter / GmailAdapter / GitHubAdapter 等: SaaS 双向同步
             └── FileWatcher: 本地文件变更实时检测 (规划中)
并发策略:    乐观并发（各自写副本，commit 时检测冲突）
冲突解决:    按文件类型组合多种算法：
             ├── JSON → Key 级三方合并（只冲突字段报错，其余自动合并）
             ├── Markdown / 文本 → 行级三方合并 (diff3)
             ├── 二进制文件 → Last-Writer-Wins / Agent 优先级
             ├── 关键文件 → 人工/AI 审核队列
             └── 预留扩展 → CRDT（共享列表）、OT（实时协同）
沙盒方案:    可选积木
             ├── CloudBot 模式: Docker 容器 (read-only, cap-drop ALL)
             ├── OpenClaw 模式: 用户自己的 Docker（我们只提供文件夹）
             └── API 模式: 不需要沙盒
通知机制:    PG LISTEN/NOTIFY + 按需拉取

重要原则:    L2 (CollaborationService) 是唯一的写入闸门 —— 所有写入最终都经过 L2
             L2.5 不是闸门，是后台传送带 —— 负责和外部系统双向同步，不拦截任何写入
             写入来源（Web UI / Agent / API / SaaS Adapter）各自直接调用 L2
             L2.5 在后台监听 L2 的写入事件，自动推送到已连接的外部系统
```

---

## 十一、分层架构（积木式拆分）

上面的技术选型解决了"用什么技术"，这一节解决"怎么组装" —— 不同场景下，用户用到的组件组合不同。

### 11.1 五层积木

```
┌─────────────────────────────────────────────────────────┐
│ L4: Sandbox 沙盒层（可选）                                │
│ Agent 在哪里运行: Docker / E2B / 无沙盒                   │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────┐
│ L3: Interface 接口层（面向用户和 Agent 的直接入口）         │
│ ┌──────────┐  ┌───────────┐  ┌─────────────────────┐    │
│ │ L3-API   │  │ L3-Folder │  │ L3-SDK              │    │
│ │ REST 端点 │  │ 本地文件夹 │  │ Python/JS/Go 包     │    │
│ │ Web UI   │  │           │  │                     │    │
│ └────┬─────┘  └─────┬─────┘  └──────────┬──────────┘    │
└──────┼──────────────┼───────────────────┼───────────────┘
       │              │                   │
┌──────┴──────────────┴───────────────────┴───────────────┐
│ L2: Collaboration 协同层（必选，核心，唯一的写入闸门）      │
│ 乐观锁 │ 三方合并 │ 版本管理 │ 审计日志                    │
│ 所有写入 —— 不管来自 Web UI / Agent / API / SaaS          │
│ Adapter / 文件同步 —— 最终都经过这里                       │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────┼───────────────────────────────────────┐
│ L2.5: Sync Service 双向同步服务（后台传送带，非写入闸门）   │
│                 │                                       │
│ 后台独立运行，做两件事：                                    │
│ · PULL: 定期从外部系统拉取变更 → 翻译 → 喂给 L2           │
│ · PUSH: 监听 L2 的写入事件 → 翻译 → 推到外部系统           │
│                 │                                       │
│ ┌─────────┐ ┌──┴────┐ ┌──────┐ ┌──────┐ ┌──────┐      │
│ │Filesys. │ │Notion │ │Gmail │ │GitHub│ │Sheets│ ...   │
│ │Adapter  │ │Adapt. │ │Adapt.│ │Adapt.│ │Adapt.│       │
│ └─────────┘ └───────┘ └──────┘ └──────┘ └──────┘       │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────┴───────────────────────────────────────┐
│ L1: Storage 存储层（必选）                                │
│ S3 (文件内容) + PG (元数据/版本链/权限)                    │
└─────────────────────────────────────────────────────────┘
```

**数据流规则：**
- **所有写入直接进 L2** —— L3-API、L3-SDK、L3-Folder、Agent、Web UI 的写操作全部直接调用 L2（CollaborationService.commit）
- **没有任何写入"经过" L2.5** —— L2.5 不是闸门，不拦截写入
- **L2.5 是后台传送带** —— 独立运行，负责两个方向的自动同步：
  - PULL 方向：从已连接的外部系统（Notion/Gmail/文件夹等）拉取变更 → 翻译 → 调 L2.commit() 写入
  - PUSH 方向：监听 L2 的写入事件 → 检测哪些外部系统关联了该节点 → 翻译 → 推到外部系统
- **L2.5 的同步状态**让三方合并成为可能：它记住"上次和某个外部系统同步到哪个版本了"，这就是三方合并所需的 Base

### 11.2 场景积木组合一览

> **区分标准不是"谁是 Agent"，而是"Agent 用什么方式和数据交互"：**
> - Agent 通过**文件系统**读写数据（bash 命令操作文件）→ 需要 L2.5 FS Adapter + L3-Folder
> - Agent 通过**REST API**读写数据（JSON 请求/响应）→ 只需 L3-API，不需要 L2.5
> - 同一个外部 Agent（如 Manus）可能有两种接入方式，用哪套积木取决于接入方式，不取决于 Agent 身份。

```
交互方式                    ┌─────────┬──────────┬────────────────────┬────────────┬──────────┐
                           │ L1      │ L2       │ L2.5               │ L3         │ L4       │
                           │ Storage │ Collab   │ Sync Service       │ Interface  │ Sandbox  │
───────────────────────────┼─────────┼──────────┼────────────────────┼────────────┼──────────┤
文件系统模式 — 我们提供沙盒:                                                                  │
  CloudBot (内置 Agent)     │ ✅      │ ✅       │ FS Adapter         │ Folder     │ ✅ Docker │
  Manus 沙盒模式            │ ✅      │ ✅       │ FS Adapter         │ Folder     │ ✅ Docker │
  (Manus 返回 bash → 我们跑) │         │          │                    │            │          │
───────────────────────────┼─────────┼──────────┼────────────────────┼────────────┼──────────┤
文件系统模式 — 外部管沙盒:                                                                    │
  OpenClaw on Mac           │ ✅      │ ✅       │ FS Adapter         │ Folder     │ ❌       │
  OpenClaw on EC2           │ ✅      │ ✅       │ FS Adapter +OFS    │ Folder     │ ❌       │
  Claude Code / Cursor      │ ✅      │ ✅       │ FS Adapter         │ Folder     │ ❌       │
───────────────────────────┼─────────┼──────────┼────────────────────┼────────────┼──────────┤
API 模式 — 外部自管同步:                                                                      │
  n8n / Zapier              │ ✅      │ ✅       │ ❌ (自己管同步)     │ API        │ ❌       │
  Manus API 模式            │ ✅      │ ✅       │ ❌ (自己管同步)     │ API        │ ❌       │
  (Manus 调 REST API 读写)  │         │          │                    │            │          │
  Lambda / Serverless       │ ✅      │ ✅       │ ❌                 │ API 或 SDK │ ❌       │
───────────────────────────┼─────────┼──────────┼────────────────────┼────────────┼──────────┤
SaaS 双向同步:                                                                               │
  Notion 双向同步            │ ✅      │ ✅       │ Notion Adapter     │ —          │ ❌       │
  Gmail 同步                │ ✅      │ ✅       │ Gmail Adapter      │ —          │ ❌       │
  GitHub 同步               │ ✅      │ ✅       │ GitHub Adapter     │ —          │ ❌       │
───────────────────────────┼─────────┼──────────┼────────────────────┼────────────┼──────────┤
混合模式:                                                                                    │
  OpenClaw + Notion 同步     │ ✅      │ ✅       │ FS + Notion Adapt. │ Folder     │ ❌       │
```

**关键规律：**
- **区分标准是交互方式，不是操作者身份（人/Agent/SaaS）** — 同一操作者可以有多种接入方式
- **凡是在文件系统上读写的，都需要 L2.5 FS Adapter** — 不管是人手动改文件、Agent 执行 bash、还是 Manus 返回命令
- **凡是通过 REST API / Web UI 读写的，不需要 L2.5** — 直接调 L2，自己管 checkout/commit 生命周期
- **凡是通过外部 SaaS 变更的，需要对应的 L2.5 Adapter** — 如 Notion 页面编辑、Gmail 新邮件
- 多个 Adapter 可以同时运行（如 OpenClaw + Notion：Agent 在本地文件夹改了 → L2 写入 → L2.5 自动推到 Notion）

> **人类的改动遵循完全相同的规则：**
> - 人在 Web UI 编辑 → L3-API → L2（不经过 L2.5）
> - 人在本地同步文件夹手动改文件 → L2.5 FS Adapter 检测 → L2
> - 人在 Notion 编辑同步页面 → L2.5 Notion Adapter 检测 → L2
> - 人通过 curl 调 REST API → L3-API → L2（不经过 L2.5）
>
> **L2.5 不区分"人还是机器"，只区分"数据从哪个外部系统来"。**

### 11.3 L2.5 Sync Service 详细定义

> **L2.5 是后台运行的双向同步服务，不是写入必须经过的闸门。**
> 所有写入直接进 L2。L2.5 在后台自动把 L2 的变化推到外部系统，把外部系统的变化拉进 L2。

#### L2.5 解决什么问题

L2（CollaborationService）是无状态的写入闸门——它接收一个 commit 请求，处理完就忘了。它不知道也不关心数据从哪来。

但当 PuppyOne 需要和外部系统（Notion、Gmail、本地文件夹等）保持持续同步时，有一组 L2 管不了的问题：

| 问题 | 例子 |
|------|------|
| 这个 Notion 页面对应 PuppyOne 哪个 node？ | Notion page_id `abc123` ↔ node_id `uuid-xxx` |
| 上次和 Notion 同步时内容是什么？ | 三方合并需要的 Base |
| Notion 那边变了没有？ | L2 只看 PuppyOne 内部，看不到外面 |
| 怎么把 Notion blocks 翻译成 Markdown？ | 格式转换 |
| 什么时候该去拉一次 Notion？ | 调度 |

**这些问题就是 L2.5 存在的全部理由：管理 PuppyOne 和外部系统之间的持续双向关系。**

#### L2.5 的三个职责

```
L2.5: Sync Service

职责 1 — PULL（从外部拉变化）
  · 定期/事件触发检查外部系统是否变了
  · 变了 → 翻译格式 → 调 L2.commit() 写入 PuppyOne
  · 提供正确的 base_version 和 base_content，让 L2 能做三方合并

职责 2 — PUSH（把 L2 变化推出去）
  · 监听 L2 的写入事件（PG NOTIFY / 轮询 version 变化）
  · 有新版本 → 检查哪些外部系统关联了这个 node → 翻译 → 推出去

职责 3 — 状态管理
  · 维护 external_id ↔ node_id 的身份映射
  · 记住每个连接的上次同步点（last_sync_version + last_remote_hash）
  · 为三方合并提供 Base
```

#### 什么经过 L2.5，什么不经过

判断标准不是"谁在写"，而是"有没有外部系统需要自动保持同步"：

| 场景 | 经过 L2.5？ | 理由 |
|------|-----------|------|
| 用户在 Web UI 编辑 | 不经过 | 用户直接在 PuppyOne 里操作，直接调 L2 |
| n8n 通过 API 修改 | 不经过 | n8n 直接调 L2 API，自己管同步逻辑 |
| PuppyOne 内置 Agent 修改 | 不经过 | Agent 直接调 L2.commit() |
| Notion 页面变了 | 经过（PULL 方向） | L2.5 NotionAdapter 检测到变更 → 拉取 → 喂给 L2 |
| OpenClaw Agent 改了文件 | 经过（PULL 方向） | L2.5 FilesystemAdapter 检测到文件变化 → 喂给 L2 |
| 有人在 Web UI 改了数据 | 经过（PUSH 方向） | L2.5 监听到 L2 写入 → 推到已连接的 Notion / 文件夹 |

**关键区分：写入本身不"经过" L2.5。L2.5 是在后台异步工作的传送带。**

#### 具体数据流示例

**示例 1：n8n 通过 API 改了内容**

```
n8n → POST /collab/commit → L2 写入成功 (v6)
                                    │
                              L2.5 后台监听到 v6 是新版本
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              Notion Adapter   FS Adapter      Gmail Adapter
              检查：这个 node  检查：这个 node  检查：这个 node
              有 Notion 连接？ 有文件夹连接？    有 Gmail 连接？
              有 → 推到 Notion  有 → 写到文件    没有 → 跳过
```

**示例 2：OpenClaw Agent 改了文件，同时 Notion 那边也改了**

```
L2.5 FilesystemAdapter 检测到 AGENTS.md 变了
  → 查 sync_state: base_version=5
  → 调 L2.commit(base_version=5, content=文件新内容)
  → L2 检测到 current_version=6（因为 Notion 先同步了 v6）
  → L2 ConflictService 三方合并: Base(v5) + Current(v6) + New(文件)
  → 合并成功 → v7
        │
  L2.5 监听到 v7
        │
  ┌─────┴─────┐
  FS Adapter   Notion Adapter
  写回文件      推到 Notion
```

#### Sync State（同步状态）数据结构

每个"外部连接"维护一套状态：

```
sync_connections 表：
┌──────────┬───────────┬──────────────────┬────────────┬────────────────┬──────────────┐
│ 连接 ID   │ adapter   │ external_id      │ node_id    │ last_sync_ver  │ remote_hash  │
├──────────┼───────────┼──────────────────┼────────────┼────────────────┼──────────────┤
│ conn-1   │ notion    │ page_id=abc123   │ uuid-xxx   │ 5              │ sha256-xxx   │
│ conn-2   │ filesystem│ path=AGENTS.md   │ uuid-yyy   │ 7              │ sha256-yyy   │
│ conn-3   │ gmail     │ thread_id=t456   │ uuid-zzz   │ 3              │ sha256-zzz   │
└──────────┴───────────┴──────────────────┴────────────┴────────────────┴──────────────┘
```

这套状态让 L2.5 能回答三个关键问题：

| 问题 | 如何判断 |
|------|---------|
| 外部变了没？ | 对比 remote_hash 和当前外部内容的 hash |
| PuppyOne 变了没？ | 对比 last_sync_version 和当前 node 的 current_version |
| 两边都变了怎么办？ | 从 file_versions 取 last_sync_version 的内容作为 Base → 交给 L2 三方合并 |

**没有这套状态，三方合并做不了** —— 因为不知道 Base 是什么。这就是 L2.5 存在的根本原因。

### 11.4 OverlayFS 在分层架构中的精确定位

> **OverlayFS 是 Linux 上"先写后合并"模式的高效实现技术，不是架构本身。**
> 没有 OverlayFS，架构照样工作（macOS 用 APFS Clone，通用平台用 cp -r）。
> 有 OverlayFS，大规模场景（100-1000 Agent）的存储效率提升 99%。

#### OverlayFS 概念与 L 层的映射

| OverlayFS 概念 | L 层归属 | 职责 |
|---------------|---------|------|
| Lower Layer | L2.5 管理的**基础快照** | L2.5 PUSH 的输出目标；从 S3+PG 同步来的本地缓存，所有 Agent 共享只读 |
| Upper Layer | L3-Folder 的**工作区** | 每个 Agent 独立的可写层；Agent 的改动自动 CoW 到这里 |
| Merged View | L3-Folder 的**挂载点** | Agent 实际看到的合成视图；未改的文件穿透读 Lower，改过的读 Upper |
| Whiteout (.wh.xxx) | L2.5 PULL 的**删除信号** | OverlayFS 标记文件删除的方式，L2.5 据此判断 Agent 删了什么 |
| 对比 Upper vs Lower | L2.5 PULL 的**变更检测** | 只需扫描 Upper 目录即可知道 Agent 改了什么（增量检测） |

#### 为什么 OverlayFS 不是架构的必要条件

```
"先写后合并"模式的三个步骤：
  1. 准备基础快照（L2.5 PUSH）
  2. 创建隔离工作区（L3-Folder WorkspaceProvider）
  3. 检测变更并合并（L2.5 PULL → L2 commit）

每一步都有多种实现方式：

步骤 1 — 准备基础快照：
  · OverlayFS: 所有 Agent 共享一份 Lower（最省）
  · APFS Clone: 每个 Agent 是一份 Clone（CoW，几乎零开销）
  · cp -r: 每个 Agent 完整复制（最耗存储）

步骤 2 — 创建隔离工作区：
  · OverlayFS: 自动 CoW，Upper 只存改动
  · APFS Clone: 内核级 CoW，Clone 只存改动
  · cp -r: 完整副本

步骤 3 — 检测变更：
  · OverlayFS: 扫描 Upper 目录 + whiteout 文件
  · APFS Clone / cp -r: hash 对比（基础快照 vs 工作区）
  · FileWatcher (规划中): 实时文件系统事件监听
```

**三种方式的区别仅是效率，架构语义完全相同。** 实施时通过 L3-Folder 的 `WorkspaceProvider` 工厂模式自动选择平台最优实现。

### 11.5 可追溯性保证：为什么所有路径都有版本管理

> **不管数据从哪里来、走哪条路径，所有内容变更都有完整的版本历史、审计日志和回滚能力。**
> 这是 L2 作为"唯一写入闸门"的最核心架构保证。

#### 所有路径汇聚到 L2

```
人在 Web UI 编辑 ──────────────→ L3-API ──→ L2.commit() ──→ ✅ 版本记录
人用 curl 调 API ──────────────→ L3-API ──→ L2.commit() ──→ ✅ 版本记录
内置 Agent (CloudBot) ─────────→ L3-API ──→ L2.commit() ──→ ✅ 版本记录
n8n 工作流 ────────────────────→ L3-API ──→ L2.commit() ──→ ✅ 版本记录
Manus API 模式 ────────────────→ L3-API ──→ L2.commit() ──→ ✅ 版本记录
人手动改本地文件 ──→ L2.5 FS Adapter ──────→ L2.commit() ──→ ✅ 版本记录
Agent 改本地文件 ──→ L2.5 FS Adapter ──────→ L2.commit() ──→ ✅ 版本记录
Notion 页面变了 ──→ L2.5 Notion Adapter ──→ L2.commit() ──→ ✅ 版本记录
Gmail 新邮件 ────→ L2.5 Gmail Adapter ────→ L2.commit() ──→ ✅ 版本记录
```

**没有任何路径能绕过 L2。** L2.5 不是旁路——它最终调的也是 L2.commit()。API 模式不是旁路——它直接调 L2.commit()。所有路径都汇聚到同一个入口。

#### L2 在每次 commit 时记录什么

| 记录内容 | 存储位置 | 用途 |
|---------|---------|------|
| 版本号 (version_id) | file_versions 表 | 唯一标识每次变更 |
| 变更内容 (content) | file_versions 表 + S3 | 完整的文件内容快照 |
| 基准版本 (base_version) | file_versions 表 | 这次改动基于哪个版本 |
| 操作者类型 (operator_type) | audit_log 表 | web_ui / agent / external_agent / saas_adapter / api |
| 操作者 ID (operator_id) | audit_log 表 | 具体是谁（user_id / agent_id / adapter 名） |
| 时间戳 (created_at) | 两张表 | 精确到毫秒 |
| 变更摘要 (summary) | audit_log 表 | 人可读的描述 |
| 合并策略 (merge_strategy) | audit_log 表 | auto_merge / lww / manual（如果有冲突的话） |

#### 这套机制能回答的问题

| 问题 | 如何回答 |
|------|---------|
| 这个文件被谁改过？ | 查 audit_log，按 node_id 筛选 |
| 上一个版本是什么内容？ | 查 file_versions，取 version - 1 |
| 回滚到某个版本 | 从 file_versions 取该版本内容 → L2.commit() 写入新版本 |
| Agent 改了什么？ | 查 audit_log，筛选 operator_type = agent |
| Notion 同步进来的变更 | 查 audit_log，筛选 operator_type = saas_adapter, operator_id = notion |
| 某次合并是怎么解决冲突的？ | 查 audit_log 的 merge_strategy 和 summary |
| 两个 Agent 同时改了同一文件？ | file_versions 的 base_version 链可以还原完整的分叉和合并历史 |

#### "绕过 L2.5"不等于"绕过版本管理"

这是一个容易产生的误解，需要明确澄清：

```
误解：L2.5 负责版本管理，绕过 L2.5 = 没有版本管理
事实：L2 负责版本管理，L2.5 只是一种喂数据给 L2 的方式

      ┌─────────────────────────────────────────┐
      │ 版本管理、审计、冲突解决 = L2 的职责       │
      │ 和外部系统保持同步 = L2.5 的职责           │
      │ 两个完全不同的关注点                       │
      └─────────────────────────────────────────┘

API 模式"绕过"的是 L2.5（不需要自动同步），不是 L2（版本管理）。
所有写入都经过 L2，所以所有写入都有版本记录。
```

---

## 十二、各场景详细数据流

### 场景 A：OpenClaw on Mac（本地 Daemon 模式）

**典型用户**：在自己的 Mac 上安装了 OpenClaw，有 1-3 个 Agent。

```
         你的 Mac                                      云端
┌──────────────────────────────┐            ┌──────────────────┐
│                              │            │                  │
│  ┌────────────────────────┐  │            │                  │
│  │ OpenClaw 的 Docker 容器 │  │            │                  │
│  │ (OpenClaw 自己管沙盒)   │  │            │                  │
│  └───────────┬────────────┘  │            │                  │
│              │ 读写文件       │            │                  │
│  ┌───────────▼────────────┐  │            │                  │
│  │ L3-Folder: 工作区目录   │  │            │                  │
│  │ /tmp/contextbase/       │  │            │                  │
│  │   workspaces/openclaw-1 │  │            │                  │
│  └───────────┬────────────┘  │            │                  │
│              │ detect_changes │   REST     │  ┌────────────┐  │
│  ┌───────────▼────────────┐  │───────────→│  │ L2 Collab  │  │
│  │ L2.5: Sync Service     │  │            │  │ commit()   │  │
│  │ (FilesystemAdapter)    │  │            │  │ checkout() │  │
│  │ PULL: 文件变化→L2      │  │            │  └─────┬──────┘  │
│  │ PUSH: L2变更→写文件    │  │            │                  │
│  │ + FileWatcher (规划中)  │  │            │                  │
│  └────────────────────────┘  │            │  ┌─────▼──────┐  │
│                              │            │  │ L1: S3+PG  │  │
└──────────────────────────────┘            └──┴────────────┴──┘
```

**使用积木**：L1 + L2 + L2.5 (FilesystemAdapter) + L3-Folder
**不使用**：L4（OpenClaw 自己管沙盒）

**数据流（L2.5 FilesystemAdapter 双向同步）**：

```
PULL 方向（OpenClaw 文件 → PuppyOne）:
  L2.5 FilesystemAdapter 检测到本地文件变化
  → 查 sync_state 获取 base_version
  → 调 L2.commit(base_version, content) 写入 PuppyOne
  → L2 做乐观锁检测 + 三方合并 + 版本记录

PUSH 方向（PuppyOne → OpenClaw 文件）:
  L2.5 监听到 L2 有新写入（如用户在 Web UI 编辑了 AGENTS.md）
  → FilesystemAdapter 检测到 node 的 current_version > last_sync_version
  → 从 L1 读取最新内容 → 写到本地文件
  → 更新 sync_state
```

**当前实现**：手动触发模式（`POST /workspace/create` + `POST /workspace/{id}/complete`）
**规划中**：FileWatcher 自动检测 + 后台持续同步（全自动，无需手动 curl）

### 场景 B：纯 API 模式（n8n / Lambda / Manus API 接入）

**典型用户**：用 n8n 工作流或 Manus 通过 REST API 直接读写 Context 数据，不涉及文件系统。

```
     n8n / Lambda / Manus(API模式)           云端
┌──────────────────────────┐          ┌──────────────────┐
│                          │          │                  │
│  HTTP Request:           │   REST   │  ┌────────────┐  │
│  POST /collab/checkout   │─────────→│  │ L3-API     │  │
│  POST /collab/commit     │          │  │ Router     │  │
│  GET  /collab/versions   │          │  └─────┬──────┘  │
│                          │          │  ┌─────▼──────┐  │
│  (无本地文件系统)          │          │  │ L2 Collab  │  │
│                          │          │  └─────┬──────┘  │
│                          │          │  ┌─────▼──────┐  │
│                          │          │  │ L1: S3+PG  │  │
└──────────────────────────┘          └──┴────────────┴──┘
```

**使用积木**：L1 + L2 + L3-API
**不使用**：L2.5（外部自己管 checkout/commit 生命周期）、L4（不需要沙盒）

**数据流**：
1. `POST /collab/checkout` → 获取数据 + base_version
2. 外部自行修改数据
3. `POST /collab/commit` → 乐观锁检测 → 三方合并 → 版本记录

**注意**：写入不经过 L2.5，但如果该 node 关联了外部系统（如 Notion），L2.5 会在后台自动把改动推到 Notion。

### 场景 B2：外部 Agent 沙盒模式（Manus / 任意 Agent 返回 bash 命令）

**典型用户**：Manus 等外部 Agent 返回 bash 命令，在我们的沙盒里执行。

> **这个场景和 CloudBot（场景 C）在基础设施层面完全相同。**
> 区别仅在于"谁生成 bash 命令"——CloudBot 用内置 LLM，Manus 用外部 LLM。
> L2.5 / L3 / L4 不关心 bash 命令的来源，只关心文件系统上的变化。

```
     外部 Agent (Manus 等)             我们的基础设施
┌──────────────────────────┐    ┌──────────────────────────────────┐
│                          │    │                                  │
│  Agent 返回 bash 命令:    │    │  ┌────────────────────────────┐  │
│  "jq '.name = \"new\"'   │───→│  │ AgentService (编排器)       │  │
│   /workspace/config.json"│    │  │  1. 准备沙盒 + 挂载工作区   │  │
│                          │    │  │  2. 执行 bash 命令           │  │
│                          │    │  │  3. L2.5 检测文件变更        │  │
│                          │    │  │  4. L2.commit()              │  │
│                          │    │  └──────┬───────────┬──────────┘  │
│                          │    │  ┌──────▼──────┐ ┌──▼───────────┐│
│                          │    │  │ L2 Collab   │ │ L2.5 FS Adpt ││
│                          │    │  └──────┬──────┘ └──┬───────────┘│
│                          │    │  ┌──────▼───────────▼──────────┐ │
│                          │    │  │ L1: S3+PG                   │ │
│                          │    │  └─────────────────────────────┘ │
└──────────────────────────┘    └──────────────────────────────────┘
```

**使用积木**：L1 + L2 + L2.5 FS Adapter + L3-Folder + L4 Docker（和 CloudBot 完全相同）
**与 CloudBot 的唯一区别**：bash 命令的来源不同（外部 Agent vs 内置 LLM）

### 场景 C：文件系统模式 — CloudBot / Manus 沙盒（全套积木）

**典型用户**：在 ContextBase 产品内使用 Agent 对话功能；或外部 Agent（Manus 等）返回 bash 命令在我们沙盒执行。

> **CloudBot 和 Manus 沙盒模式在基础设施层面完全相同** — 都是在 Docker 沙盒里挂载工作区、执行 bash 命令、L2.5 检测文件变更、L2 commit。唯一区别是 bash 命令的来源（内置 LLM vs 外部 Agent）。

```
     ContextBase 产品内部
┌──────────────────────────────────────────────┐
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ AgentService (编排器)                   │  │
│  │                                        │  │
│  │  1. prepare_sandbox_data()             │  │
│  │  2. sandbox.create() + mount()         │  │   ┌──────────┐
│  │  3. Claude API 对话 + bash 工具调用     │  │   │ L4:      │
│  │  4. CollaborationService.commit()      │──┼──→│ Docker   │
│  │  5. sandbox.destroy()                  │  │   │ 沙盒     │
│  │                                        │  │   └──────────┘
│  └──────┬─────────────┬───────────────────┘  │
│         │             │                      │
│  ┌──────▼──────┐ ┌────▼──────────────┐        │
│  │ L2 Collab   │ │ L2.5 Sync Service│        │
│  │ commit()    │ │ (后台推送到外部)   │        │
│  └──────┬──────┘ └────┬─────────────┘        │
│  ┌──────▼─────────────▼──────┐               │
│  │ L1: S3 + PG (Supabase)   │               │
│  └───────────────────────────┘               │
└──────────────────────────────────────────────┘
```

**使用积木**：全部（L1 + L2 + L2.5 FilesystemAdapter + L3-Folder + L4）
**Agent 的写入直接进 L2（不经过 L2.5），L2.5 在后台负责文件同步**

### 场景 D：EC2 + 100 个 Agent（大规模 OverlayFS 模式）

**与场景 A 的区别**：
- Linux 系统 → WorkspaceProvider 使用 OverlayFS（而非 APFS Clone）
- 100 个 Agent 共享一份 Lower → 存储从 50GB 降到 ~500MB
- 需要 root 权限 mount overlay

```
         EC2 (Linux)
┌──────────────────────────────────────────┐
│                                          │
│  Lower Layer (1 份, ~500MB)               │
│  ┌──────────────────────────────────┐    │
│  │ /mnt/lower/project-1/           │    │
│  └────┬────────┬────────┬──────────┘    │
│       │        │        │               │
│   Upper 1  Upper 2 ... Upper 100        │
│       │        │        │               │
│   Merged 1 Merged 2 .. Merged 100       │
│       │        │        │               │
│   Docker 1 Docker 2 .. Docker 100       │
│                                          │
│  存储: 500MB + 100×(各自改动) ≈ 502MB    │
│  对比全量复制: 500MB × 100 = 50GB        │
│  节省: 99%                               │
└──────────────────────────────────────────┘
```

---

## 十三、部署架构选项

### 方案 A：端云混合（推荐 — 当前架构）

- 云端：S3 (AWS) + PG (Supabase) + L2 协同层 (FastAPI)
- 端侧：L2.5 Sync Service (FilesystemAdapter) + L3-Folder (本地文件夹) + 用户自己的 Agent
- **适用**：OpenClaw on Mac / Claude Code / Cursor / 自定义 Agent

### 方案 B：全云部署

- S3 + PG + L2 + L4 全部在云端
- 用户通过 L3-API 或 Web UI 交互
- **适用**：CloudBot、n8n、Manus、SaaS 生产环境

### 方案 C：全本地部署

- S3 用 MinIO/LocalStack 本地部署，PG 本地安装
- 所有组件在同一台机器
- **适用**：离线环境、开发测试、隐私敏感场景

---

## 十四、代码与架构映射

当前仓库中各层的代码位置：

```
L1  Storage       → backend/src/content_node/repository.py  (PG 元数据 CRUD)
                  → backend/src/s3/service.py               (S3 文件存取)

L2  Collaboration → backend/src/collaboration/              (协同层, 核心)
                  │ ├── service.py         CollaborationService 统一入口
                  │ ├── conflict_service.py JSON Key 级 + 文本行级三方合并
                  │ ├── lock_service.py     乐观锁 (current_version 检测)
                  │ ├── version_service.py  文件版本 + 文件夹快照管理
                  │ ├── audit_service.py    操作审计日志
                  │ ├── router.py           /api/v1/collab/* REST 端点
                  │ └── schemas.py          Pydantic 数据模型

L2.5 Sync Service → backend/src/sync/                      (双向同步服务，后台传送带)
                  │ ├── sync_worker.py     PULL 方向：S3+PG → 本地文件增量同步
                  │ ├── cache_manager.py   本地 Lower 目录管理
                  │ ├── schemas.py         SyncResult 等数据模型
                  │ ├── (规划) adapters/    统一适配器接口
                  │ │   ├── filesystem.py  FilesystemAdapter (OpenClaw/Cursor 文件夹)
                  │ │   ├── notion.py      NotionAdapter (双向同步)
                  │ │   ├── gmail.py       GmailAdapter (双向同步)
                  │ │   └── ...            其他 SaaS Adapter
                  │ ├── (规划) sync_state.py  同步状态管理 (身份映射 + 版本追踪)
                  │ └── (规划) router.py      同步调度器 (定时/事件/手动触发)
                  │
                  │ 注意：当前 SaaS 导入在 backend/src/ingest/saas/
                  │ 未来迁移为 L2.5 Adapter 时，现有 Handler.process()
                  │ 对应新接口的 pull()，新增 push() 实现双向同步

L3  Interface     → backend/src/workspace/                  (文件夹接口)
                  │ ├── provider.py        WorkspaceProvider 抽象 + 工厂
                  │ ├── apfs_provider.py   macOS APFS Clone 实现
                  │ ├── fallback_provider.py 全量复制 Fallback
                  │ └── router.py          /api/v1/workspace/* REST 端点
                  → backend/src/collaboration/router.py     (API 接口, 共用 L2)

L4  Sandbox       → backend/src/sandbox/                    (Docker/E2B 执行环境)

    Orchestrator  → backend/src/agent/service.py            (Agent 编排器)
                  → backend/src/agent/sandbox_data.py       (沙盒数据准备)
```

---

## 十五、各问题的解决方式速查表

| 问题 | 由哪个组件解决 | 怎么解决 |
|------|--------------|---------|
| P1 文件系统界面 | L3-Folder + L2.5 FilesystemAdapter | Agent 看到普通文件夹，bash 命令全兼容；L2.5 在后台把文件变化同步到 L2；或走 L3-API / L3-SDK 跳过文件系统 |
| P2 并发访问 | L2 乐观锁 + L3-Folder 写隔离 | 各 Agent 写各自的工作区副本（APFS Clone/OverlayFS/全量复制），commit 时由 L2 协同 |
| P3 版本管理 | L2 VersionService + AuditService | **所有路径（Web UI / Agent / API / L2.5 Adapter）最终都经过 L2.commit()**，每次创建 file_version + audit_log；"绕过 L2.5"≠"绕过版本管理" |
| P4 冲突解决 | L2 ConflictService + L2.5 Sync State | L2 做三方合并；L2.5 提供 Base（通过 sync_state 记住上次同步版本） |
| P5 权限隔离 | L2 权限检查 + L3 挂载控制 | 每个 Agent 只看到被允许的文件；非法写入在 commit 时被拒绝 |
| P6 资源效率 | L3-Folder 平台优化 | OverlayFS CoW (Linux) / APFS Clone (macOS) / API 模式零本地存储 |
| P7 可上云 | L1 云端存储 + L2 云端协同 | S3+PG 在云端，计算节点可弹性伸缩；API 模式天然云原生 |

---

*本报告从调研 OpenClaw 项目的文件访问机制出发，经过 Docker 隔离、文件系统原理、并发控制、数据库经验借鉴、OverlayFS 机制等多轮讨论后得出技术方案。后续演进为积木式分层架构，使同一套核心能力（L1 存储 + L2 协同）能适配不同的接入方式（文件夹 / API / SDK）和不同的部署环境（Mac / Linux / 云端 / Serverless）。L2.5 Sync Service 作为后台传送带，统一管理 PuppyOne 与各类外部系统（本地文件夹、Notion、Gmail 等）的双向同步关系，所有写入仍直接经过 L2 协同层。*
