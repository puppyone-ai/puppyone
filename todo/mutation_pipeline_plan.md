# Mut 协议

**Mutation Update Tracker**

一套为多 Agent + 人类混合协作设计的版本控制协议。

---

## 一、Mut 是什么

Mut 是 Git 的变种。它保留了 Git 最好的部分（快照、三路合并、完整历史），去掉了 Git 在 Agent 场景下最致命的缺陷——**冲突时停下来等人**。

Mut 的两个核心承诺：

1. **Commit 永远成功。** 没有 conflict，没有 merge failed，没有 please resolve。写入就是写入，永远不会被拒绝。
2. **用对的方式合并对的内容。** Markdown 按行合并，JSON 按路径合并，二进制直接覆盖。不像 Git 对所有文件都用行级 diff——那对 JSON 是灾难。

---

## 二、Mut vs 其他方案

### 2.1 为什么不直接用 Git

两个问题：

1. **冲突会阻塞**：Git 遇到冲突会停下来等人解决。Agent 不能停——一停整个自动化流程就断了。

2. **JSON 合并是坏的**：Git 用行级 diff 处理所有文件，包括 JSON。但 JSON 的逗号和缩进会导致大量假冲突——添加一个字段会改变上一行（加逗号），两个人各加一个不相干的字段就会被 Git 判定为冲突。Git 不理解 JSON 的结构，它只看到"两个人都改了第 5 行"。

### 2.2 为什么不用 OT（Operational Transformation）

OT 适合实时逐字符协作（Google Docs 式的光标跟随）。Mut 的场景是批量写入——Agent 一次提交一整段 Markdown 或一整个 JSON 对象，不是逐字符流式输入。

### 2.3 为什么不用 CRDT

CRDT 在"两方同时替换同一段内容"时会把两段内容都保留并拼接。数学上"无冲突"，语义上是乱的——没有人想要两段话拼在一起的结果。

### 2.4 Mut 的定位

| | Git | Google Docs (OT) | CRDT | **Mut** |
|---|---|---|---|---|
| 合并能力 | 三路合并 | 实时变换 | 自动收敛 | **三路合并** |
| 同位置冲突 | 停下来问人 | 后写覆盖 | 两段拼接 | **后写覆盖（LWW）** |
| 数据是否丢失 | 不丢（人选） | 丢先写的 | 不丢（但结果乱） | **丢先写的，但历史里有** |
| 是否阻塞 | 会 | 不会 | 不会 | **不会** |
| 适合批量写入 | 是 | 不适合 | 不适合 | **是** |

Google Docs 和 Notion 在"两人同时粘贴大段内容到同一位置"时也是 LWW。Mut 和它们行为一致。区别在于 Mut 有三路合并——改不同位置时零数据丢失，比纯 LWW 更好。


### 2.5 Mut 的核心设计

**1. 内容感知的冲突原子（Content-Aware Conflict Atom）**

Git 对所有文件类型都用同一个冲突原子——**行（line）**。这对代码很好，但对结构化数据有致命缺陷：JSON 加一个逗号就会让相邻行"变脏"，产生大量假冲突。

Mut 根据内容类型选择最合适的冲突原子：

| 内容类型 | 冲突原子 | 为什么 |
|---|---|---|
| **Markdown** | 行（line） | 文本天然按行组织，和 Git 一致 |
| **JSON** | 路径（JSON Path） | 结构化数据的最小语义单元是一个字段，不是一行文本 |
| **二进制文件** | 整个文件 | 无法拆分，没有更细的粒度 |

"两个人改了不同的东西"→ 自动合并。"两个人改了同一个东西"→ LWW。关键在于**"同一个东西"的定义因内容类型而异**。

**2. Commit 永远成功**

能合并就合并（三路合并），合并不了就 LWW，不犹豫，不停下来问人。

**3. 完整历史**

所有版本完整保留。被 LWW 覆盖的内容不是"丢了"，是"在历史里"。

---

## 三、架构：只有 commit()

Git 的启发：Git 里所有变更——改文件、新增文件、删除文件、重命名、移动——全部是一个操作：`git commit`。没有第二个入口。

Mut 一样。**系统中所有变更的唯一方式是 `commit(mutation)`。** 没有第二条写路径。

```
commit(mutation)
  │
  ├── 1. Apply — 执行变更（写数据库）
  │     ├── 内容变更：乐观锁 → 三路合并 → 写 preview_json / preview_md / s3_key
  │     ├── 创建节点：生成 id → 构建 id_path → 插入
  │     ├── 移动节点：更新 parent_id → 更新自身和后代的 id_path
  │     ├── 重命名：更新 name
  │     └── 删除节点：rename → 移入 .trash
  │
  ├── 2. Record — 记录发生了什么
  │     ├── 内容变更 / 创建 → 创建 version 快照
  │     ├── 移动 / 重命名 / 删除 → 不创建快照（内容没变）
  │     └── 所有类型 → 写 audit_log
  │
  └── 3. Hook — 触发副作用（post-commit hooks）
        ├── sync push（推送到外部系统）
        ├── cache invalidation（清 MCP 缓存）
        └── search reindex（更新向量索引）
```

没有 Pipeline。没有 EventBus。只有 commit() 和它内部的 hooks。Hooks 是 commit() 的一部分，不是独立系统。

| | Git | Mut |
|---|---|---|
| 写入入口 | 1 个（`git commit`） | 1 个（`commit(mutation)`） |
| 副作用机制 | post-commit hooks | post-commit hooks |
| 改内容 | `git commit` | `commit(CONTENT_UPDATE)` |
| 创建文件 | `git commit` | `commit(NODE_CREATE)` |
| 移动文件 | `git commit` | `commit(NODE_MOVE)` |
| 重命名 | `git commit` | `commit(NODE_RENAME)` |
| 删除文件 | `git commit` | `commit(NODE_DELETE)` |

### 3.1 Mutation

commit() 的输入。描述"要做什么"：

| 字段 | 说明 |
|---|---|
| `type` | 变更类型（见下） |
| `operator` | 谁发起的（user / agent / sync） |
| `node_id` | 目标内容节点 |
| `base_version` | 发起方上次读取时的版本号（仅 CONTENT_UPDATE 需要） |
| `content` | 新内容（仅 CONTENT_UPDATE / NODE_CREATE 需要） |

五种变更类型：

| 类型 | 说明 | Apply | Record |
|---|---|---|---|
| `CONTENT_UPDATE` | 修改内容 | 乐观锁 → 合并 → 写数据库 | version 快照 + audit_log |
| `NODE_CREATE` | 创建新节点 | 生成 id → 插入 | version 快照(v0) + audit_log |
| `NODE_DELETE` | 删除节点 | 移入 .trash | audit_log |
| `NODE_RENAME` | 重命名 | 更新 name | audit_log |
| `NODE_MOVE` | 移动位置 | 更新 parent_id + id_path | audit_log |

只有 `CONTENT_UPDATE` 涉及冲突解决。其余四种直接 Apply。

### 3.2 版本（Version）

每次 `CONTENT_UPDATE` 或 `NODE_CREATE` 成功后，系统创建一个不可变的版本快照。版本号单调递增。

版本快照记录：

- 版本号
- 完整内容（快照，不是 diff）
- 操作者
- 时间戳

### 3.3 Operator

标识变更的发起方：

| 类型 | 说明 |
|---|---|
| `user` | 人类通过 UI 操作 |
| `agent` | AI Agent 自动操作 |
| `sync` | 外部系统同步写入 |

---

## 四、冲突解决

### 4.1 总体流程

```
commit(base_version, incoming_content)
  │
  ├─ 读取 current_version（数据库最新版本）
  │
  ├─ if base_version == current_version
  │     → 没有并发写入，直接保存 incoming
  │
  ├─ if base_version < current_version
  │     → 有人在中间改过了，需要合并
  │     │
  │     ├─ 读取 base_content（base_version 的快照）
  │     ├─ 读取 current_content（current_version 的快照）
  │     ├─ 三路合并（base, current, incoming）
  │     │     → 合并成功 → 保存合并结果
  │     │     → 真冲突 → LWW，保存 incoming
  │     └─ 创建新版本快照
  │
  └─ 返回 CommitResult（永远成功）
```

### 4.2 三种冲突原子

Mut 的三路合并算法只有一套，但**冲突原子**（判定"是不是改了同一个东西"的最小单位）因内容类型而异：

| 内容类型 | 冲突原子 | 类比 | 判定冲突 |
|---|---|---|---|
| **Markdown** | 行（line） | Git diff3 | 同一行被两方改成不同值 |
| **JSON** | 路径（JSON Path） | Google Sheets 的格子 | 同一路径被两方改成不同值 |
| **二进制文件** | 整个文件 | 无法拆分 | 有两方同时改就是冲突 → 直接 LWW |

### 4.3 Markdown：行级三路合并

**输入**：base（base_version 快照）、current（最新版本）、incoming（本次写入）

**算法**：

1. 将三者按行拆分
2. 逐行比较：
   - 只有 current 改了该行 → 取 current
   - 只有 incoming 改了该行 → 取 incoming
   - 两方都改了，改成相同值 → 取该值（不算冲突）
   - 两方都改了，改成不同值 → **真冲突 → LWW，取 incoming**
   - 都没改 → 取 base

**示例——自动合并（改不同行）**：

```
base (v10):          current (v12):        incoming (基于 v10):
─────────────        ─────────────         ─────────────
Introduction         Introduction          Introduction
Uses gradient        Uses Adam             Uses gradient        ← B 改了这行
Accuracy 95%         Accuracy 95%          Accuracy 98%         ← A 改了这行
```

合并结果：

```
Introduction        ← 没人改
Uses Adam           ← 只有 B 改了，取 current
Accuracy 98%        ← 只有 A 改了，取 incoming
```

零冲突，零数据丢失。

**示例——真冲突（改同一行）**：

```
base:    Uses gradient descent
current: Uses Adam optimizer        ← B 改的
incoming: Uses SGD with momentum    ← A 改的
```

真冲突 → LWW → 结果：`Uses SGD with momentum`（incoming 赢）。B 的改动保留在 v12 的历史快照中。

### 4.4 JSON：路径级三路合并

**为什么不能对 JSON 用行级合并**：

JSON 的逗号和缩进会导致假冲突。例如添加一个字段会改变前一行（加逗号），但这不是内容变更。路径级合并完全消除了格式带来的假冲突。

**算法**：

1. 将三者解析为 JSON 对象
2. 递归遍历所有 JSON Path，对每个路径：
   - 只有 current 改了 → 取 current 的值
   - 只有 incoming 改了 → 取 incoming 的值
   - 两方都改了，改成相同值 → 取该值
   - 两方都改了，改成不同值 → **真冲突 → LWW，取 incoming**
   - 都没改 → 取 base 的值
3. 新增路径：直接保留
4. 删除路径：一方删了另一方没改 → 保持删除；一方删了另一方改了 → LWW，取 incoming 的决定
5. 重新组装 JSON

**示例**：

```
base:     { "theme": "dark", "language": "en" }
current:  { "theme": "dark", "language": "zh" }     ← B 改了 language
incoming: { "theme": "light", "language": "en" }     ← A 改了 theme
```

路径级合并：

```
/theme:    base=dark, current=dark, incoming=light → 只有 A 改了 → light
/language: base=en, current=zh, incoming=en        → 只有 B 改了 → zh
```

结果：`{ "theme": "light", "language": "zh" }`。零冲突。

如果用行级合并，这里可能因为 JSON 格式化差异而产生假冲突。

### 4.5 二进制文件

无法拆分为行或路径，无法做三路合并。

如果 `base_version < current_version` → 有并发写入 → 直接 LWW，取 incoming。

### 4.6 Commit 响应

```
CommitResult:
  version: int           新版本号
  content: Any           合并后的最终内容
  lww_applied: bool      是否发生了 LWW
  lww_details:           LWW 详情（可选）
    - Markdown: { lines: [2, 15] }        被 LWW 覆盖的行号
    - JSON: { paths: ["/language"] }      被 LWW 覆盖的路径
    - File: { message: "..." }
```

`lww_applied` 是一个**通知**，不是错误。调用方可以关心也可以忽略。commit 永远成功。

---

## 五、版本历史

### 5.1 作用

版本历史是理解"发生了什么"的唯一途径。内容本身（Markdown / JSON / 文件）不携带任何历史 metadata。

| 操作 | 类比 | 说明 |
|---|---|---|
| 列出历史版本 | `git log` → `mut log` | 版本号、操作者、时间、摘要 |
| 对比两个版本 | `git diff` → `mut diff` | 具体改动内容 |
| 查看每行/路径的最后修改者 | `git blame` → `mut blame` | 谁最后改了这一行/这个字段 |
| 获取历史版本内容 | `git checkout` → `mut checkout` | 回溯到任意历史状态 |

### 5.2 和 LWW 的关系

LWW 覆盖的内容不是"丢了"——它保留在被覆盖之前那个版本的快照中。

```
v10: base content            ← 原始内容
v12: Agent B 的改动           ← B 先写的
v13: Agent A 的改动（LWW 覆盖了 B 在同一位置的改动）

Agent 想知道发生了什么 → mut diff v12 v13 → 看到 B 的改动被覆盖了
Agent 想恢复 B 的内容 → mut checkout v12 → 重新 mut commit
```

这和人在 Google Docs 里打开 Version History 看到"自己的粘贴被别人覆盖了"然后决定是否重新粘贴，是完全一样的流程。

---

## 六、Hooks

Hooks 是 commit() 的第三步（Apply → Record → **Hook**）。不是独立系统。

和 Git 的 post-commit hooks 完全一样：commit 已经完成了（Apply + Record 成功），然后触发注册的 hooks 做副作用。Hooks 失败不影响 commit 结果——因为 commit 已经成功了。

```
commit(mutation)
  ① Apply  — 写入数据库 ✓
  ② Record — 版本快照 + 审计日志 ✓
  ③ Hook   — 逐个调用注册的 hooks
      → sync push（推送到外部系统）
      → cache invalidation（清 MCP 缓存）
      → search reindex（更新向量索引）
      → hook 失败？记日志，不影响 commit 结果
```

---

## 七、总结

| 原则 | 说明 |
|---|---|
| commit 永远成功 | 没有失败路径，没有阻塞，没有重试 |
| 能合并就合并 | 不同位置的改动自动合并，零数据丢失 |
| 合并不了就 LWW | 同一位置的改动，后写的赢 |
| 历史里什么都有 | 被覆盖的内容保留在版本快照中，可追溯可恢复 |
| 粒度匹配内容类型 | Markdown 按行，JSON 按路径，二进制按整体 |
| 内容不含 metadata | 所有历史信息通过版本系统 API 提供，内容本身始终干净 |

---

## 八、实施：现状分析与改动清单

### 8.1 实施状态：✅ 已完成

所有 Phase 均已实施完成。以下是最终状态：

| Phase | 状态 | 修改的文件 |
|---|---|---|
| Phase 1：冲突解决引擎 | ✅ | `conflict_service.py`, `schemas.py` |
| Phase 2：Mutation 类型 + commit() 5 种操作 | ✅ | `schemas.py`, `service.py`, `dependencies.py` |
| Phase 3：统一所有写路径 | ✅ | 见下表 |
| Phase 4：Hooks 机制 + 清理 | ✅ | `service.py`（hooks 机制就绪） |

### 8.2 已迁移的写路径

| 调用方 | 变更 |
|---|---|
| `collaboration/router.py` — UI commit | `Mutation(CONTENT_UPDATE)` → `commit()` |
| `content_node/router.py` — 前端 CRUD | create/update/move/delete 全部通过 `commit()` |
| `internal/router.py` — MCP 写入 | 全部 6 个写端点通过 `commit()` |
| `sync/service.py` — Sync 拉取 | `Mutation(CONTENT_UPDATE)` → `commit()` |
| `sync/service.py` — _ensure_node_exists | `Mutation(NODE_CREATE)` → `commit()` |
| `sync/folder_sync.py` — _do_create | `Mutation(NODE_CREATE)` → `commit()` |
| `sync/folder_sync.py` — _do_update | `Mutation(CONTENT_UPDATE)` → `commit()` |
| `sync/folder_sync.py` — delete_file | `Mutation(NODE_DELETE)` → `commit()` |
| `sync/folder_sync.py` — _ensure_folder_path | `Mutation(NODE_CREATE)` → `commit()` |
| `agent/service.py` — stream_events 写回 | `Mutation(CONTENT_UPDATE)` → `commit()` |
| `agent/service.py` — execute_task_sync 写回 | `Mutation(CONTENT_UPDATE)` → `commit()` |

### 8.3 核心数据类型

```python
class MutationType(str, Enum):
    CONTENT_UPDATE = "content_update"
    NODE_CREATE = "node_create"
    NODE_DELETE = "node_delete"
    NODE_RENAME = "node_rename"
    NODE_MOVE = "node_move"

class Operator(BaseModel):
    type: str       # "user" | "agent" | "sync" | "mcp_agent"
    id: str
    session_id: Optional[str]
    summary: Optional[str]

class Mutation(BaseModel):
    type: MutationType
    operator: Operator
    node_id: Optional[str]
    project_id: Optional[str]
    content: Optional[Any]
    node_type: str = "json"
    base_version: int = 0
    base_content: Optional[str]
    parent_id: Optional[str]
    name: Optional[str]
    new_name: Optional[str]
    new_parent_id: Optional[str]
```

### 8.4 commit() 内部流程

```python
async def commit(mutation: Mutation) -> CommitResult:
    # 1. Apply — 根据 type 分发
    if CONTENT_UPDATE:  乐观锁 → 三路合并 → 写 DB
    if NODE_CREATE:     ContentNodeService.create_* → 版本快照
    if NODE_DELETE:     ContentNodeService.soft_delete → 移入 .trash
    if NODE_RENAME:     ContentNodeService.update_node(name=...)
    if NODE_MOVE:       ContentNodeService.move_node(...)

    # 2. Record — 版本快照 + 审计日志

    # 3. Hook — post-commit hooks（异步，失败不影响结果）

    return CommitResult(...)  # 永远成功
```

### 8.5 Hooks 现状

Hooks 注册机制已就绪（`CollaborationService.register_hook()`），目前 sync push 仍通过 `background_tasks` 在 router 层触发，未来可迁移为 hook。

待实现的 hooks：
- `SyncPushHook` — 推送到外部系统
- `CacheInvalidateHook` — 清 MCP 缓存
- `SearchReindexHook` — 更新向量索引
