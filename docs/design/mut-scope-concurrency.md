# MUT Scope 并发控制设计方案

> 状态：Draft — 待团队讨论  
> 日期：2026-04-14  
> 更新：2026-04-17（commit_id 身份迁移）

---

## 零、身份模型：从 version (int) 到 commit_id (16-hex)

> 2026-04-17 的一次性迁移把 MUT 所有**版本身份字段**从单调递增的
> `version INT` 换成哈希型 `commit_id TEXT`。产品逻辑不变（当前依旧是线性
> 提交），但下面的文档仍大量使用"version"二字做为概念占位，请按以下映射
> 对照阅读：

| 旧（version 语义） | 新（commit_id 语义） | 说明 |
|-----|-----|-----|
| `projects.mut_version (INT)` | **已删除** | 全局递增版本号不再存在；读 HEAD 请从 `mut_scope_state.head_commit_id` 取 |
| `mut_commits.version (INT)` | `mut_commits.commit_id (TEXT, 16-hex)` | 16 个 hex 字符，足以支撑百万级 commit 无碰撞 |
| `mut_scope_state.version (INT)` | `mut_scope_state.head_commit_id (TEXT)` | scope 视角下当前的 HEAD |
| `audit_logs.old_version / new_version` | **已删除** | commit 身份写进 `metadata` JSONB |
| `sync_state.last_sync_version (INT)` | `sync_state.last_sync_commit_id (TEXT)` | 同步侧的"最近一次对账点" |
| `atomic_next_version()` RPC | **已删除** | 不再有原子递增；`commit_id = hash(scope_path, scope_hash, ts_microseconds, who)` |
| `cas_update_scope_state(..., p_new_hash)` | `cas_update_scope_state(..., p_new_hash, p_head_commit_id)` | 同一次 `UPDATE` 同时提交 scope_hash 和 head_commit_id，避免"CAS 赢家的 head 被输家覆盖" |

**commit_id 的生成**（`mut/server/history.py :: HistoryManager._compute_commit_id`）：

```
commit_id = sha256(
  scope_path || '\x00' ||
  scope_hash || '\x00' ||
  created_at_iso (microseconds) || '\x00' ||
  who
)[:16]
```

- 16 个 hex 字符（64 bit）抗碰撞上限 ≈ 2^32 条 commit，远超 PuppyOne 实际规模
- `created_at_iso` 服务端统一采用**微秒精度**（避免同一 scope 在同一秒内连发提交时产生碰撞）
- 当前实现无 `parent_commit_id`（线性提交），未来开 DAG 时在 commit_id 输入中加入 parents 即可

**向后兼容策略**：无。这是一次"最终态"迁移，旧环境里的 mut 数据通过
`20260418000000_mut_commit_id_identity.sql` 一次性 `TRUNCATE` 并重建索引。

---

## 一、背景

PuppyOne 的每个项目是一棵文件树。多个 Access Point（AP）通过 scope 机制划分各自的读写范围。
当多个 AP 并发写入同一项目时，需要保证：

- **不丢数据**：两个人改了不同文件，两边的改动都要保留
- **可见性**：子 scope 的改动，父 scope 能看到
- **高并发**：不相关的写入不应该互相阻塞

---

## 二、并发场景

下面列举所有可能的并发组合。先看完整张表，再总结规律。

### 场景列表

**同一 scope，同一 AP**

同一个客户端快速连续 push。实际中 CLI 是同步的，通常会等上一次完成再发下一次，
所以这更多是边界情况。但如果真的并发了，规则和下面一样。

| # | 场景 | 示例 | 期望行为 |
|---|------|------|---------|
| S1 | 改不同文件 | 第一次改 `a.md`，第二次改 `b.md` | 并行，两边改动都保留 |
| S2 | 改同一文件 | 两次都改 `readme.md` | 三方合并，冲突由服务端解决 |

**同一 scope，不同 AP**

两个 AP 都绑定了 `docs/` scope。

| # | 场景 | 示例 | 期望行为 |
|---|------|------|---------|
| S3 | 改不同文件 | AP-A 改 `docs/a.md`，AP-B 改 `docs/b.md` | 并行，两边改动都保留 |
| S4 | 改同一文件 | AP-A 和 AP-B 都改 `docs/readme.md` | 三方合并，冲突由服务端解决 |

**不同 scope，无嵌套**

AP-A 绑定 `docs/`，AP-B 绑定 `src/`，两个 scope 没有重叠。

| # | 场景 | 示例 | 期望行为 |
|---|------|------|---------|
| S5 | 各自 push | AP-A 改 `docs/a.md`，AP-B 改 `src/main.py` | 完全并行，互不影响 |

**不同 scope，有嵌套（父子）**

AP-A 绑定 root scope（`""`，覆盖整棵树），AP-B 绑定 `docs/`。
root scope 的写入范围包含了 `docs/` 的全部文件。

| # | 场景 | 示例 | 期望行为 |
|---|------|------|---------|
| S6 | 改不同文件 | AP-A 改 `config.json`，AP-B 改 `docs/readme.md` | 并行，两边改动都保留 |
| S7 | 改同一文件 | AP-A 改 `docs/readme.md`，AP-B 也改 `docs/readme.md` | 三方合并，冲突由服务端解决 |

**读取可见性**

| # | 场景 | 示例 | 期望行为 |
|---|------|------|---------|
| S8 | 子 scope 写入后，父 scope 读取 | `docs/` push 了新文件，root scope clone | 父 scope 必须能看到子 scope 的改动 |
| S9 | 父 scope 写入后，子 scope 读取 | root scope push 了 `docs/new.md`，`docs/` scope clone | 子 scope 必须能看到父 scope 在自己范围内的改动 |

### 规律总结

把上面 9 个场景放在一起看：

| 场景 | scope 关系 | 改的文件 | 期望行为 |
|------|-----------|---------|---------|
| **S1** | **同 scope 同 AP** | **不同文件** | **并行，都保留** |
| S2 | 同 scope 同 AP | 同一文件 | 三方合并 |
| **S3** | **同 scope 不同 AP** | **不同文件** | **并行，都保留** |
| S4 | 同 scope 不同 AP | 同一文件 | 三方合并 |
| **S5** | **不同 scope 无嵌套** | **不同文件** | **并行，互不影响** |
| **S6** | **嵌套 scope** | **不同文件** | **并行，都保留** |
| S7 | 嵌套 scope | 同一文件 | 三方合并 |
| S8 | 嵌套（子写父读） | — | 父 scope 可见 |
| S9 | 嵌套（父写子读） | — | 子 scope 可见 |

**结论：决定并发行为的唯一标准是"改没改同一个文件"。**

- S1、S3、S6 的 scope 关系完全不同（同 AP / 同 scope 不同 AP / 嵌套 scope），但期望行为一样 — 因为都是改不同文件
- S2、S4、S7 也是 scope 关系不同，但期望行为一样 — 因为都是改同一文件
- Scope 关系（同/异/嵌套）、AP 关系（同/异）都不影响并发行为，唯一的变量是文件

---

## 三、理想架构

### 3.1 单一项目树 + 双 hash 模型

整个项目维护一棵全局的 Merkle 文件树：

```
Project Root (root_hash)
├── docs/
│   ├── readme.md
│   └── guide.md
├── src/
│   └── main.py
└── config.json
```

- **一棵树，多个视图**：每个 scope 只是这棵全局树的某个子树，不是独立的孤岛
- **子 scope 写入自动嫁接回全局树**：`docs/` scope push 后，全局树自动更新，
  root scope 能看到 `docs/` 下的新文件

**双 hash 模型**：

| hash | 用途 | 存储位置 |
|------|------|---------|
| `scope_hash` | CAS 比较 — 检测同 scope 并发 push；与 `head_commit_id` 一起被单条 UPDATE 原子提交 | `mut_scope_state` 表，每个 scope 一行 |
| `root_hash` | 全局文件树 — 所有读操作的数据源 | `projects.mut_root_hash` |
| `head_commit_id` | scope 视角下"当前指向哪个 commit" | `mut_scope_state.head_commit_id`（**不**在 `projects` 表冗余） |

- **所有读操作从 `root_hash` 出发**：`list_scope_files`、`tree_reader` 都从全局树导航到子树
- **`scope_hash` 仅用于 CAS**：push 时检查"上次我读的时候这个 scope 的 hash 是不是还没变"
- 两者可以不同：嫁接后 `root_hash` 包含了所有 scope 的改动，而 `scope_hash` 只反映单个 scope 的最后一次 push

### 3.2 乐观并发（CAS + 自动重试）

写入流程：

```
1. 读取当前 scope_hash 和 server 文件（从 root_hash 导航）
2. 计算合并结果（server 端，不持锁）
3. 提交：检查"scope_hash 是否还是我读的时候那个"
   - 是 → 写入成功
   - 否 → 说明有人在我之前提交了
         → 重新读取最新状态
         → 基于最新状态重新合并（三方合并自动保留不同文件的改动）
         → 再次尝试提交
```

**为什么选乐观并发，不选悲观锁？**

悲观锁（先抢锁，再写入）的问题：scope 粒度太粗。
如果 root scope 存在，它和所有子 scope 重叠，所有写入都要排队等 root scope 的锁。
**一个 root scope 的存在就会把整个项目的写入并发降到 1。**

乐观并发不加锁，大家并行计算合并，只有最后一步提交时才检查冲突。
改不同文件的 push 几乎永远不会真正冲突，重试一次就成功。

**CAS 的最后提交步骤是否也是串行的？**

是的，CAS 的"比较并写入"步骤本身是串行的 — 但它靠数据库行级锁保证原子性，
只持有**几毫秒**（一次 SQL UPDATE），不是几秒：

```sql
UPDATE mut_scope_state
SET scope_hash = 'new_hash'
WHERE project_id = 'xxx'
  AND scope_path = 'docs/'
  AND scope_hash = 'old_hash'    -- CAS：只有 hash 没变才写入
-- affected rows = 1 → 成功，后续单独更新版本号
-- affected rows = 0 → 失败，触发重试
```

两个 push 同时执行这条 SQL 时，PostgreSQL 自动用行级锁串行化。
先到的成功，后到的失败并重试。

> **实现要点（2026-04-17）**：PuppyOne 的 `cas_update_scope_state` RPC 把
> `scope_hash` 和 `head_commit_id` 放进**同一条 UPDATE**提交：
>
> ```sql
> UPDATE mut_scope_state
> SET scope_hash = p_new_hash,
>     head_commit_id = p_head_commit_id,
>     updated_at = NOW()
> WHERE project_id = p_project_id
>   AND scope_path = p_scope_path
>   AND (scope_hash = p_old_hash OR (scope_hash IS NULL AND p_old_hash = ''));
> ```
>
> 这避免了"CAS 赢家把 scope_hash 写进去后，输家随后又把自己的 head_commit_id
> 盖上去"的竞争；两个字段要么一起成功，要么一起失败。

对比：

| | 串行范围 | 串行耗时 |
|---|---------|---------|
| 悲观锁 | 读文件 + 三方合并 + 写入 + 嫁接 + 版本号 | **几秒** |
| 乐观并发 | 只有最后的 CAS UPDATE | **几毫秒** |

乐观并发不是消除串行，而是把串行范围从整个 push（几秒）缩小到一次数据库原子操作（几毫秒）。
耗时的部分（读文件、计算合并）完全并行。

**极端并发下的瓶颈**

CAS 的吞吐上限约 200-500 次/秒（单行 UPDATE，取决于 DB 性能）。
如果同一个 scope 有上千并发 push：
- 几乎所有 CAS 都会首次失败
- 每次失败都要重新读 + 重新合并 + 再次 CAS → 重试风暴
- 吞吐急剧下降

但需要区分两种情况：

| 并发类型 | CAS 瓶颈？ | 原因 |
|---------|-----------|------|
| 1 万个 push 打到 1000 个不同 scope | **无** | 不同 scope 是不同 DB 行，天然并行 |
| 1000 个 push 打到同一 scope | **有** | 同一行反复 CAS 竞争 + 重试风暴 |

对于 PuppyOne 的场景（文件系统 + 多 Agent 协作），同一 scope 下几十个并发已是极端情况。
CAS 方案在这个量级完全够用。

如果未来需要支持同一 scope 的极端并发（几百+），可选方案：

- **写入队列**：同一 scope 的 push 排队，由 server 顺序处理，消除重试风暴
- **批量合并**：server 把短时间内到达的多个 push 合并成一次写入
- **分区（sharding）**：将大 scope 自动拆分为子 scope，分散写入压力

这些属于远期优化，当前阶段无需考虑。

**嵌套 scope 下的嫁接（graft）**

前面说"不同 scope 是不同 DB 行，天然并行"。但子 scope push 成功后，
还需要把自己的新 hash 嫁接到全局树（root_hash）上 — 这步要 CAS 更新 root_hash。

```
数据库行:
  projects 表: (project_id, mut_root_hash=...) ← 全局树
  mut_scope_state: (project_id, scope_path='docs/', scope_hash=...) ← docs CAS 行
  mut_scope_state: (project_id, scope_path='src/',  scope_hash=...) ← src CAS 行
```

```
docs/ push:  CAS 更新 docs/ 行 ──→ 嫁接: CAS 更新 root_hash
src/  push:  CAS 更新 src/  行 ──→ 嫁接: CAS 更新 root_hash
                                          ↑
                                    所有子 scope 的嫁接
                                    都要 CAS root_hash！
```

如果 root 下有 100 个子 scope 同时 push，它们各自的 scope CAS 互不影响（不同行），
但嫁接步骤都要 CAS root_hash → root_hash 变成热点 → 嫁接串行化。

**解法：把 push 和嫁接拆成两步**

| 步骤 | 操作 | CAS 目标 | 阻塞谁 |
|------|------|---------|--------|
| ① scope 提交 | CAS 更新自己的 scope_hash | 自己的行 | 只和同 scope 的其他 push 竞争 |
| ② 嫁接到全局树 | CAS 更新 root_hash | projects 表 | 和兄弟 scope 的嫁接竞争 |

**步骤 ① 成功后立刻返回给 client**（数据已安全持久化）。
**步骤 ② 同步完成**（在返回 HTTP 响应前执行，通常几毫秒内完成）。

> 当前实现：嫁接在 `run_post_push_hook` 中同步执行。
> 因为嫁接只涉及树操作 + 一次 CAS DB 调用（~1-2ms），对 client 延迟影响极小。
> 未来可改为真正异步（`asyncio.create_task`），但需要权衡复杂度。

**嫁接不是盲替换，而是有冲突检测的合并**

嫁接时，scope 的新子树是基于 push 开始时的 root_hash 构建的。但在 push 执行期间，
其他 scope（包括父 scope）可能已经修改了同一子树路径下的文件。

如果嫁接只是简单地"把新子树替换进全局树"，就会丢失其他 scope 在嫁接期间做的改动。

正确的嫁接流程：

```
异步嫁接:
1. 读当前 root_hash → 提取 scope 子树 hash = current_subtree_hash
2. 比较 current_subtree_hash 和 push 前的 old_scope_hash:
   a. 相等 → 无人改过 → 安全替换（快速路径，绝大多数情况）
   b. 不等 → 有人在 push 期间改了这个子树的文件
            → 三方合并: base=old_scope_hash, ours=current_subtree_hash, theirs=new_scope_hash
            → 嫁接合并结果
3. 构建新 root
4. CAS: UPDATE projects SET mut_root_hash = new_root WHERE mut_root_hash = old_root
   → 失败则重试（回到步骤 1）
```

- **非重叠 scope**（docs/ 和 src/）：永远走快速路径（步骤 2a），因为不同 scope 不会修改同一子树
- **重叠 scope**（root 改了 docs/ 下的文件，docs/ scope 也在 push）：走合并路径（步骤 2b），确保两边改动都保留

这样：
- 嫁接虽然串行，但快速路径只是树操作（无文件 I/O），每次 ~1-2ms
- 当前同步实现：嫁接时间包含在 push 响应中，但因为极快，client 几乎无感知
- 父 scope 在 push 返回后立刻可见子 scope 的改动（强一致）

当前实现（同步嫁接）是**全面强一致**的模型：

| 保证 | 一致性级别 | 说明 |
|------|-----------|------|
| 子 scope 的数据不丢 | **强一致** | CAS 成功才返回 client |
| 父 scope 看到子 scope 改动 | **强一致** | 嫁接在返回前同步完成 |
| 同 scope 的并发合并 | **强一致** | CAS + 三方合并 |

> 如果未来改为异步嫁接，"父 scope 可见性"会降级为最终一致（毫秒级延迟）。

**Root scope 的特殊性**

Root scope（scope_path=""）覆盖整棵树。它的 scope_hash 在概念上等于 root_hash，
但实现上保持分离：

- Root scope push 时，CAS 检查 scope_hash("") 行 — 和其他 scope 一样
- Root scope push 成功后，嫁接步骤 = 直接 CAS 更新 root_hash（因为 scope_path="" 就是根）
- Root scope 和子 scope 并发 push：CAS 在不同行，互不阻塞；嫁接时通过合并路径处理重叠

### 3.3 Server 端完整流程（举例）

用一个具体例子说明 CAS 在 server 端实际发生了什么，以及 client 看到什么。

**场景**：Client A 改了 `a.md`，Client B 改了 `b.md`，同一 scope 同时 push。

```
初始状态：scope_hash=X, root_hash=R0

Client A push (base=v5, 改了 a.md)
Client B push (base=v5, 改了 b.md)
                                        ┌─ Server 处理 ─┐
                                        │                │
Push A 到达 ─────────────────────────── ▶ 读 scope_hash=X
                                        │ 从 root_hash 读 server 文件
                                        │ 三方合并（无冲突）
                                        │ CAS: scope_hash==X? ✅
                                        │ → 写入 scope_hash=A, version++
                                        │ → 返回 Client A: 成功, v6
                                        │ → 异步嫁接到 root_hash
                                        │
Push B 到达 ─────────────────────────── ▶ 读 scope_hash=X
                                        │ 从 root_hash 读 server 文件
                                        │ 三方合并（无冲突）
                                        │ CAS: scope_hash==X? ❌（已变成 A）
                                        │
                                        │ → 自动重试：
                                        │   读 scope_hash=A
                                        │   从 root_hash 读最新 server 文件
                                        │   三方合并: base=v5, server=最新, client=B
                                        │   合并结果: a.md(A的) + b.md(B的) 都保留
                                        │   CAS: scope_hash==A? ✅
                                        │   → 写入 scope_hash=B', version++
                                        │   → 返回 Client B: 成功, v7
                                        │   → 异步嫁接到 root_hash
                                        └─────────────────┘
```

**关键：CAS 重试完全在 server 端发生，client 无感知。** Client B 只发了一次 push 请求，等到响应"成功, v7"。

### 3.4 Client 端版本一致性

CAS 解决了 server 端的数据安全，但带来了一个新问题：**push 成功后，client 的本地状态可能和 server 不一致。**

接上面的例子：

| | Client A | Client B | Server |
|---|----------|----------|--------|
| push 前 | v5 + a.md 改动 | v5 + b.md 改动 | v5 |
| push 后 | v6（本地只有 a.md 改动） | v7（本地只有 b.md 改动） | v7（a.md + b.md 都有） |

- **Client A**：认为自己在 v6，但 server 已经到 v7 了。本地缺 B 的 `b.md` 改动。
- **Client B**：认为自己在 v7，但本地缺 A 的 `a.md` 改动 — 虽然 server 的 v7 包含 `a.md`。

如果 Client B 下次 pull（base=v7），server 说"v7 之后没有新变化" — 但 Client B 本地其实缺了 `a.md`！

**解决方案**：push 响应中返回合并变更清单（merged changeset）。

```
Push 响应:
{
  "version": 7,
  "merged_changes": [        ← server 合并时额外引入的改动
    { "path": "a.md", "action": "merged_from_server" }
  ]
}
```

`action` 类型：
- `merged_from_server`：server 上存在但 client 未推送的文件（其他 AP 的改动）
- `content_merged`：双方都改了同一文件，结果是三方合并版

Client 收到响应后：
1. 更新本地 `base_commit_id` 到新的 commit 哈希
2. 如果 `merged_changes` 非空 → 执行一次 pull 拉取合并后的文件内容

> 当前实现只返回路径和 action，不含文件内容。
> 未来优化：可在 `merged_changes` 中内嵌 base64 内容，让 client 免去额外 pull。

这样 Client B 知道哪些文件需要同步，一次 pull 后即可拥有完整的 v7 状态。

Client A 则仍停在 v6（push 时没有其他人的改动需要合并，merged_changes 为空）。
A 下次 pull 时会正常拉到 v7 的变更（B 的 `b.md`）。这是预期行为，和 Git 一致。

### 3.5 合并策略

| 情况 | 处理方式 | 结果 |
|------|---------|------|
| A 改了 `a.md`，B 改了 `b.md` | 三方合并 | 两边都保留 |
| A 和 B 都改了 `readme.md` | 三方合并 + 服务端冲突解决 | 冲突部分的处理策略可配置（如 LWW、拒绝、标记冲突等） |
| A 删了 `old.md`，B 改了 `new.md` | 三方合并 | 删除和新改动都保留 |

### 3.6 各场景的理想行为

| 场景 | 并发行为 | 结果 | 等待时间 |
|------|---------|------|---------|
| S1/S3/S6: 改不同文件 | **并行** | 两边改动都保留 | ≈ 0 |
| S2/S4/S7: 改同一文件 | 并行计算 + 自动重试 | 服务端冲突解决 | ≈ 0（重试一次） |
| S5: 不相关 scope | **完全并行** | 各自独立 | 0 |
| S8/S9: 读取可见性 | 无需等待 | 嫁接保证可见 | 0（同步嫁接，push 返回即可见） |

**核心指标**：不相关的写入（改不同文件、不同 scope）零等待。
Root scope 的存在不影响任何人的写入并发。
Push 涉及合并时，响应中返回 merged_changes 清单，client 据此 pull 即可同步。

> 注意：上述 "v5/v6/v7" 只是为便于讲解并发时序的**标号**，并不代表底层
> 仍然是递增 int；实际存储和返回值都是 16-hex `commit_id`。

---

## 四、当前实现 vs 理想架构

下面逐一对比第三章的每个理想设计点，说明当前实现的差距、会在什么场景下出问题、以及后果是什么。

当前并发控制**基本不工作**。实际使用中没出问题是因为 push 操作很少真正并发。
一旦多个 Agent 并发写入同一项目，以下问题都会暴露。

### 4.1 对比 3.1 双 hash 模型

**理想**：`scope_hash` 仅用于 CAS 检测同 scope 并发，所有读操作从 `root_hash` 导航到子树。

**现状**：

- 更新 scope hash 时**无条件覆盖**（upsert） — 不检查中间有没有人改过
- `list_scope_files` 优先读 `scope_hash`，不读 `root_hash` — 看不到其他 scope 的改动
- `tree_reader`（前端浏览用）读 `root_hash`，但 `handle_push` 读 `scope_hash` — 两者数据源不一致

**后果**：

| 场景 | 会发生什么 |
|------|----------|
| S1/S3: 同 scope 两个 push 改不同文件 | A 的改动被 B 的覆盖，`a.md` 的变更丢失 |
| S2/S4: 同 scope 两个 push 改同一文件 | 没有三方合并，后写直接覆盖先写 |
| S8: 子 scope push 后，父 scope 读取 | `list_scope_files` 读自己的 scope_hash，看不到子 scope 改动 |
| S9: 父 scope push 后，子 scope 读取 | 子 scope 读自己的 scope_hash，看不到父 scope 改动 |

### 4.2 对比 3.2 乐观并发

**理想**：不加长锁，并行计算合并，最后 CAS 提交，失败自动重试。

**现状**：用的是悲观锁，但锁有三个问题导致**完全无效**：

**问题 A：每个请求的锁是独立的**

每次 push 请求都创建一个全新的 ServerRepo 实例（`get_server_repo()` 每次 `return PuppyOneServerRepo(...)`）。
锁存在实例上。两个并发 push 各自拿各自实例的锁 — 永远不会互相阻塞。

**问题 B：锁按 AP ID 区分，不按 scope 路径区分**

`handle_push` 调用 `acquire_lock(scope["id"])`，而 `scope["id"]` 来自 `access_points.id`。
两个不同的 AP 绑定了同一个 `docs/`，因为 AP ID 不同，拿到的是不同的锁。

**问题 C：拿不到锁直接拒绝**

锁被占用时直接返回 409 错误，要求客户端自己重试。
不是理想方案中的"server 自动重试，client 无感知"。

**后果**：所有并发写入场景（S1-S4、S6-S7）都不安全。
两个 push 可以同时执行完整的读-合并-写流程，后写覆盖先写。

### 4.3 对比 3.2 嫁接

**理想**：子 scope 提交成功后立刻返回 client，嫁接异步完成。
嫁接用 CAS 保护 + 冲突检测 + 必要时三方合并。

**现状**：嫁接确实在 push 返回后执行（方向对了），但有两个问题：

**问题 A：嫁接操作没有任何并发保护**

嫁接是"读取当前 root_hash → 插入子 scope 的新树 → 写回"。
这个读-改-写操作没有 CAS 也没有锁。两个子 scope 同时嫁接，后者覆盖前者的结果。

**问题 B：嫁接是盲替换，不做冲突检测**

即使加了 CAS，当前的 `graft_subtree` 只是简单替换子树。
如果父 scope 在 push 期间修改了子 scope 路径下的文件，嫁接会丢失父 scope 的改动。

**后果**：

| 场景 | 会发生什么 |
|------|----------|
| S5: `docs/` 和 `src/` 同时 push | 两个嫁接竞争，可能丢失一个 scope 的嫁接结果 |
| S6: root scope 改了 `docs/readme.md`，docs/ scope 同时 push | 嫁接替换 docs/ 子树，root scope 对 readme.md 的改动丢失 |
| S8: 子 scope push 后，父 scope 读取 | 嫁接成功则可见，嫁接被覆盖则不可见 |

### 4.4 对比 3.3/3.4 Server 端流程 + Client 版本一致性

**理想**：CAS 失败后 server 自动重新读取最新状态、重新三方合并、重试提交。
Client 只发一次 push 请求。Push 响应包含 merged_changes。

**现状**：

- **三方合并本身是有的** — 当 client 的 `base_commit_id` 落后于 server 当前 head 时，
  server 会执行三方合并。这部分逻辑正确。
- **但没有 CAS 重试** — 合并后直接写入，不检查中间有没有其他 push 改了 hash。
- **push 响应不包含 merged_changes** — 只返回 `merged: bool` 和 `conflicts: int`。

**后果**：

| 场景 | 会发生什么 |
|------|----------|
| 两个 push 同时触发三方合并 | 两个合并结果都算出来了，但后写覆盖先写 |
| Client B 的 push 合并了 A 的改动 | B 不知道 A 改了什么文件，B 的本地状态缺了 A 的改动 |

### 4.5 对比 3.2 版本号

**理想**（旧设计）：版本号由数据库原子递增（`UPDATE SET v = v + 1 RETURNING v`），不可能重复。

**当前设计**（2026-04-17 起）：不再存在"全局递增版本号"。

- 每次成功 push 产生一个 16-hex `commit_id = sha256(scope_path, scope_hash, ts_microsec, who)[:16]`
- `scope_hash` 在 CAS 中保证 commit 的**输入状态**唯一 → commit_id 天然去重
- 历史列表的顺序完全由 `(created_at DESC, commit_id DESC)` 决定，不依赖数字大小
- 这从根本上消除了原"per-instance counter"竞争问题（历史版本号重复），因为**没有计数器可竞争**

### 4.6 各场景在当前实现下的实际行为

| 场景 | 理想行为 | 实际行为 | 后果 | 根因 |
|------|---------|---------|------|------|
| S1/S3/S6: 改不同文件 | 并行，两边都保留 | 并行但无合并 | 先提交的改动丢失 | 4.1 无 CAS + 4.2 锁无效 |
| S2/S4/S7: 改同一文件 | 三方合并 + 冲突解决 | 无有效合并 | 数据丢失 | 4.1 无 CAS + 4.2 锁无效 |
| S5: 不相关 scope | 完全并行 | 并行 | **正确** | — |
| S8/S9: 读取可见性 | 可见 | 不可见或不稳定 | 子 scope 改动对父 scope 隐身 | 4.3 嫁接无保护 + 读数据源不一致 |

### 4.7 现有组件中可复用的部分

- `mut` 库的 `ScopeQueue`（`sync_queue.py`）已实现路径重叠检测，但 PuppyOne 未使用
- 三方合并（`merge_file_sets`）逻辑正确，可直接复用
- `graft_subtree` 树操作正确，只需加 CAS + 冲突检测包装
- `MutEphemeralClient` 的 clone→push 模式正确，只需切换到 CAS 版 handle_push

---

## 五、实现架构

### 5.1 改动范围

| 层 | 改动 | 说明 |
|----|------|------|
| **mut 库** | `handlers.py` | handle_push 改为 CAS 重试循环 |
| | `protocol.py` | PushResponse 增加 merged_changes 字段 |
| | `repo.py` | ServerRepo 增加 `cas_update_scope()` 接口方法 |
| | `graft.py` | 增加 `graft_or_merge_subtree()` 有冲突检测的嫁接 |
| **PuppyOne** | `server_repo.py` | 实现 `cas_update_scope()`；移除锁；`list_scope_files` 改从 root_hash 读 |
| | `repo_manager.py` | `get_server_repo()` 每次新建（per-request state），底层组件通过 ProjectRepo 缓存 |
| | `supabase_history.py` | 增加 `cas_update_scope_hash()` 和 `atomic_next_version()` |
| | `tree_reader.py` | 确认始终从 root_hash 读（已经是，无需改） |
| | `hooks.py` | 嫁接改用 CAS + 冲突检测；同步重试 |
| | `protocol_router.py` | LockError 改返回 429（CAS 重试用尽时抛出） |
| | `access_point.py` | 同上 |

### 5.2 文件结构（改动后）

```
mut_engine/
├── dependencies.py              # 不变
├── schemas.py                   # 不变
│
├── routers/
│   ├── protocol_router.py       # LockError 改返回 429
│   ├── access_point.py          # LockError 改返回 429
│   ├── content_read.py          # 不变
│   ├── content_write.py         # 不变
│   └── content_history.py       # 不变
│
├── server/
│   ├── server_repo.py           # ⭐ 实现 cas_update_scope；移除锁；从 root_hash 读
│   ├── repo_manager.py          # ⭐ 每次新建 ServerRepo（per-request），底层组件复用
│   ├── auth.py                  # 不变
│   ├── validation.py            # 不变
│   └── backends/
│       ├── s3_storage.py        # 不变
│       ├── supabase_history.py  # ⭐ 增加 CAS 和原子版本号方法
│       ├── supabase_audit.py    # 不变
│       └── supabase_scope.py    # 不变
│
└── services/
    ├── ops.py                   # 不变（通过 ephemeral_client 间接受益）
    ├── tree_reader.py           # 不变（已从 root_hash 读）
    ├── ephemeral_client.py      # 不变（调用 handle_push，自动获得 CAS）
    └── hooks.py                 # ⭐ 嫁接改用 CAS + 冲突检测（同步执行）
```

### 5.3 Server 端 Push 流程（伪代码）

```python
def handle_push(repo, auth, body):
    """CAS 重试循环 — 替代原来的 acquire_lock 模式"""
    scope = auth["_scope"]
    req = PushRequest.from_dict(body)
    _store_incoming_objects(repo.store, req.objects)

    MAX_RETRIES = 3
    for attempt in range(MAX_RETRIES + 1):
        result = _push_attempt(repo, scope, auth, req)
        if result is not None:
            return result
        # CAS failed → retry

    raise LockError("push failed after max retries, try again later")


def _push_attempt(repo, scope, auth, req):
    """单次 push 尝试。CAS 失败返回 None。"""
    # 1. 读当前状态
    old_scope_hash = repo.get_scope_hash(scope["path"])
    our_files = repo.list_scope_files(scope)         # ← 从 root_hash 导航
    old_head_commit_id = repo.get_scope_head_commit_id(scope["path"])

    # 2. 计算合并（不持锁，可并行）
    their_files = _flatten_tree_to_bytes(repo.store, req.snapshots[-1]["root"])
    merged_files, conflicts = _resolve_conflicts(
        repo, scope, req.base_commit_id, old_head_commit_id, our_files, their_files)

    # 3. 构建新树
    _apply_merged_files(repo, scope, our_files, merged_files)
    new_scope_hash = repo.build_scope_tree(scope)

    # 4. 先算 commit_id（纯函数，基于 scope_path / scope_hash / 时间戳 / who）
    created_at_iso = now_iso(microseconds=True)
    new_commit_id = hash_commit_id(scope["path"], new_scope_hash,
                                   created_at_iso, auth["who"])

    # 5. CAS 提交 — scope_hash 和 head_commit_id 在同一条 UPDATE 里
    if not repo.cas_update_scope(
        scope["path"], old_scope_hash, new_scope_hash,
        head_commit_id=new_commit_id,
    ):
        return None  # CAS 失败，调用方会重试

    # 6. 记录历史 + 计算 merged_changes
    changes = _compute_changeset(our_files, merged_files)
    merged_changes = _compute_merged_changes(our_files, merged_files, their_files)
    repo.record_history(
        commit_id=new_commit_id,
        created_at_iso=created_at_iso,
        scope_path=scope["path"],
        scope_hash=new_scope_hash,
        changes=changes,
    )

    return PushResponse(
        status="ok",
        commit_id=new_commit_id,
        root=new_scope_hash,
        merged=bool(conflicts),
        conflicts=len(conflicts),
        merged_changes=merged_changes,
    ).to_dict()
```

### 5.4 异步嫁接流程（伪代码）

```python
def graft_to_root(repo, project_id, scope_path, old_scope_hash, new_scope_hash):
    """嫁接：把 scope 的新树合并到全局 root_hash（同步执行，在返回 client 前完成）。"""
    MAX_RETRIES = 5
    for _ in range(MAX_RETRIES):
        old_root = repo.history.get_root_hash()
        if not old_root:
            old_root = empty_tree_hash

        # 提取当前全局树中该 scope 的子树
        current_subtree = navigate_to_subtree(repo.store, old_root, scope_path)

        if current_subtree == old_scope_hash:
            # 快速路径：无人改过，直接替换
            new_root = graft_subtree(repo.store, old_root, scope_path, new_scope_hash)
        else:
            # 合并路径：有人改了这个子树（父 scope 或其他并发嫁接）
            merged_hash = merge_subtrees(repo.store, old_scope_hash, current_subtree, new_scope_hash)
            new_root = graft_subtree(repo.store, old_root, scope_path, merged_hash)

        # CAS 更新 root_hash
        if repo.history.cas_update_root_hash(old_root, new_root):
            return  # 成功

    log_error("graft failed after max retries")
```

---

## 六、待讨论

1. **CAS 重试次数**：建议 push 重试 3 次，嫁接重试 5 次。超出返回错误让客户端重试。够吗？

2. **嫁接同步还是异步？**
   - 当前实现：同步（push 返回前完成嫁接）。父 scope 立刻可见，但 root_hash CAS 在高并发下可能增加延迟。
   - 未来可选异步：写入强一致 + 可见性最终一致（毫秒级延迟）。子 scope 之间完全不阻塞。

3. **merged_changes 是否内嵌文件内容？**
   当前只返回路径和 action。Client 需额外 pull 获取内容。
   后续可优化为内嵌 base64 内容，让 client 免去 pull。

4. **文件级冲突感知（远期优化）**：
   CAS 失败时，对比两边修改的文件列表：无交集 → 直接基于最新状态嫁接，无需重新合并。
   高并发场景下重试率大幅下降。

---

## 附录：数据类型约定

新增 migration、PostgreSQL 函数、或 Python 代码时**必须遵守**以下约定。这些约定由表
schema 决定，违反会直接导致运行时错误。

### `project_id`：始终为 `TEXT`

- **列类型**：`projects.id`、`mut_commits.project_id`、`mut_scope_state.project_id`、以及所有外键引用
  `projects(id)` 的列都是 `TEXT`，默认值 `uuid_generate_v4()::TEXT`（见
  `20260306085814_qubits_schema.sql`）。
- **值形态**：UUID 字符串，如 `019cad56-ab0b-7f05-bff5-9d4b7982292d`。形态是 UUID，**但列类型不是**。
- **PostgreSQL 函数 / RPC 参数**：必须声明为 `TEXT`，**不能用 `UUID`**。
  - 反例：`p_project_id UUID` → 函数内 `WHERE project_id = p_project_id` → `text = uuid` →
    PostgreSQL 错误 `42883: operator does not exist: text = uuid` → push / rollback
    全部 HTTP 500。
- **Python 代码**：类型标注必须是 `str`（`HistoryManager`、`ServerRepo`、`repo_manager` 等）。

### 防回归措施

| 层 | 文件 | 作用 |
|----|------|------|
| PR 阶段 lint | `.github/workflows/validate-migrations.yml` | 扫描新增 migration 的 `p_project_id` 类型，非 TEXT 直接 fail |
| 部署后 smoke test | `supabase/tests/smoke_test_triggers.sql` | 验证 CAS RPC 签名正确 + 真实调用无类型错误 |
| 文档 | 本节 | 让人/AI 下次写代码前就知道约定 |

### 事件记录

2026-04-15 的 `20260415000000_mut_cas_rpc_functions.sql` 将三个 CAS RPC 的 `p_project_id`
误声明为 `UUID`。该 migration 未 commit 也未部署到任何环境。2026-04-17 的 E2E `mut push`
测试首次调用这些 RPC 时暴露，由 `20260416200000_fix_cas_rpc_project_id_type.sql`
（`DROP FUNCTION` UUID 签名 + `CREATE OR REPLACE FUNCTION` TEXT 签名）修复。详见
`docs/design/mut-bug-checklist.md`。

---

## 附录：关键代码位置

> 供开发人员参考。

| 组件 | 位置 |
|------|------|
| Push 处理（CAS 版） | `mut/server/handlers.py` — `handle_push` / `_push_cas_attempt` |
| CAS 嫁接 | `mut/server/graft.py` — `graft_or_merge_subtree` |
| 路径重叠检测 | `mut/server/sync_queue.py` — `ScopeQueue` / `_paths_overlap` |
| 三方合并 | `mut/core/merge.py` — `merge_file_sets` |
| commit_id 生成 | `mut/server/history.py` — `HistoryManager._compute_commit_id` |
| PuppyOne 服务端适配 | `backend/src/mut_engine/server/server_repo.py` |
| CAS scope 状态（含 head_commit_id） | `backend/src/mut_engine/server/backends/supabase_history.py` — `cas_update_scope_hash` |
| 嫁接 hook | `backend/src/mut_engine/services/hooks.py` |
| Scope 状态表 | `mut_scope_state` (Supabase) — `(scope_hash, head_commit_id)` |
| 项目根 hash | `projects.mut_root_hash` (Supabase) — 不再有 `mut_version` |
