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

### 备选方案详解

#### 方案 2A：宿主机文件系统直通

```
Agent Docker ──bind mount──> 宿主机目录 ──Sync──> S3+PG
```

- Agent 的 Docker 容器直接挂载宿主机上的一个目录
- 一个 Sync Daemon 在宿主机上负责这个目录和 S3+PG 之间的同步
- **优点**：最简单，Agent 看到的就是普通文件系统
- **缺点**：所有 Agent 共享同一个目录，写冲突在文件系统层面无法隔离；一个 Agent 的写入会立刻覆盖另一个 Agent 的内容

#### 方案 2B：Docker Volume 直挂

```
Agent Docker ──mount──> Docker Volume ──Sync──> S3+PG
```

- 创建 Docker Volume，Sync Daemon 把 S3+PG 内容同步到 Volume 中
- Agent 容器挂载这个 Volume
- **优点**：Docker 原生支持，管理方便；macOS/Windows 上性能比 bind mount 好（Volume 数据在 Docker VM 内部，不需要跨操作系统同步）
- **缺点**：和 2A 一样，多 Agent 写同一个 Volume 无隔离

#### 方案 2C：OverlayFS + Docker bind mount（推荐）

```
Agent Docker ──bind mount──> OverlayFS merged 目录
                                ├── Lower (共享只读快照，从 S3+PG 同步)
                                └── Upper (每个 Agent 独立的可写层)
```

- 宿主机上用 OverlayFS 为每个 Agent 创建独立的 merged 视图
- Agent Docker 容器挂载各自的 merged 目录
- **优点**：写隔离（每个 Agent 写自己的 Upper，互不干扰）、增量存储（Upper 只存改动）、Lower 共享省资源
- **缺点**：需要宿主机 root 权限来 mount overlay；OverlayFS 是 Linux 原生特性，macOS/Windows 需要 Linux VM

#### 方案 2D：工具拦截层（已排除）

```
Agent 的 read/write/exec ──> 拦截层 ──> 转写为 S3+PG 操作
```

- **排除理由**：无法穷举所有 bash 行为。Agent 可以执行任意脚本（`python script.py` 内部的文件操作无法拦截）、使用管道（`cat a.txt | grep x > b.txt`）、调用 git 等复杂工具。维护成本不可控。

#### 方案 2E：FUSE 虚拟文件系统（已排除）

```
Agent Docker ──> FUSE 挂载点 ──> 直接读写 S3+PG
```

- **排除理由：语义鸿沟无法弥合。** FUSE 工作在 Linux 系统调用层面（open/read/write/close），但应用程序对文件的操作意图存在于应用层，FUSE 看不到。这导致大量无法穷举的 corner case：

| 用户意图 | FUSE 实际看到的 | 语义差距 |
|---------|---------------|---------|
| 改 JSON 一个字段 | 整个文件 truncate + rewrite | 不知道只改了一个字段，误判为全文件替换 |
| vim `:w` 保存 | 写 .swp → rename 原文件 → rename .swp → delete 备份（4 步） | 不知道这是一次保存，可能把中间状态同步到 S3 |
| `sed -i 's/old/new/'` | 创建临时文件 → 写入 → rename 替换原文件 | 和 vim 同理，临时文件不该被同步 |
| git commit | 多个 .git/ 下文件的写入 + rename | 不知道这是一个原子操作，中间状态同步会导致 git 仓库损坏 |
| Python tempfile + os.replace | 写临时文件 → 原子替换 | 临时文件被误同步，替换操作的原子性丢失 |
| rsync 增量同步 | 多次 lseek + partial write | 不知道这是增量同步，可能每次 write 都触发一次 S3 上传 |

- 每种应用（vim、sed、git、rsync、Python、Node.js...）都有自己的文件操作模式，FUSE 必须为每种做特殊处理，而这些模式是无穷的
- 性能也是问题：每次 read() 都经过用户态，1000 Agent 并发读时开销不可忽视

### 方案对比矩阵

| 场景 | 2A: 宿主机直通 | 2B: Docker Volume | **2C: OverlayFS** | 2D: 工具拦截 | 2E: FUSE |
|------|---------------|------------------|-------------------|-------------|---------|
| 单 Agent 读写 | 简单 | 简单 | 简单 | 复杂 | 可用 |
| 1000 Agent 只读 | 1份目录共享 | 1个Volume共享 | **1份Lower共享** | N/A | 1000个FUSE进程 |
| 100 Agent 各写不同文件 | 冲突风险 | 冲突风险 | **天然隔离** | 可控 | 各自FUSE |
| 100 Agent 写同一文件 | 覆盖丢失 | 覆盖丢失 | **各写各的Upper** | 可拦截 | 可拦截 |
| 资源（1000 Agent） | 低 | 低 | **低** | 中 | 高 |
| 写隔离能力 | ❌ 无 | ❌ 无 | **✅ 有** | ✅ 有 | ✅ 有 |
| 实现复杂度 | 低 | 低 | 中 | 极高 | 中 |
| bash 全兼容 | ✅ | ✅ | **✅** | ❌ | ✅ |
| **结论** | **❌ 淘汰** | **❌ 淘汰** | **✅ 选定** | **❌ 淘汰** | **❌ 淘汰** |
| **淘汰原因** | 无写隔离，多Agent写同一文件时数据直接覆盖丢失，冲突无法检测 | 同 2A，Docker Volume 不提供写隔离，多 Agent 写仍然互相覆盖 | — | 无法穷举所有 bash 行为（脚本、管道、git 等），维护成本不可控 | 语义鸿沟：FUSE 只看到字节操作，看不到应用意图（vim 保存 4 步操作、sed -i 临时文件、git commit 多文件原子写），每种应用需特殊处理且无法穷举 |

### 决策：选 2C（OverlayFS + Docker bind mount）

**核心理由：OverlayFS 是唯一在文件系统层面天然支持写隔离的方案，同时资源消耗最低。**

- 方案 2A/2B 无写隔离 → 多 Agent 写同一文件时数据直接丢失，冲突无法检测
- 方案 2D 无法穷举 bash 行为 → 维护成本不可控
- 方案 2E 语义鸿沟无法弥合 → FUSE 只看到字节级操作（open/write/rename），看不到应用层意图（vim 保存、git commit、sed -i 等），每种应用的文件操作模式都需要特殊处理，而这些模式是无穷的
- **OverlayFS 给了"先写后合并"的能力 — 这是所有冲突解决的前提。没有写隔离，冲突在发生的瞬间数据就丢失了，无法回溯。**

### 资源消耗对比

以工作区总数据量 500MB、1000 个 Agent 为例：

| 场景 | OverlayFS | 完整复制（无 OverlayFS） |
|------|-----------|------------------------|
| 1000 Agent 全部只读 | 500MB (1份Lower) + ~0 (Upper空) = **~500MB** | 500MB × 1000 = **500GB** |
| 100 Agent 各改1个10KB文件 | 500MB + ~1MB = **~501MB** | 500MB × 100 = **50GB** |
| 10 Agent 各改10个文件 | 500MB + ~几MB = **~503MB** | 500MB × 10 = **5GB** |

**OverlayFS 方案比完整复制节省约 99.9% 的存储。**

---

## 五、维度 3：同步机制

数据在 S3+PG 和 OverlayFS 之间怎么流动。这涉及两个 Daemon 和多种权限场景。

### 同步架构

```
S3 + PG (源头真相)
    │                  ▲
    ▼                  │
Sync Daemon        Merge Daemon
(下行同步)          (上行合并)
S3+PG → Lower     Upper → S3+PG
    │                  ▲
    ▼                  │
Lower Layer ←──── Upper Layers
(只读共享)         (每个Agent独立)
```

| 组件 | 方向 | 职责 |
|------|------|------|
| Sync Daemon | S3+PG → Lower | 定期拉取最新数据到 Lower Layer |
| Merge Daemon | Upper → S3+PG | 扫描各 Agent 的 Upper，合并改动回 S3+PG，检测冲突 |

### 下行同步（S3+PG → Lower → Agent）

当 Sync Daemon 更新 Lower 后，Agent 的可见性取决于 OverlayFS 的穿透机制：

- **Agent 没改过的文件** → 穿透读 Lower → Lower 更新后**自动看到新内容** → 零带宽
- **Agent 改过的文件** → 读自己的 Upper → Lower 更新对该 Agent **不可见** → 进入冲突区

**对于只读 Agent，下行同步是零成本的 — 更新 1 份 Lower，所有 Agent 自动可见。**

### 上行合并（Upper → S3+PG）

Merge Daemon 定期扫描所有 Upper 目录：

```
扫描 Upper A:
  ├── config.json (修改)     → 准备合并
  ├── new-file.md (新建)     → 准备合并
  └── .wh.old-file (whiteout，表示删除) → 准备合并

对每个改动：
  1. 查 PG 权限表 → 该 Agent 有权改这个文件吗？
  2. 查 PG 版本表 → 该文件当前版本是什么？有没有其他 Agent 也改了？
  3. 无冲突 → 上传到 S3，更新 PG 版本链，清理 Upper 中的该文件
  4. 有冲突 → 进入冲突解决流程（见维度 4）
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
S3+PG ──Sync Daemon──> Lower Layer (1份)
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
          Agent 1      Agent 2  ... Agent 1000
          Upper: 空    Upper: 空    Upper: 空
          权限: R      权限: R      权限: R
```

| 指标 | 值 |
|------|-----|
| 存储 | Lower 1 份 + 1000 个空 Upper ≈ 1 份数据量 |
| 同步带宽 | Sync Daemon 更新 Lower 即可，Agent 自动看到，无额外推送 |
| 冲突 | 不存在 |
| 实现 | OverlayFS Lower mount 为 read-only，Upper 也 read-only |

#### 场景 2：只读 + 追加（RA）

Agent 可以往文件夹里加新文件，但不能改已有文件。

```
Lower:                      Upper A:
├── data.json  (不可改)     └── report-a.md  (新建 ✅)
└── config.yaml (不可改)    
                            Upper B:
                            └── report-b.md  (新建 ✅)

如果 Agent A 试图修改 data.json → Merge Daemon 拒绝合并
```

| 指标 | 值 |
|------|-----|
| 存储 | Lower 1 份 + 每个 Upper 只有新建文件 |
| 同步 | Merge Daemon 收集 Upper 中的新文件，追加到 S3+PG，更新 Lower |
| 冲突 | 几乎不存在（除非两个 Agent 新建了同名文件 → 自动重命名） |
| 权限执行 | Merge Daemon 检查：Upper 中的文件如果在 Lower 中已存在 → 拒绝合并 |

#### 场景 3：混合权限（同一文件夹下不同文件不同权限）

```
/workspace/
├── shared-config.json    ← 所有 Agent 可读，不可写 (R)
├── public-data/          ← 所有 Agent 可读，不可写 (R)
├── agent-a-workspace/    ← 只有 Agent A 可读写 (RW)
├── agent-b-workspace/    ← 只有 Agent B 可读写 (RW)
└── dropbox/              ← 所有 Agent 可追加，不可改已有文件 (RA)
```

权限表存在 PG 中，Merge Daemon 合并时强制执行：

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

**权限不是在 OverlayFS 层面执行的，而是在 Merge Daemon 层面：**

```
Agent A 在容器里执行: echo "hack" > /workspace/shared-config.json

OverlayFS 允许写入（它不管权限）→ 写入 Upper A

Merge Daemon 扫描 Upper A → 发现 shared-config.json 被改了
→ 查 PG 权限表：Agent A 对此文件只有 R 权限
→ 拒绝合并，删除 Upper A 中的该文件
→ 通知 Agent A："权限不足，改动已撤销"
```

| 指标 | 值 |
|------|-----|
| 存储 | Lower 1 份 + 每个 Upper 只有该 Agent 的合法改动 |
| 权限执行 | Merge Daemon 根据 PG 权限表在合并时检查 |
| 可见性控制 | 可通过不同的 Lower 层或 OverlayFS 白名单控制 Agent 看到不同文件 |
| 冲突 | 只在两个 Agent 都有 RW 权限的文件上可能发生 |

#### 场景 4：100 Agent 同时写同一文件

```
Lower: config.json = {"count": 1, "name": "old"}

Agent A Upper: config.json = {"count": 2, "name": "old"}    ← 改了 count
Agent B Upper: config.json = {"count": 1, "name": "new"}    ← 改了 name
```

Merge Daemon 三方比较：

```
字段 count: Base=1, A=2, B=1 → 只有 A 改了 → 采用 A 的值
字段 name:  Base="old", A="old", B="new" → 只有 B 改了 → 采用 B 的值
合并结果: {"count": 2, "name": "new"} → 无冲突，自动合并

但如果都改了同一个字段：
Agent A Upper: config.json = {"count": 2}
Agent B Upper: config.json = {"count": 99}
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
| Lower 更新（下行） | 只传变更的文件，增量同步 |
| Upper 合并（上行） | 只传各 Agent 的改动文件 |
| 只读 Agent 看到更新 | **零带宽**（Lower 更新后 OverlayFS 自动穿透） |
| 变更通知 | PG NOTIFY，~100 bytes/条 |
| 1000 Agent 只读 + 1个 Agent 每秒改 10 次 | ~1MB/s 通知 + 按需下载（对比全量推送的 ~100MB/s） |

### 2A/2B 方案为什么在写场景下不可行

```
没有 OverlayFS 的问题（方案 2A/2B）：

Agent A 写 config.json → 直接落盘（宿主机目录或 Docker Volume）
Agent B 同时写 config.json → 直接覆盖 Agent A 的内容
→ 没有任何中间层能检测到冲突 → 数据直接丢失

有 OverlayFS 的优势（方案 2C）：

Agent A 写 config.json → 落到 Upper A
Agent B 写 config.json → 落到 Upper B
→ 两份改动都安全保存，互不影响
→ Merge Daemon 有充足的时间和信息来检测和解决冲突
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
| **乐观并发** | **各自写 Upper，Merge 时检测冲突** | **写入不阻塞，并发性能好** | **冲突在后期处理** | **✅ 选定** |

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
Lower (Base): config.json v1
Upper A:      config.json (Agent A 的改动)
Upper B:      config.json (Agent B 的改动)

Merge Daemon:
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
  - 改动在 Upper 里累积，定期合并
  - 没有实时操作流
```

**落地建议**：如果未来有 Agent 实时协同编辑同一个文件的需求（类似 Google Docs 场景），可以引入 OT。当前"先写后合并"的模式下，Git 三方合并更合适。

### 决策：按文件类型组合使用多种算法

```
Merge Daemon 检测到冲突
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
Merge Daemon 扫描到 Agent A 和 Agent B 的 Upper 都有 config.json

三方比较（Git 风格）：
  Base  (Lower):   config.json 内容 (合并前的版本)
  Ours  (Agent A): Upper A 中的 config.json
  Theirs(Agent B): Upper B 中的 config.json

if Base == Ours:    → A 没改，B 改了 → 采用 B 的版本
if Base == Theirs:  → B 没改，A 改了 → 采用 A 的版本
if Ours == Theirs:  → 都改了但改成一样的 → 采用任一版本
else:               → 真正的冲突 → 根据文件类型选择对应的解决算法
```

### Merge Daemon 的完整工作流程

```
1. 扫描所有 Upper Layer，收集改动文件列表
   （OverlayFS 的 whiteout 文件 .wh.xxx 表示删除操作）

2. 对每个改动文件：
   a. 检查 PG 权限表 → 无权的改动直接拒绝，删除 Upper 中的文件
   b. 只有一个 agent 改了 → 直接合并到 S3+PG
   c. 多个 agent 改了同一文件 → 进入冲突检测

3. 冲突解决（根据文件类型和 PG 中的策略配置）：
   - 文本文件 → Git 三方合并 (diff3)
   - CRDT 标记文件 → CRDT 自动合并
   - 二进制文件 → Last-Writer-Wins 或 Agent 优先级
   - 关键文件 → 人工/AI 审核队列
   - 未来可扩展：OT（实时协同场景）

4. 合并完成后：
   - 更新 PG 版本链（记录 who/when/what/用了什么算法）
   - 上传新版本到 S3
   - 清空对应 Upper Layer
   - Sync Daemon 刷新 Lower Layer
```

---

## 七、维度 5：隔离/沙盒

| 方案 | 描述 | 结论 |
|------|------|------|
| 无隔离 | Agent 直接在宿主机运行 | ❌ 安全风险：Agent 能访问整个主机，包括所有 Docker 容器 |
| OS 用户隔离 | 不同用户运行不同 Agent | ❌ 粒度粗，管理复杂 |
| **Docker 容器** | **每个 Agent 在独立容器中运行** | **✅ 进程隔离 + 文件系统隔离 + 网络隔离** |

### 决策理由（来自 OpenClaw 代码调研）

- 非沙盒模式下，Agent 的 `exec` 工具可以执行任意 shell 命令，访问宿主机全部文件系统
- 如果运行用户有 Docker 权限（在 docker 组），Agent 甚至能通过 `docker exec` 穿透进其他容器
- Docker 容器沙盒：无 Docker CLI、无 `/var/run/docker.sock`、根文件系统只读、`--cap-drop ALL`、`--security-opt no-new-privileges`

### Docker + OverlayFS 结合方式

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

---

## 八、最终架构总图

```
┌─────────────── 云端 ───────────────────────────────────┐
│                                                        │
│   ┌──────────┐        ┌──────────┐                     │
│   │    S3    │        │    PG    │                     │
│   │ 文件内容 │        │ 元数据   │                     │
│   │ 大文件   │        │ 版本链   │                     │
│   │          │        │ 操作日志 │                     │
│   │          │        │ 权限表   │                     │
│   └────┬─────┘        └────┬─────┘                     │
│        └────────┬──────────┘                           │
│                 │                                      │
└─────────────────┼──────────────────────────────────────┘
                  │
┌─────────────────┼──── 每个部署节点（云 VM 或本地机）────┐
│                 │                                      │
│    ┌────────────┴────────────┐                         │
│    │      Sync Daemon        │ ← 拉取 S3+PG → Lower   │
│    │      Merge Daemon       │ ← 读取 Upper → 推回     │
│    │      (权限检查+冲突解决)  │                         │
│    └────────────┬────────────┘                         │
│                 │                                      │
│    ┌────────────┴────────────┐                         │
│    │     Lower Layer         │ ← 只读，只有一份        │
│    │     /mnt/lower/         │                         │
│    └──┬─────────┬─────────┬──┘                         │
│       │         │         │                            │
│    Upper A   Upper B   Upper C   (每 agent 一个)       │
│       │         │         │                            │
│    Merged A  Merged B  Merged C  (OverlayFS 合成)      │
│       │         │         │                            │
│  ┌────┴───┐ ┌───┴────┐ ┌─┴──────┐                     │
│  │Docker A│ │Docker B│ │Docker C│  (沙盒容器)          │
│  │/work   │ │/work   │ │/work   │                      │
│  │space   │ │space   │ │space   │                      │
│  └────────┘ └────────┘ └────────┘                      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 九、各问题的解决方式速查表

| 问题 | 由哪个组件解决 | 怎么解决 |
|------|--------------|---------|
| P1 文件系统界面 | OverlayFS + Docker bind mount | Agent 看到普通文件系统，bash 命令全兼容，完全无感知 |
| P2 并发访问 | OverlayFS Lower 共享 + Upper 隔离 | 读共享一份 Lower（零额外开销），写各自独立 Upper（无锁竞争） |
| P3 版本管理 | PG 版本链 + S3 不可变存储 | 每次合并创建新版本，旧版本永远可回溯 |
| P4 冲突解决 | Merge Daemon + 按文件类型选择算法 | 乐观并发写入 Upper；Merge 时按文件类型选算法（diff3 / CRDT / LWW / 审核队列） |
| P5 权限隔离 | PG 权限表 + Merge Daemon 执行 + Docker 挂载控制 | 每个 Agent 只挂载被允许的目录；非法写入在合并时被拒绝 |
| P6 资源效率 | OverlayFS COW（写时复制） | 1000 只读 Agent ≈ 1 份存储（~500MB）；写只存增量（~KB 级） |
| P7 可上云 | S3+PG 云端 + VM 上部署节点 | 存储在云端（S3+PG），计算节点可弹性伸缩（K8s Pod） |

---

## 十、核心技术选型总结

```
后端存储:    S3 + PG 混合存储
接口层:      OverlayFS (Linux 内核原生)
同步机制:    Sync Daemon (下行拉取) + Merge Daemon (上行合并+权限检查+冲突检测)
并发策略:    乐观并发（各自写 Upper，不阻塞）
冲突解决:    按文件类型组合多种算法：
             ├── 文本文件 → Git 三方合并 (diff3)
             ├── CRDT 标记文件 → CRDT 自动合并
             ├── 二进制文件 → Last-Writer-Wins / Agent 优先级
             ├── 关键文件 → 人工/AI 审核队列
             └── 预留扩展 → OT（未来实时协同场景）
隔离方案:    Docker 容器沙盒 (read-only root, cap-drop ALL, no-new-privileges)
通知机制:    PG LISTEN/NOTIFY + 按需拉取
```

---

## 十一、部署架构选项

### 方案 A：全本地部署

- S3 用 MinIO 本地部署，PG 本地安装
- 所有组件在同一台机器
- **适用**：开发测试、个人使用

### 方案 B：全云部署

- S3 (AWS/GCP/阿里云) + PG (RDS)
- Sync/Merge Daemon 和 Agent 容器都在 K8s Pod 中
- **适用**：多用户 SaaS 生产环境

### 方案 C：端云混合

- 云端：S3 + PG + Merge Daemon（全局冲突解决）
- 端侧：Lower 缓存 + Upper + Agent 容器 + 轻量 Sync Agent
- 端侧写入 → 上传 Upper diff → 云端 Merge → 云端更新 S3+PG → 端侧 Sync 拉新 Lower
- **适用**：Agent 需在用户本地运行，数据需云端管理

---


*本报告是从调研 OpenClaw 项目的文件访问机制出发，经过 Docker 隔离、文件系统原理、并发控制、数据库经验借鉴、OverlayFS 机制等多轮讨论后得出的完整技术方案。每一步的淘汰和选择都有明确的技术理由。*
