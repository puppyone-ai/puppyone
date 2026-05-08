# MUT → Git 兼容性变更策略文档

**版本**: 0.1
**日期**: 2026-05-08
**范围**: MUT 协议 + PuppyOne 平台全栈

---

## 为什么要做这件事

PuppyOne 当前使用 **MUT（Merkle Update Tree）** 作为底层版本控制协议。MUT 是我们自研的分布式 VCS，核心优势是服务端自动合并（零冲突体验）、路径级 Scope 权限、以及 S3 原生对象存储。

但随着产品走向 developer-facing 工具，Git 兼容性成为无法绕过的要求：

- **用户习惯**：绝大多数开发者的工作流（IDE、CI/CD、Code Review）都围绕 git 命令展开。要求用户学习一套新协议是极高的迁移摩擦。
- **生态接入**：GitHub Actions、GitLab CI、Vercel、Netlify 等主流平台都以 git remote 作为唯一触发源。没有 git 兼容，意味着与整个 DevOps 生态断连。
- **离线场景**：MUT 当前是无状态 ephemeral client，无本地持久化。git 模型天然支持离线工作和离线提交。
- **可审计性**：git 的 DAG 历史和 commit signature 是企业合规的事实标准。

**目标不是抛弃 MUT**，而是让 MUT 作为后端存储和协作层继续运行，同时向外暴露标准 Git 协议接口，让用户可以透明地用 git 命令操作 PuppyOne 项目。

---

## 五大变更方向总览

这是本次改造的核心设计框架。每个方向解决一类独立的不兼容问题，但相互之间存在依赖。

### 变更 1：存储格式迁移（.mut 对象 → .git 对象）

**解决什么**：MUT 使用 `sha256(content)` 作为对象 ID，Git 使用 `sha1("blob {len}\0{content}")`。同一份文件，两套协议算出不同的 hash，git 工具读不懂 MUT 存储的任何东西。

**怎么改**：在 MUT server 上增加一套 Git object 序列化层（blob/tree/commit），并在 S3 + Supabase 旁增加 git refs 存储。迁移历史时，对所有现有 MUT 提交重新计算 git object hash，建立双向映射表。MUT 内部存储格式**暂不替换**，新增 git 格式作为对外暴露层，两套格式并存运行。

### 变更 2：凭证与访问令牌系统

**解决什么**：MUT 的认证依赖 JWT（浏览器 session）和 access key（per-profile JSON 文件），与 git credential helper 协议完全不兼容。`git clone https://...` 时，git 会调用系统 credential helper 获取用户名和密码，MUT 的认证机制无法响应这个接口。

**怎么改**：实现 `puppyone-credential` 可执行文件，作为 git 的 credential helper。同时新建长期有效的 Personal Access Token（PAT）系统，替代 JWT 在 git 操作场景下的认证。支持 token scope（只读/只写/路径限定）和 token 吊销。

### 变更 3：Scope 管理层重构

**解决什么**：MUT 的 Scope（路径级权限）是纯服务端概念，client 只提供路径，server 判断权限。Git 没有原生路径权限概念；sparse checkout 只是客户端视图过滤，不是服务端权限控制。此外，client 当前必须明确知道要写入哪个 scope，否则 graft 写入错误位置（sub-scope 内容被全局树遮盖）。

**怎么改**：新增 scope 发现 API，让 client 在 push 前自动探测当前路径所属的最细粒度 scope，自动选择对应 access key。在 git receive-pack 的 pre-receive hook 中实现路径到 scope 的映射和权限校验。同时支持将 scope 映射为 git sparse checkout filter。

### 变更 4：.mut 目录降级为消息传递 Sidecar

**解决什么**：如果在 git 仓库根目录存放 `.mut/` 目录，这些内容会被 git 跟踪，造成干扰。同时，当前 CLI 的 `MutEphemeralClient` 完全无本地状态，在 git 工作流（clone → 修改 → push）下无法保持跨命令的上下文（如 head commit ID、当前 scope 等）。

**怎么改**：将 `.mut/` 目录规范化为本地 volatile 状态目录，只存储协议握手信息、pending 消息、scope 配置等——不存储任何文件内容，不参与版本控制。`puppyone init` / `puppyone clone` 时自动向 `.gitignore` 注入 `.mut/` 规则，永远不被 git 提交。`.mut/` 是 MUT 协议在 git 工作目录中的"信箱"，而不是存储。

### 变更 5：Git 包装层（双向互操作）

**解决什么**：即使完成上述 1–4 项变更，用户仍然需要分别运行 `git` 命令和 `puppyone` 命令——两套工具之间无联动，状态不同步，体验割裂。

**怎么改**：在 MUT server 上实现标准 **Git Smart HTTP Protocol**（`info/refs`、`git-upload-pack`、`git-receive-pack`），让用户能直接 `git clone https://api.puppyone.com/git/{project_id}`。后续再实现 `git-remote-mut` Remote Helper，让 `puppyone` CLI 作为 git 的传输层，统一两套工具的入口。

---

## 改动之间的依赖关系

```
变更 1（存储格式）
    └── 是变更 5（Git 包装层）的前提：server 要能生成 git pack，才能响应 upload-pack

变更 2（凭证）
    └── 是变更 5 的前提：git push/clone 需要认证

变更 3（Scope）
    └── 是变更 5 receive-pack 侧的前提：push 进来后要知道写入哪个 scope

变更 4（.mut Sidecar）
    └── 与变更 5 并行，解决 CLI 本地状态问题，与 server 侧变更无依赖
```

**最小可工作里程碑**：变更 1 + 2 + 5（只读部分）= 能 `git clone`；再加变更 3 = 能 `git push`。

---

## 目录

1. [现状架构速览](#1-现状架构速览)
2. [核心矛盾：三方合并方向性问题](#2-核心矛盾三方合并方向性问题)
3. [历史迁移完整性风险](#3-历史迁移完整性风险)
4. [五大变更方向](#4-五大变更方向)
   - 4.1 存储格式迁移（.mut → .git）
   - 4.2 凭证与访问令牌系统
   - 4.3 Scope 管理层重构
   - 4.4 .mut 降级为消息传递 Sidecar
   - 4.5 Git 包装层（双向互操作）
5. [各层组件变更清单](#5-各层组件变更清单)
6. [其他隐藏问题总览](#6-其他隐藏问题总览)

---

## 1. 现状架构速览

### MUT 核心机制

| 层次       | 当前实现                                                                           |
| ---------- | ---------------------------------------------------------------------------------- |
| 对象存储   | S3，Merkle tree，内容寻址（SHA-256）                                               |
| 提交历史   | Supabase `mut_scope_state`，`mut_root_hash` 字段                               |
| 全局树     | `_update_global_root` graft hook，`projects.mut_root_hash`                     |
| 合并       | **服务端三方合并**，client 送 `base_commit_id` + 新快照                    |
| Scope 鉴权 | JWT = 全项目读写；access key = 行级 `repo_scopes`                                |
| 客户端状态 | 纯内存 `MutEphemeralClient`（无本地 `.mut` 文件）                              |
| CLI 凭证   | `~/.puppyone/config.json`（JWT）+ `~/.puppyone/credentials.json`（access key） |

### Git 核心机制（对照）

| 层次       | Git 实现                                             |
| ---------- | ---------------------------------------------------- |
| 对象存储   | `.git/objects/`，SHA-1/SHA-256，pack files         |
| 提交历史   | DAG，`refs/heads/`，本地 `.git`                  |
| 合并       | **客户端三方合并**，用户手动解决冲突，再 push  |
| Scope 鉴权 | 无原生概念，依赖 server-side hook 或 sparse checkout |
| 客户端状态 | `.git/` 目录持久化全量状态，离线可用               |
| 凭证       | HTTPS（用户名/密码/token）或 SSH key                 |

---

## 2. 核心矛盾：三方合并方向性问题

### 问题描述

这是整个兼容方案中**最根本的架构冲突**，必须优先解决。

**MUT 当前行为（主动合并）**

```
Client push → Server 检测冲突 → Server 执行三方合并 → 返回 merged=True
                                        ↑
                               client 无感知，被动接受
```

- 合并在服务端自动完成
- Client 送出 snapshot，服务端处理冲突，直接写入新 commit
- Client 拿到 `merged=True` 和新 commit ID，但对合并内容无控制权

**Git 标准行为（被动合并，客户端主权）**

```
git push → 服务端拒绝（non-fast-forward） → Client 执行 git pull --rebase/merge
                                                     ↑
                                           client 自行解决冲突，再 push
```

- 服务端**只接受 fast-forward**，永远不自动合并
- 合并完全在 client 侧执行，用户可介入
- Client 拥有完整 DAG 上下文，能做三路比对

### 不兼容后果

如果直接在 MUT server 上实现 `git receive-pack`，会出现：

1. Client 执行 `git push` → server 触发 MUT 三方合并 → 产生一个客户端从未见过的合并提交
2. Client 的本地 `.git` DAG 与服务端 DAG 不同步（client 无该合并提交）
3. 下次 `git fetch` 后，client 看到陌生的分叉历史
4. `git pull` 再次触发 client 侧合并 → 出现"合并的合并"，DAG 污染

## 3. 历史迁移完整性风险

### 问题描述

将 MUT 历史提交迁移到 Git DAG 时，存在**内容被篡改**的风险。

**根本原因**：MUT 的 `merged=True` 提交是服务端自动合并的产物，其文件内容可能从未被任何用户审阅。当这类提交被翻译成 Git commit 时：

1. 合并内容成为 Git 历史的一部分，与 git merge commit 外形一致
2. 但该 merge commit 的 parent DAG 并不完整——client 从未有过"合并前两个 parent 分支"的概念
3. 重建的 Git DAG 中，parent 关系是**人为构造的**，而非真实开发历史

### 具体风险场景

**场景 1：时序重建错误**

MUT 历史是线性快照序列（每次 push 一个 commit），多用户并发时：

```
User A: commit #1 → commit #3 (merged with B)
User B: commit #2
```

MUT 的 commit #3 是 server 合并 A+B 的结果，但 Git DAG 中应表示为：

```
A: c1 → c3 (merge commit)
          ↑
B: c2 ────┘
```

如果迁移脚本无法准确识别哪些提交参与了该次合并（MUT 仅存储 `base_commit_id`，不存储"另一方"的 commit），则 parent 关系无法正确重建。

**场景 2：自动合并引入未审阅内容**

MUT 的三方合并使用标准内容合并策略，但对于文本文件中的业务逻辑（如 JSON schema、SQL、代码），自动合并结果可能在语法层面正确但语义层面错误。这些错误内容进入 Git 历史后，成为不可篡改的 source of truth。

**场景 3：Scope 边界导致部分历史不可见**

MUT scope 允许用户只接触树的子集。迁移时，如果用户 A 的 scope 是 `/data/`，而 commit 同时修改了 `/config/` 和 `/data/`，在 Git 模型下这是一个完整 commit，但 A 的视角中只有 `/data/` 的变化。

### 解决策略

1. **迁移前审计**：导出全量 MUT 历史，标记所有 `merged=True` 的提交，生成人工审阅清单
2. **合并提交隔离**：迁移到 Git 时，将 server-side merge commit 标记为 `[AUTO-MERGE]`，在 commit message 中注明原始 MUT commit ID
3. **保留原始快照**：不删除 MUT 对象存储中的原始内容，作为审计基准
4. **迁移后校验**：对每个 Git commit 重新计算 Merkle hash，与 MUT 的 commit 内容比对，确保无内容漂移
5. **只做一次性切割**：选定迁移截止点（migration cutoff），之前历史保留在 MUT 只读归档，之后新提交走 Git；避免双写期产生更多 merged 提交

---

## 4. 五大变更方向

### 4.1 存储格式迁移（.mut → .git）

**现状**：对象存储在 S3，内容寻址 SHA-256，提交元数据在 Supabase。

**目标**：Git 对象格式（`blob`/`tree`/`commit` object），可被标准 git 工具读取。

#### 需要变更的内容

**对象格式重新哈希**

| MUT                   | Git                                                |
| --------------------- | -------------------------------------------------- |
| `sha256(content)`   | `sha1("blob {size}\0{content}")` 或 SHA-256 模式 |
| 裸内容                | git object header + content                        |
| S3 key = content hash | `.git/objects/{xx}/{xxxxxx...}` 或 pack file     |

- 所有现存对象的 hash 值需重新计算（SHA-256 内容相同，但 git object hash 不同）
- 需要构建 MUT hash → Git hash 的映射表，用于历史迁移

**Tree 格式转换**

| MUT                           | Git                                            |
| ----------------------------- | ---------------------------------------------- |
| Merkle tree，自定义 JSON 节点 | `tree` object，二进制格式，mode + name + sha |
| 支持任意 metadata             | 仅 mode（100644/100755/040000/120000/160000）  |

- MUT 的节点 metadata（如 `created_at`、`node_type`）需另找存储位置（如 `.puppyone/metadata.json` 文件跟踪在 git 中）

**Commit 格式转换**

| MUT                       | Git                                                |
| ------------------------- | -------------------------------------------------- |
| `commit_id`（UUID）     | `sha1(commit object)`                            |
| 存储在 Supabase           | 存储在 `.git/` 或 pack                           |
| `base_commit_id` = 单亲 | Git 支持多 parent（merge commit）                  |
| 无作者 email 格式要求     | `Author: Name <email> timestamp timezone` 强格式 |

**Pack file 支持**

- Git 大量使用 pack file 做增量压缩传输（`git pack-objects`）
- MUT 当前无 pack 概念，每个对象独立存储在 S3
- 需要实现 pack-protocol 或使用现有 libgit2/go-git 库

**Refs 系统**

- Git 用 `refs/heads/main`、`refs/tags/v1.0` 等管理分支/标签
- MUT 无分支概念，只有线性历史
- 迁移需要：将 `mut_root_hash` 映射为 `refs/heads/main`；scope 可选映射为独立 branch 或 submodule

#### 组件变更

- `mut_engine/server/backends/supabase_history.py`：新增 git object 存储后端
- `mut_engine/core/`：实现 git object 序列化/反序列化
- S3 存储路径规范：从 `{hash}` 改为 git pack protocol 兼容路径
- Supabase schema：新增 `git_refs` 表，或将 `mut_scope_state` 扩展为支持 ref 语义

---

### 4.2 凭证与访问令牌系统

**现状**：两个 JSON 文件（`config.json` JWT + `credentials.json` access key），互相独立。

**目标**：兼容 Git HTTPS 凭证协议（`git credential` helper interface）+ SSH key 认证。

#### 需要变更的内容

**Git HTTPS 凭证 Helper**

Git 在 HTTPS clone/push 时，调用：

```
git credential fill
git credential approve
git credential reject
```

需要实现 `puppyone-credential` helper，响应这些命令，从 `credentials.json` 读取对应 access key 并输出：

```
protocol=https
host=api.puppyone.com
username=<project_id>
password=<access_key>
```

并在 `.gitconfig` 中配置：

```
[credential "https://api.puppyone.com"]
    helper = puppyone
```

**SSH Key 支持**

- 实现 SSH server（使用 `asyncssh` 或类似库），接受 `git-upload-pack` / `git-receive-pack` SSH 命令
- 验证 SSH public key：查询 `user_ssh_keys` Supabase 表（需新建）
- 将 SSH key 关联到用户 → 项目权限

**Token 生命周期管理**

- 现有 JWT 无 refresh 机制（或机制不显式）
- Git token 通常长期有效（类 GitHub PAT），需要：
  - Token 创建 API（`POST /tokens`）
  - Token 吊销 API（`DELETE /tokens/{id}`）
  - Scoped token（只读/只写/特定路径）
  - Token 过期与自动续期

**多账号支持**

- `~/.puppyone/credentials.json` 按 profile 存储
- 与 `~/.gitconfig` 中的 `[user]` 块对应
- CLI 需支持 `puppyone auth switch <profile>` 切换活跃账号

---

### 4.3 Scope 管理层重构

**现状**：`repo_scopes` 表存储 path/exclude/mode/access_key，server 端用于鉴权，client 无感知。

**目标**：Git 原生 sparse-checkout + server-side scope 强制，支持子 scope 发现。

#### 需要变更的内容

**Scope → Git Refs 映射**

两种策略，需选择：

| 策略                      | 描述                                                 | 优缺点                                                       |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| **Subtree branch**  | 每个 scope path 对应独立 branch                      | 简单，但 branch 爆炸；跨 scope 合并复杂                      |
| **Sparse checkout** | 单一 main branch +`.git/info/sparse-checkout` 过滤 | 贴近 Git 原生；但 sparse-checkout 在大型 monorepo 有性能问题 |
| **Submodule**       | 每个 scope 是独立 git submodule                      | 隔离彻底；但 submodule 管理复杂度高                          |

推荐：**Sparse checkout 优先**，对有独立生命周期的 scope 提供 submodule 选项。

**子 Scope 发现机制**

当前问题：client 发起 push 时必须指定目标 scope，否则 graft 写入错误位置。

Git 中无此概念——client 直接 push 到 remote，remote 自行决定存储位置。

解决方案：

- 在 `git receive-pack` 的 pre-receive hook 中，自动检测 push 影响的路径，匹配最细粒度 scope
- 返回 `SCOPE_RESOLVED: <scope_id>` 作为 sideband 消息（不影响 git 协议语义）

**Scope 继承与覆盖**

当前：子 scope 严格独立（无父子继承）。

Git 模型中，sparse-checkout 支持路径通配，天然支持层次。

需要决策：是否在 Git 兼容模式下重新引入 scope 继承，还是坚持平坦 scope 模型 + 多个 sparse-checkout filter。

**最小权限 scope 分发**

新增 API：`GET /projects/{id}/scopes?path=<path>&discover=true`

返回：该路径下最细粒度的可用 scope，供 client 自动选择正确 access key。

---

### 4.4 .mut 降级为消息传递 Sidecar

**现状**：`.mut/` 目录概念存在但 client 实际上不使用本地状态文件（`MutEphemeralClient` 全内存）。

**目标**：`.mut/` 仅用于存储 MUT 协议的带外消息，不参与版本控制，不与 git object 竞争。

#### 需要变更的内容

**.gitignore 标准化**

```gitignore
# .gitignore (auto-injected by puppyone init)
.mut/
```

- `puppyone init` 和 `puppyone clone` 时自动注入此规则
- 如果项目已有 `.gitignore`，执行 append（不覆盖）
- 检测并警告如果 `.mut/` 已被 git track

**.mut/ 目录内容规范**

```
.mut/
├── config.json          # 项目级 MUT 配置（API endpoint、project_id）
├── scope.json           # 当前 checkout 的 scope 信息
├── pending_messages/    # 未发送的 MUT 带外消息（如离线时的变更通知）
├── recv_messages/       # 已收到的服务端消息（agent 通知、sync status 等）
└── locks/               # 本地操作锁（防止并发 CLI 进程冲突）
```

**消息格式**

```json
{
  "type": "sync_status | agent_event | scope_update | ...",
  "payload": {...},
  "timestamp": "ISO8601",
  "ack_required": false
}
```

**生命周期**

- `pending_messages/` 中的消息在下次 push/pull 时随 git 操作捎带发送
- `recv_messages/` 在消费后清空（类似 inbox）
- `locks/` 使用 flock 语义，进程退出后自动释放

**注意**：`.mut/` 中的内容**永远不提交到 git**，是本地 volatile 状态。

---

### 4.5 Git 包装层（双向互操作）

**现状**：MUT CLI（`puppyone`）与 git 完全独立，没有任何互操作。

**目标**：`puppyone` 作为 git remote helper 或 git wrapper，让标准 git 命令透明操作 MUT 后端。

#### 两种实现路径

**路径 A：Git Remote Helper**

实现 `git-remote-mut` 可执行文件，放在 `$PATH` 中。用户配置：

```
git remote add origin mut::https://api.puppyone.com/projects/xxx
```

Git 调用 `git-remote-mut` 处理所有与 remote 的通信。Helper 实现：

- `capabilities`：声明 `fetch` + `push`
- `list`：列出远端 refs
- `fetch <sha> <refname>`：从 MUT 下载对象
- `push <src>:<dst>`：将本地 commits 上传到 MUT

优点：完全符合 git 标准，用户不改任何习惯
缺点：需要实现完整 git object 协议；复杂度高

**路径 B：Git Smart HTTP Protocol**

在 PuppyOne backend 上实现 `git-http-backend` 兼容的端点：

```
GET  /git/{project_id}/info/refs?service=git-upload-pack
POST /git/{project_id}/git-upload-pack
POST /git/{project_id}/git-receive-pack
```

用户直接用：

```
git clone https://api.puppyone.com/git/{project_id}
```

优点：无需客户端安装额外工具；兼容所有 git GUI 工具
缺点：服务端需要实现完整 git smart HTTP protocol；需处理 packfile 协议

**推荐**：短期 B（Smart HTTP，服务端集中实现），长期 A（Remote Helper，客户端灵活控制）。

#### 双向同步（MUT API ↔ Git）

当用户混用 MUT API 和 git 命令时（过渡期），需要保持双向同步：

```
MUT push → 触发 git refs 更新（通过 post-push hook）
git push → 触发 MUT commit 写入（通过 git pre-receive hook）
```

**冲突防护**：两个方向都必须检查"是否已有更新的提交"，否则双向同步会产生无限循环。

---

## 5. 各层组件变更清单

### Backend（Python）

#### `mut_engine/core/`（核心库）

| 文件                   | 变更内容                                                                   |
| ---------------------- | -------------------------------------------------------------------------- |
| `objects.py`（新建） | Git object 序列化：blob/tree/commit/tag                                    |
| `packer.py`（新建）  | Pack file 生成与解析（`git pack-objects` 协议）                          |
| `refs.py`（新建）    | Refs 管理：create/update/delete，CAS 语义                                  |
| `merge.py`           | 新增 `strict_ff_check()`；现有三方合并改为可选（通过 merge_policy 参数） |
| `history.py`         | 新增 Git commit 格式输出；现有 MUT commit 格式保留用于内部                 |

#### `mut_engine/server/`（服务端）

| 文件                             | 变更内容                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `git_http.py`（新建）          | Smart HTTP protocol handler：`info/refs`、`upload-pack`、`receive-pack` |
| `git_auth.py`（新建）          | Git HTTPS 基本认证：解析 Authorization header，验证 access token              |
| `ssh_server.py`（新建）        | asyncssh server；处理 `git-upload-pack` / `git-receive-pack` SSH channel  |
| `backends/supabase_history.py` | 新增 git refs 存储方法；扩展 `mut_root_hash` 为 `refs/heads/main`         |
| `hooks.py`                     | 拆分 post-push hook：MUT graft（现有）+ git refs 更新（新增）                 |
| `ops.py`                       | push 方法新增 `merge_policy` 参数；409 冲突响应格式扩展为 git-compatible    |

#### Supabase Schema（迁移脚本）

```sql
-- 新表：git refs
CREATE TABLE git_refs (
  project_id UUID REFERENCES projects(id),
  ref_name TEXT,           -- e.g. refs/heads/main
  commit_hash TEXT,        -- git SHA
  mut_commit_id TEXT,      -- 对应 MUT commit ID（用于双向映射）
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (project_id, ref_name)
);

-- 新表：access tokens（长期 PAT）
CREATE TABLE access_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  project_id UUID REFERENCES projects(id),
  scope_path TEXT,
  mode TEXT CHECK (mode IN ('r', 'rw')),
  token_hash TEXT UNIQUE,  -- bcrypt hash
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 新表：SSH 公钥
CREATE TABLE user_ssh_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  key_type TEXT,           -- ssh-rsa, ecdsa-sha2-nistp256, etc.
  public_key TEXT,
  fingerprint TEXT UNIQUE,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Frontend

| 文件                                               | 变更内容                                   |
| -------------------------------------------------- | ------------------------------------------ |
| `lib/gitApi.ts`（新建）                          | Git 操作 API：clone URL 生成、token 管理   |
| `components/settings/GitAccessPanel.tsx`（新建） | PAT 管理 UI：创建/吊销 token，SSH key 上传 |
| `app/(main)/projects/[id]/settings/`             | 新增 "Git Access" tab                      |
| `lib/projectsApi.ts`                             | 新增 `getGitCloneUrl(projectId)`         |

### CLI（`puppyone` Python package）

| 命令/文件                   | 变更内容                                                    |
| --------------------------- | ----------------------------------------------------------- |
| `puppyone git-credential` | 实现 git credential helper 接口                             |
| `puppyone clone`          | 支持 `--git` flag：初始化 `.git/` + 注入 `.gitignore` |
| `puppyone init`           | 在已有 git repo 中配置 MUT remote                           |
| `~/.puppyone/config.json` | 新增 `git_helper_enabled: bool` 字段                      |
| `credentials.py`          | 统一管理 JWT、access key、PAT                               |

---

## 6. 其他隐藏问题总览

以下是用户原始 5 点之外，实现过程中必然会遇到的技术问题：

### P0（阻塞性问题）

| 问题                                    | 说明                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------- |
| **Git SHA-1 vs MUT SHA-256 碰撞** | 同一文件内容，两种哈希算法计算结果不同，无法直接复用现有 S3 key             |
| **Pack protocol 实现复杂度**      | Git pack 协议涉及 delta encoding、thin pack、side-band；从零实现需要数周    |
| **服务端三方合并完全重构**        | 现有合并逻辑必须拆分为"检测冲突 → 返回 409"和"客户端合并 → 再 push"两阶段 |
| **历史迁移不可逆**                | 一旦 git object hash 写入，无法修改；迁移前必须有完整 rollback 方案         |

### P1（重要问题）

| 问题                                     | 说明                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **离线能力丧失**                   | Git 依赖本地 `.git/`，MUT 当前是无状态的；迁移后 offline push 需要 git 本地状态持久化                                               |
| **Scope 与 git branch 语义不对齐** | MUT scope 是路径过滤，git branch 是历史分叉；两者映射关系复杂，边界情况多                                                             |
| **大文件处理**                     | Git 不适合大二进制文件；需要配套 Git LFS 或保留 MUT 的 S3 直传路径                                                                    |
| **MUT metadata 无处存放**          | Git tree 只存 mode + filename；`node_type`、`created_at` 等 MUT 元数据需要额外机制（如 `.puppyone/metadata.json` 或 git notes） |
| **并发写入性能退化**               | Git 的 strict fast-forward 要求 client 串行 push；MUT 的自动合并支持高并发；迁移后并发写入体验降级                                    |
| **Windows CRLF / 权限位**          | Git 在 Windows 上的 CRLF 处理和 executable bit 可能影响 Merkle hash 一致性                                                            |

### P2（需要设计的新问题）

| 问题                                         | 说明                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Webhook 与 CI/CD 集成**              | Git push 后触发 webhook 是标配（GitHub Actions、GitLab CI）；MUT 当前无 webhook 系统     |
| **Fork / PR / Code Review**            | 用户会期待 GitHub-like 的 PR 流程；需要决定是否实现或对接外部 CI                         |
| **.gitattributes 支持**                | Git 通过 `.gitattributes` 控制 diff、merge driver、LFS 等；需要 server 端识别          |
| **Shallow clone 支持**                 | `git clone --depth 1` 是常见操作；服务端需支持 shallow pack 生成                       |
| **Submodule 与 Scope 冲突**            | 如果 scope 映射为 submodule，`git submodule update` 的行为需要与 MUT scope sync 对齐   |
| **签名提交（GPG/SSH signed commits）** | 企业用户可能要求 `git commit -S`；需要验证签名的 pre-receive hook                      |
| **Rebase 与 MUT 历史线性假设**         | MUT 历史是严格线性的；git rebase 产生新 commit hash，会破坏 MUT 的 `base_commit_id` 链 |

## 附录：关键决策点汇总

| 决策                        | 选项 A                           | 选项 B                             | 当前建议                         |
| --------------------------- | -------------------------------- | ---------------------------------- | -------------------------------- |
| 合并策略迁移路径            | 立即切 strict FF                 | 双模式并行                         | **双模式**，逐步迁移       |
| Scope → Git 映射           | Sparse checkout                  | Submodule                          | **Sparse checkout** 优先   |
| Smart HTTP vs Remote Helper | Smart HTTP（server 实现）        | Remote Helper（client 实现）       | **Smart HTTP** 先行        |
| SSH 认证                    | asyncssh 自建                    | 使用 nginx + git-http-backend 代理 | **自建**（更灵活）         |
| 历史迁移                    | 全量迁移                         | 切割点（只迁移最近 N 个月）        | **切割点**，旧历史只读归档 |
| Git object hash             | 继续用 SHA-256（git 2.29+ 支持） | 降级到 SHA-1（兼容所有 git 版本）  | **SHA-256**（面向未来）    |
