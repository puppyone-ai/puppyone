# PuppyOne 双向同步架构设计

> 涉及模块：backend/src/sync, cli/
> 最后更新：2026-02-23

---

## 1. 背景与问题

### 1.1 产品场景

PuppyOne 提供云端（Web UI）与用户本地文件夹之间的双向同步能力。用户在本地的 OpenClaw workspace 中编辑的文件可以同步到 PuppyOne 云端，反过来 Web UI 上的改动也可以同步到本地。

同步对象覆盖多种文件类型和规模：

- **小文件**：JSON、Markdown、YAML、TXT — 最常见场景，KB 级
- **大文件**：PDF、图片、视频 — 用户可能上传整个目录，单文件可达 GB 级
- **文件数量**：从几个到成千上万不等（用户可能同步整个本地知识库目录）

### 1.2 当前架构

```
本地 (CLI Daemon)                         云端 (PuppyOne Backend)
┌─────────────────────┐                  ┌──────────────────────────┐
│ chokidar 文件监听    │── push ────────▶│ /access/openclaw/push    │
│                     │                  │   ↓ CollaborationService │
│ 定时轮询 (30s)      │── pull ────────▶│ /access/openclaw/pull    │
│                     │◀── 全量返回 ────│   ↓ VersionService       │
└─────────────────────┘                  │   ↓ AuditService         │
                                         └──────────────────────────┘
```

CLI daemon 以 Node.js 进程运行在用户本地，通过 chokidar 监听文件变更（本地→云端），通过 30 秒定时轮询拉取云端变更（云端→本地）。

### 1.3 现存问题

**P0: 数据库风暴**

每 30 秒 Pull 一次，每次产生 `5 + N + M` 次 DB 查询（N = agent_bash 绑定数，M = sync 绑定数）。20 个文件 = 每 30 秒约 25 次查询。且每次返回所有文件的全部内容，即使没有任何变更。这是用户观察到"后端一直在请求数据库"的直接原因。

**P1: 无增量机制**

Pull 永远返回全量节点和全部内容。CLI 在本地逐个比较 version 后丢弃绝大部分数据。带宽和服务器资源浪费严重。

**P2: N+1 查询**

Pull 中对每个节点逐个调用 `get_by_id()`，而非批量获取。

**P3: 全表扫描**

查找 Agent 关联的 SyncSource 时，加载所有 openclaw 类型的连接记录到内存再过滤。随用户数增长为 O(N)。

**P4: 版本管理冗余**

Push 路径上存在三层版本检查（OpenClawService 手动检查 → CollaborationService 乐观锁 → VersionService 再检查）。且手动检查直接返回 409 错误，绕过了 CollaborationService 的三方合并能力——这意味着产品投入大量精力建设的冲突解决能力在同步场景下完全失效。

**P5: 删除不对称**

云端删除会同步到本地，但本地删除文件只清理本地 state，不推送到云端。

**P6: 其他**

- 前端 OpenClawSetupView 连接成功后永久停止轮询，daemon 崩溃后前端无感知
- Suppress 机制使用固定 2 秒超时，存在竞态窗口可能导致 ping-pong
- 每个 API 请求创建完整服务栈（多个 SupabaseClient + 所有 Repository + 所有 Service）

**P7: 架构缺陷 — ID 泄漏**

上述性能和协议问题之外，还存在一个更根本的架构问题：**daemon 承担了不该承担的 ID 管理职责。** 云端的内部概念（UUID node_id、parent_id、sync_source_id、bash_accesses 展开）被泄漏到了 CLI 层，导致 daemon 和后端的职责边界模糊，反复出现 parent_id 孤儿节点、重复节点、state.json 映射断裂等 bug。这是 §4 架构设计中重点解决的问题。

---

## 2. 业界参考

### 2.1 Dropbox — 同步协议的标杆

Dropbox 是文件同步领域最成熟的实现，其核心协议由三个组件构成：

**Server-side Change Log + Cursor**

服务端维护一个全局递增的变更序列（sequence）。每次文件创建、修改、删除都追加一条记录。客户端持有一个 cursor（本质是上次同步到的 seq 值）。调用 Delta API 时传入 cursor，服务端只返回该 cursor 之后发生的变更——不传 cursor 则视为首次同步，返回全量。

这个设计的关键洞察是：**同步协议不需要知道文件的全部历史，只需要知道"上次同步之后发生了什么"**。Cursor 是一个轻量的、可丢弃的状态标记，过期后客户端做一次全量同步即可恢复。

**Delta API（增量拉取）**

Delta 返回的不是文件内容，而是变更事件列表：有 metadata 表示创建/修改，metadata 为 null 表示删除。客户端处理完所有 delta entries 后，本地状态就和服务端一致了。响应中包含 `has_more` 标记，支持分页处理大量变更。

**Long Poll（低延迟通知）**

`/longpoll` 端点是 Dropbox 的核心创新之一。客户端发起请求后，服务端阻塞等待（最长约 120 秒）：有变更则立即返回 `{ changes: true }`，无变更则超时返回 `{ changes: false }`。客户端收到 `changes: true` 后才去调用 Delta API 获取实际数据。

**效果：无变更时 = 只维持一个挂起的 HTTP 连接，零 DB 查询，零数据传输。** 这和当前 PuppyOne 每 30 秒无条件全量查询形成鲜明对比。

此外 Dropbox 在传输层还做了块级同步（4MB chunks + SHA-256 hash）和 Broccoli 压缩协议（减少 30%+ 带宽），但这些是大规模优化，不是我们当前阶段需要关注的。

### 2.2 Notion — 处理分层与版本管理

Notion 的架构对我们有两个重要参考点：

**API Server vs Worker 的分层**

Notion 使用 Redis 任务队列处理异步工作，峰值每秒入队约 10,000 个任务。但关键点是**它们怎么划分同步和异步**：

- API Server 处理所有需要低延迟响应的操作：Block 级别的实时编辑、Page 元数据 CRUD、冲突检测
- Redis Worker 处理可以容忍延迟的重任务：import/export、offline page 后台同步、数据迁移

判断标准很简单：**用户（或客户端）是否在等待这个操作的结果？** 是 → API Server，否 → Worker。

**Page 级版本管理**

Notion 的版本管理是 Page 级别的——每个 Page 有自己的版本历史，用户可以查看历史、回滚到某个时间点。这个版本历史是**产品功能**，面向用户的。

而 Notion 的同步机制（offline mode，2025 年 12 月上线）用的是 CRDT 数据模型。CRDT 有自己的 operation log 来追踪变更和合并，这个 log 是**基础设施**，不面向用户。

两层是独立的：同步 log 可以清理、压缩，但 Page 版本历史永久保留。这和我们需要的 cursor（同步基础设施）+ version（产品功能）的分层完全一致。

### 2.3 Obsidian Sync — 最接近我们场景

Obsidian Sync 的场景和我们最相似：同步 Markdown/文本文件，文件数量中等，单向编辑为主。

它的关键设计：

- **两阶段 pull**：先拉文件元数据列表（name + hash + version），客户端本地比较后，只下载有变化的文件。避免了传输大量未变更的内容。
- **冲突策略可选**：keep-newer、keep-larger、manual。不同场景不同策略，没有一刀切。
- **版本历史独立**：版本历史是产品功能（用户付费特性），和同步传输机制解耦。

### 2.4 Remotely-Save（开源参考）

Remotely-Save 是 Obsidian 社区做的同步插件，支持 S3/WebDAV/Dropbox 等后端。它的同步算法（V3）值得参考：

- 维护三份状态快照：上次同步时的本地状态、当前本地状态、当前远端状态
- 三方比较决定每个文件的操作：push / pull / conflict / skip
- 增量传输：只传有变化的文件
- 冲突策略配置化：keep-newer / keep-larger / skip

### 2.5 共同规律

所有成熟的同步产品都遵循以下原则：

| 原则 | 说明 |
|------|------|
| **增量而非全量** | 只传输上次同步之后的变更 |
| **两层分离** | 同步传输机制（cursor/log，可清理）与版本历史（产品功能，永久保留）独立 |
| **元数据先行** | 先交换 hash/version 列表，再按需传内容 |
| **处理分层** | 需要即时响应的走 API Server，重计算走 Worker |
| **旁路传输** | 大文件不经过 API Server |

---

## 3. 技术选型

### 3.1 Cursor 与版本号的关系

**结论：两者都保留，解决不同问题。**

| | Cursor (sync_changelog) | 版本号 (current_version + file_versions) |
|--|------------------------|----------------------------------------|
| 解决什么问题 | "上次同步后哪些文件变了？" | "这个文件的历史是什么？能回滚吗？" |
| 粒度 | 项目级，全局递增 seq | 文件级，每文件独立递增 |
| 生命周期 | 临时日志，30 天后清理 | 永久保留，支持回滚 |
| 使用者 | 同步协议（CLI daemon） | 产品功能（Web UI 版本历史） |
| 存储内容 | 只记录"谁变了"（node_id + action） | 完整内容快照 |
| 类比 | Git reflog | Git commit history |

Cursor 过期后客户端做一次全量同步重建状态（和 Dropbox 的 reset 机制一致），版本历史不受影响。

### 3.2 Changelog 存储

**结论：独立 sync_changelog 表。**

| 选项 | 否决原因 |
|------|---------|
| 在 content_nodes 上加 sync_seq 字段 | 删除操作无法记录（行已删）；和业务字段混在一起，清理困难 |
| **独立 sync_changelog 表 ✅** | 能记录删除；可独立清理过期日志；语义清晰；和 Dropbox 的 change log 思路一致 |

每次 content_node 内容变更时追加一条记录（node_id + action + version + hash）。30 天定期清理。

### 3.3 Pull 协议

**结论：Cursor 驱动的增量 Pull。小文件直接带内容，大文件返回下载链接。**

参考 Dropbox 的 Delta API + Obsidian 的两阶段设计：

| 选项 | 否决原因 |
|------|---------|
| 全量 pull（现状） | 无变更也产生大量 DB 查询和数据传输 |
| 只拉元数据，再发第二个请求取内容 | 对小文件（JSON/MD）多一次 round trip，延迟翻倍 |
| **增量 pull + 小文件内嵌内容 ✅** | 一次 round trip 搞定小文件；大文件返回 presigned URL 旁路下载 |

工作方式：
- 客户端传 `cursor`（上次同步的 seq）
- 服务端只返回 changelog 中 seq > cursor 的变更节点
- cursor 为空 = 全量同步（首次连接）
- cursor 过期（对应 changelog 已清理）= 返回 reset 标记，客户端重新全量同步

### 3.4 变更通知

**结论：第一阶段 HTTP Long Poll，后续可演进到 SSE。**

这里直接参考 Dropbox 的 longpoll_delta 设计：

| 选项 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 定时轮询 30s（现状） | 最简单 | 无变更也查 DB；最高 30s 延迟 | **废弃** |
| **HTTP Long Poll ✅** | 无变更零查询；几乎实时；HTTP 原生兼容 | 多实例部署需 Redis Pub/Sub 中转 | **第一阶段** |
| SSE | 真正实时推送；服务端主动推 | 连接管理更复杂；需要事件分发基础设施 | **可选升级** |
| Supabase Realtime | 开箱即用 | 绑定 Supabase 基础设施；灵活性低；表结构变更受限 | **不采用** |

Long Poll 效果：客户端发起请求 → 服务端最长阻塞 90 秒等待 → 有变更立即返回，无变更超时返回。**平时无变更 = 零 DB 查询。** 进程内用 asyncio.Event 通知挂起的请求；如果后续部署多个 API 实例，Event 替换为 Redis Pub/Sub。

### 3.5 冲突解决

**结论：同步场景走轻量路径，Web UI 编辑保留完整 CollaborationService。**

| 场景 | 策略 | 原因 |
|------|------|------|
| CLI sync push | 乐观锁 → 冲突时交给 CollaborationService（三方合并 → LWW fallback） | 移除当前手动检查直接返回 409 的逻辑，让产品已有的合并能力真正生效 |
| Web UI 编辑 | 三方合并（CollaborationService 完整流程） | 产品核心壁垒，不变 |

当前最大的 bug 是 `_push_update()` 在调用 CollaborationService 之前就做了手动版本检查并直接返回 conflict 错误，导致三方合并永远不会触发。修复方式是移除手动检查，统一走 CollaborationService。

### 3.6 处理分层

**结论：按"客户端是否同步等待结果"来划分。参考 Notion 的分层思路。**

| 层级 | 放什么 | 为什么 |
|------|-------|-------|
| **API Server** | 同步协议（cursor/pull/longpoll）、小文件读写、冲突检测、changelog 写入 | CLI 需要同步等待结果才能更新本地 state |
| **S3 旁路** | 大文件上传/下载，API 只签发 presigned URL | 文件内容不经过 API Server，避免内存和带宽瓶颈 |
| **Worker (ARQ)** | PDF 解析、Embedding 生成、索引更新、缩略图、changelog 清理 | 重计算任务，可以容忍秒级～分钟级延迟 |

**关键原则**：同步协议绝对不放 Worker。CLI push 后必须立即拿到结果（新版本号/冲突信息），推到 queue 再轮询结果会引入不必要的延迟和复杂度。Notion 的 block 编辑也是 API Server 直接处理，只有 import/export 这类重任务才走 Worker。

### 3.7 大文件 vs 小文件

**结论：按类型 + 大小分流。**

| 路径 | 判定条件 | Push | Pull |
|------|---------|------|------|
| 小文件 | JSON/MD/YAML/TXT 且 < 256KB | 内容放 HTTP body | 内容内嵌 pull 响应 |
| 大文件 | PDF/图片/视频，或任何 > 256KB | API 签发 presigned URL → CLI 直传 S3 → 回调 confirm | pull 返回 download_url |

大文件上传完成后，API Server 入队 Worker 任务做后处理（PDF 解析、embedding 等）。这和现有的 ingest 管道完全一致。

### 3.8 删除同步

**结论：双向删除同步。**

当前本地删除不推送到云端是一个功能缺失。改为：

- 本地删除 → CLI 推送 delete action → 云端软删除 + changelog 记录
- 云端删除 → changelog 记录 → CLI pull 时收到 deletions → 本地备份后删除

### 3.9 N+1 查询与全表扫描

**结论：批量查询 + 精确查询。**

- Pull 中逐个 `get_by_id()` → 改为一条 `WHERE id IN (...)` 批量查询
- `_find_active_source()` 全表加载 + 内存过滤 → 改为 `WHERE config->>'agent_id' = ?` 精确查询

### 3.10 前端状态轮询

**结论：连接成功后降频但不停止。**

当前连接成功后永久停止轮询，daemon 崩溃后前端无感知。改为连接成功后降频（如 60 秒），断连后恢复高频（如 15 秒）。

### 3.11 Adapter 可扩展性

**结论：Cursor + Changelog 是通用同步底座，对端不限于本地文件夹。**

当前设计假定一端是 PuppyOne、另一端是本地文件夹。但实际上产品还有其他对端场景：沙盒容器（执行代码后回写结果）、N8N 等外部 workflow API、未来的 MCP client 等。

这套架构天然兼容这些场景，原因是：**Cursor 和 Changelog 完全是 PuppyOne 服务端内部的事情，不关心对端是什么。** Changelog 记录的是"PuppyOne 这边的 node X 在 seq=1234 发生了 update"——消费这条记录的可以是 CLI daemon，也可以是沙盒、webhook、或任何第三方。

不同对端只在 adapter 层有差异：

| 维度 | 本地文件夹 | 沙盒容器 | N8N / Webhook | MCP Client |
|------|----------|---------|--------------|------------|
| 变更检测 | chokidar 文件监听 | 不需要（一次性执行） | webhook 回调 | MCP resource subscribe |
| 通知机制 | long poll | 不需要 | PuppyOne 主动推 webhook | MCP 协议通知 |
| 认证方式 | X-Access-Key | 内部调用 | webhook secret / OAuth | MCP auth |
| 连接生命周期 | 长期（daemon 常驻） | 短暂（执行完销毁） | 按需（事件触发） | 会话级 |
| cursor 用法 | 持久保存，增量同步 | 每次 cursor=0 全量 | 持久保存，增量同步 | 持久保存，增量同步 |

**所有 adapter 共享的部分**（不需要重新实现）：

- sync_changelog + cursor 机制
- 文件级版本号 + 版本历史
- 冲突检测与解决
- 大小文件分流
- changelog 清理策略

**每个 adapter 独立实现的部分**：

- 对端变更检测方式
- 通知/推送机制
- 认证与鉴权
- 连接生命周期管理

这意味着未来增加新的同步对端时，只需要编写一个轻量的 adapter 层，同步底座全部复用。

---

## 4. 系统架构

### 4.1 四层架构

```
┌─────────────────────────────────────────────────────────────────┐
│                       本地文件系统                                │
│  身份 = 文件名     结构 = 扁平     "AGENTS.md" 就是 "AGENTS.md"   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ chokidar 监听 / 文件读写
┌──────────────────────────▼──────────────────────────────────────┐
│                       CLI Daemon                                │
│  只知道：文件名、内容 hash、版本号                                  │
│  不知道：UUID、parent_id、数据库结构                               │
│  职责：上报本地变更，执行后端指令，维护 cursor                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP (pull / push / changes)
                           │ 以 filename 为身份标识
┌──────────────────────────▼──────────────────────────────────────┐
│                     Backend SyncService                         │
│  接收 filename → 内部解析为 node_id                               │
│  按 (parent_id, name) 查找 → 自动判断 create / update            │
│  所有 ID 管理、层级管理、冲突解决集中在这一层                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ SQL
┌──────────────────────────▼──────────────────────────────────────┐
│                       Database                                  │
│  身份 = UUID     结构 = 树形 (parent_id)                         │
│  唯一约束: (project_id, parent_id, name) → 不可能重复              │
└─────────────────────────────────────────────────────────────────┘
```

核心设计原则（参考 Dropbox 客户端协议）：

> **Daemon 是一面无脑的镜子。它只知道文件名和内容，所有 ID 解析、层级管理、冲突处理由后端完成。**

云端的内部概念（UUID、parent_id、sync_source_id）绝不泄漏到 daemon 层。Daemon 发一个请求说"我有个叫 `foo.md` 的文件"，后端自己去数据库里查这个文件夹下有没有叫 `foo` 的节点——有就更新，没有就创建。

### 4.2 各层职责

#### Daemon（CLI 常驻进程）

| 做什么 | 不做什么 |
|--------|---------|
| 监听本地文件变更（chokidar） | 管理 UUID / node_id |
| 上报文件名 + 内容 + hash | 判断 create vs update |
| 执行后端指令（写文件、删文件） | 维护 filename ↔ node_id 映射 |
| 维护 cursor（增量同步位点） | 了解数据库结构 |
| 维护 state.json（纯本地缓存） | 管理 parent_id / sync_source_id |

Daemon 本地维护的 state.json 是**可丢弃的缓存**：只存文件名、版本号、内容 hash。丢失后用 cursor=0 做一次全量 pull 即可恢复，不会产生孤儿节点或重复数据。

#### Backend SyncService

所有复杂度集中在这一层：

- **Pull**：查 `content_nodes WHERE parent_id = folder_id`，按 cursor 增量返回
- **Push**：接收 `(folder_id, filename, content)`，按 `(parent_id, name)` 查找节点，存在则更新 / 不存在则创建
- **Delete**：按 `(parent_id, name)` 查找并软删除
- **Upload**：签发 S3 presigned URL，daemon 直传
- **Changes**：Long Poll，有变更时立即返回，无变更阻塞等待

Daemon 和后端之间只传**文件名**，不传 UUID。后端在内部完成 filename → node_id 的解析。

#### Database

依赖两个关键机制：
- **唯一约束** `(project_id, parent_id, name)`：从数据库层面杜绝重复节点
- **sync_changelog 表**：记录所有变更事件，支持 cursor 增量查询，30 天清理

### 4.3 同步协议

五个端点，全部以 `/sync/{folder_id}` 为前缀，以 filename 为身份标识：

| 端点 | 方向 | 用途 |
|------|------|------|
| `GET  /sync/{folder_id}/pull?cursor=N` | 云→本地 | 拉取变更。cursor=0 全量，cursor>0 增量。小文件内容内嵌，大文件返回下载链接 |
| `POST /sync/{folder_id}/push` | 本地→云 | 推送文件。Body 含 filename + content + base_version。后端自动判断 create/update |
| `DELETE /sync/{folder_id}/file/{filename}` | 本地→云 | 删除文件 |
| `POST /sync/{folder_id}/upload-url` | 本地→云 | 大文件上传。返回 S3 presigned URL，daemon 直传 |
| `GET  /sync/{folder_id}/changes?cursor=N` | 云→本地 | Long Poll 通知。有变更立即返回，无变更阻塞最长 30s |

Daemon 不需要区分 create 和 update——一个 push 端点处理所有情况。

### 4.4 增量同步机制

参考 Dropbox 的 Delta API + Long Poll 设计：

**Cursor 驱动的增量 Pull**

服务端维护 `sync_changelog` 表，记录每次文件创建/修改/删除事件。Daemon 持有一个 cursor（上次同步到的序列号）。Pull 时只返回 cursor 之后的变更。Cursor 过期（changelog 已清理）则自动 reset 全量同步。

**Long Poll 变更通知**

Daemon 发起 `/changes` 请求后，后端阻塞等待。有变更则立即返回，无变更超时返回空。**无变更时零 DB 查询、零数据传输。**

**Hash 校验**

Pull 返回的每个文件都带 content hash。Daemon 先比较 hash，相同则跳过，不同才下载/上传。

### 4.5 文件分流

| 类型 | 判定条件 | Push | Pull |
|------|---------|------|------|
| 小文件 | JSON / MD / YAML / TXT 且 < 256KB | 内容放 HTTP body | 内容内嵌 pull 响应 |
| 大文件 | PDF / 图片 / 视频，或任何 > 256KB | API 签发 presigned URL → daemon 直传 S3 | Pull 返回 download_url |

大文件不经过 API Server，避免内存和带宽瓶颈。

### 4.6 冲突解决

| 场景 | 策略 |
|------|------|
| 同步 push | 乐观锁（base_version 比较）→ 冲突时交给 CollaborationService 三方合并 |
| Web UI 编辑 | CollaborationService 完整流程（三方合并 → LWW fallback） |

冲突检测和解决全部在后端完成。Daemon 只需要在 push 时带上 base_version，后端返回成功或冲突信息。

### 4.7 CLI 命令设计

```
puppyone access up   --path <dir> --key <key>    # 连接 + reconcile + 启动 daemon
puppyone access down <dir>                        # 停止 daemon
puppyone access status <dir>                      # 查看同步状态
puppyone access logs <dir>                        # 查看 daemon 日志
```

`up` 命令的流程：
1. 连接后端，获取 folder_id
2. Reconcile：pull 全量 → 比较 hash → 推送差异
3. 后台启动 daemon（chokidar 监听 + long poll 循环）

### 4.8 Reconcile 逻辑

Reconcile 在 daemon 启动时执行一次，逻辑简洁：

1. **Pull 云端文件列表**（带 content + hash）
2. **对比**：云端有 / 本地有 → hash 相同则跳过，不同则按版本号决定方向
3. **处理云端删除**：本地备份后删除
4. **推送本地新文件**：本地有但云端没有 → push（后端自动创建）
5. **更新 cursor**

没有 UUID 匹配，没有文件夹展开逻辑，没有 create/update 分支判断。所有复杂度都在后端的 push 端点里。

### 4.9 数据一致性保证

| 机制 | 保证什么 |
|------|---------|
| DB 唯一约束 `(project_id, parent_id, name)` | 不可能创建重复节点 |
| 后端强制设 parent_id | 不可能产生孤儿节点 |
| Cursor 增量 | 不遗漏任何变更 |
| Hash 校验 | 内容一致性，即使 version 信息丢失也能自愈 |
| state.json 可丢弃 | 丢失后 cursor=0 全量 pull 重建，无副作用 |

### 4.10 Adapter 扩展

`/sync/{folder_id}` 是一个**通用的文件夹同步协议**。不同的调用方（CLI daemon、沙盒容器、N8N webhook、MCP client）共享同一组 API：

```
CLI Daemon  ──┐
              │
Sandbox     ──┼── /sync/{folder_id}/pull|push|changes ── SyncService ── DB
              │
N8N / MCP   ──┘
```

各 adapter 的差异只在调用方式：

| Adapter | 变更检测 | 通知机制 | 连接生命周期 |
|---------|---------|---------|------------|
| CLI Daemon | chokidar 文件监听 | Long Poll | 长期（daemon 常驻） |
| 沙盒容器 | 不需要（一次性执行） | 不需要 | 短暂（执行完销毁） |
| N8N / Webhook | Webhook 回调 | PuppyOne 主动推 | 按需（事件触发） |
| MCP Client | MCP resource subscribe | MCP 协议通知 | 会话级 |

同步协议本身（cursor、changelog、冲突解决、文件分流）全部复用，不需要每个 adapter 各自实现。
