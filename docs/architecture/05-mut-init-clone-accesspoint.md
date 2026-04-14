# 05 — MUT Init, Clone & Access Point 绑定设计

> 版本: v1.0 | 日期: 2026-04-09

---

## 1. 核心原则

| 原则                                            | 说明                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Server 是唯一的 Source of Truth (SoT)** | 任何 SoT 都只在 server 端出现，client 端永远是 server 的镜像                              |
| **Server 不可为空**                       | MUT 协议不允许 server 端为完全空状态；至少需要一个 scope（文件夹），即使 scope 内没有文件 |
| **Scope 是一切操作的前提**                | Scope 绑定了 auth、用户身份、权限配置；没有 scope 就没法 sync、配置、鉴权                 |
| **Client 端不持有 SoT**                   | Client 端的内容来源于 clone server，本地修改通过 push 提交到 server 进行合并              |

---

## 2. 为什么需要 `mut init`

### 之前的设计

只通过 `mut clone` 操作，不提供 `mut init`。所有 repo 必须从 server clone 而来。

### 问题

用户在本地没有 MUT server 的情况下，无法创建 MUT repo。这限制了以下场景：

- 用户先在本地开发，后续再连接到 PuppyOne
- 用户在离线环境下初始化项目
- 用户想先标记一个目录为 MUT 管理，稍后再绑定 server

### 解决方案

引入 `mut init`，但**严格限定其职责**：

- `mut init` 只在本地创建 `.mut/` 目录，标记当前目录为 MUT repo
- `mut init` **不创建 server**，不产生 SoT
- 必须后续通过 `mut link access` 绑定到 server，才能进行 sync 操作

---

## 3. 三种初始化场景

### 场景 A：从 PuppyOne 导入数据创建 MUT Repo

**前提条件：** 用户在 PuppyOne 平台上导入了数据（通过 connector：Gmail、GitHub、文件上传等）

**流程：**

```
┌─────────────────────────────────┐
│  PuppyOne 平台                   │
│  1. 用户导入数据                  │
│  2. 自动创建 MUT Repo + Server    │
│  3. 数据成为 Server 端的 SoT      │
│  4. 生成 Access Point (access_key)│
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  本地 Client                     │
│  mut clone <access_point_url>    │
│  → 获取 server 端全部内容         │
│  → 自动生成 .mut/config.json     │
└─────────────────────────────────┘
```

**特点：**

- Server 天然包含数据，不存在空 server 问题
- Client 端是纯镜像，SoT 完全在 server
- 最简单、最符合 MUT 协议原始设计的场景

---

### 场景 B：本地空目录初始化 + 绑定 Access Point

**前提条件：** 用户在本地的空目录下操作，尚未在 PuppyOne 创建 repo

**流程：**

```
┌─────────────────────────────────┐
│  本地 Client（空目录）            │
│                                  │
│  Step 1: mut init                │
│  → 创建 .mut/ 目录               │
│  → 标记当前目录为 MUT repo        │
│  → 此时无 server 连接             │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  Step 2: mut link access   │
│          <url> <root_dir_name>   │
│                                  │
│  本地端：                         │
│  → 绑定到 PuppyOne server        │
│  → 在本地创建 root_dir_name 文件夹│
│                                  │
│  PuppyOne 端（自动触发）：         │
│  → 创建新的空 MUT Server          │
│  → Init 一个 root_dir_name 文件夹 │
│  → 此文件夹 = 一个 scope          │
│  → Server 不为空（有 scope）      │
│  → 生成 access_key 返回给 client  │
└─────────────────────────────────┘
```

**关键设计：**

- `root_dir_name` 同时在 client 和 server 端创建，保证双方状态一致
- Server 虽然"逻辑上"没有用户文件，但有了 scope 文件夹就不算空
- 有 scope = 有 auth 绑定 = 可以执行后续所有 sync 操作
- 文件层面，client 和 server 都是"空的"（scope 文件夹内无文件），所以天然同步

---

### 场景 C：本地非空目录初始化 + 绑定 Access Point

**前提条件：** 用户在本地已有文件的目录下操作

**流程：**

```
┌─────────────────────────────────┐
│  本地 Client（已有文件）          │
│  /my-project/                    │
│  ├── src/main.py                 │
│  ├── docs/readme.md              │
│  └── config.json                 │
│                                  │
│  Step 1: mut init                │
│  → 创建 .mut/ 目录               │
│  → 标记当前目录为 MUT repo        │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│  Step 2: 通过 PuppyOne Filesystem       │
│          Connector 同步本地文件到云端     │
│                                          │
│  → 本地文件作为 SoT 上传到 PuppyOne      │
│  → PuppyOne 自动创建 MUT Repo + Server   │
│  → 本地 SoT 转移到 Server 端             │
│  → 生成 Access Point                     │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  Step 3: mut link access   │
│          <url>                   │
│                                  │
│  → 绑定到已有数据的 server        │
│  → 不需要指定 root_dir_name      │
│  → 如果指定了，则额外添加子文件夹  │
│    scope，而非替换整个 repo       │
└─────────────────────────────────┘
```

**关键设计：**

- 本地的 SoT 先通过 Filesystem Connector 传到 PuppyOne
- 传输完成后，Server 端拥有完整数据，成为 SoT
- 之后的流程等同于场景 A（从 PuppyOne clone），相当于反向clone
- `mut link access <url>` 不指定 `root_dir_name`，直接绑定到已有 repo
- 如果指定了 `root_dir_name`，只是额外添加一个子文件夹 scope，不会替换内容

---

## 4. 命令设计

### `mut init`

```bash
mut init
```

| 行为                | 说明                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| 创建 `.mut/` 目录 | 包含 `config.json`（`{"version": 1, "server": null}`）            |
| 初始化对象存储      | 创建 `objects/`、`snapshots/` 等子目录                              |
| 不创建 server       | 纯本地操作                                                           |
| 不产生 SoT          | 只是标记，不做任何数据承诺                                           |
| 幂等                | `.mut/` 已存在时不报错，保留已有配置                                |
| 向后兼容            | 保持已有的 init 逻辑（创建 object store + snapshot chain），在此基础上扩展 config 结构 |

### `mut link access`

```bash
# 场景 B：本地空目录，需要指定 root_dir_name 创建 scope
mut link access <access_point_url> <root_dir_name>

# 场景 C：本地非空目录，已通过 connector 同步
mut link access <access_point_url>

# 场景 C：额外添加子文件夹 scope
mut link access <access_point_url> <sub_dir_name>
```

| 参数                      | 说明                                                   |
| ------------------------- | ------------------------------------------------------ |
| `access_point_url`      | PuppyOne Access Point 的 URL                           |
| `root_dir_name`（可选） | 在 client 和 server 同时创建的根文件夹名称，作为 scope |

| 行为                      | 说明                                                              |
| ------------------------- | ----------------------------------------------------------------- |
| 写入 `.mut/config.json` | 保存 server URL 和 credential                                     |
| 验证连接                  | 确认 server 可达且 access_key 有效（发送 clone 请求测试）          |
| 同步 scope                | 如指定 root_dir_name，在 client 创建文件夹并 push 到 server       |
| 前提条件                  | 必须先执行 `mut init`（`.mut/` 目录必须存在）                    |

### `mut clone`（保持不变）

```bash
mut clone <access_point_url>
```

| 行为                   | 说明            |
| ---------------------- | --------------- |
| 从 server 下载完整内容 | 标准 clone 流程 |
| 自动创建 `.mut/`     | 包含完整配置    |
| Server 必须已存在      | 不创建新 server |

---

## 5. 冲突与 SoT 保障

### 问题

在 init + 绑定 access point 之后，如果本地 client A 认为自己的内容是 SoT，但另一个 client B 也推送了修改到 server，那么 server 端可能不再持有 client A 认为的"真正 SoT"。

### 解决策略

```
┌──────────────────────────────────────────────────────┐
│                   冲突处理决策树                       │
├──────────────────────────────────────────────────────┤
│                                                       │
│  Q: 两个 client 是否操作同一个 scope？                 │
│                                                       │
│  ├─ 否 → 通过 scope 隔离，天然不冲突                   │
│  │       （推荐：给不同 client 分配不同 scope）         │
│  │                                                    │
│  └─ 是 → 同一个 scope 下发生冲突                       │
│          │                                            │
│          ├─ 用户可以接受 merge？                       │
│          │  → Server 三方合并，client A 的 SoT          │
│          │    会被保留在 merge 结果中                   │
│          │  → 如果是同行/同 key 冲突，LWW 生效          │
│          │    （最后写入者胜出）                        │
│          │                                            │
│          └─ 用户不希望被覆盖？                         │
│             → 创建新的 MUT Repo + 新的 Server           │
│             → 重新 mut init + mut link access     │
│             → Client 端内容成为新 server 的 SoT         │
│             → 新 repo 中不存在其他 client 的干扰        │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### Scope 隔离方案（推荐）

```
MUT Server
├── /research/      ← Client A 的 scope (rw)
├── /engineering/   ← Client B 的 scope (rw)
└── /shared/        ← 两者都可读，指定一方可写
```

- Client A 只能 push 到 `/research/`
- Client B 只能 push 到 `/engineering/`
- 不同 scope 之间不会发生冲突

### 新 Repo 隔离方案（强隔离）

当用户明确需要某个 client 的内容作为不可被覆盖的 SoT 时：

```bash
# Client A 的内容需要独占 SoT
cd /my-important-project
mut init
# 通过 filesystem connector 上传到 PuppyOne → 创建新 repo + server
mut link access <new_access_point_url>
# 此时 client A 的内容是新 server 唯一的 SoT
# 没有其他 client 会推送到这个 server
```

---

## 6. Server 不可为空的实现

### 为什么不能为空

| 问题           | 说明                                                         |
| -------------- | ------------------------------------------------------------ |
| Sync 逻辑异常  | 空 server 在 pull/push 时没有 base version，三方合并无法执行 |
| Scope 无法绑定 | MUT 协议要求 scope 路径存在于 tree 中                        |
| Auth 无锚点    | 没有 scope 就没法配置权限和用户绑定                          |
| History 断裂   | 空 server 的 version 0 没有 root hash，后续版本链不完整      |

### 初始化策略

当通过 `mut link access <url> <root_dir_name>` 创建新 server 时：

```python
# Server 端初始化逻辑
def create_server_with_root(root_dir_name: str):
    repo = ServerRepo.init(path)

    # 创建根文件夹，确保 server 不为空
    os.makedirs(repo.current_dir / root_dir_name, exist_ok=True)

    # 注册 scope
    repo.add_scope(
        scope_id=f"scope-{root_dir_name}",
        scope_path=f"/{root_dir_name}/",
        agents=[agent_id],
        mode="rw"
    )

    # 提交初始版本（有文件夹，version > 0）
    repo.commit_initial()
```

**结果：**

- Server version = 1（非空）
- Tree 中有 `/{root_dir_name}/` 文件夹
- Scope 已注册，可绑定 auth
- Client 端 clone/sync 可正常工作

---

## 7. Config 结构

### `.mut/config.json`（init 后，绑定前）

```json
{
  "version": 1,
  "server": null,
  "credential": null
}
```

### `.mut/config.json`（绑定 access point 后）

```json
{
  "version": 1,
  "server": "https://api.puppyone.com/api/v1/mut/ap/cli_abc123def456",
  "credential": "cli_abc123def456"
}
```

**说明：**

- MUT CLI 直接使用 `access_point_url` 作为 server URL
- `credential` 即 `access_key`，内嵌在 URL 中也单独存储
- 不存储 `project_id`（server 端通过 access_key 解析）

---

## 8. 完整生命周期示例

### 示例 1：前端创建 → 本地开发

```bash
# 1. 用户在 PuppyOne 创建项目，导入 GitHub repo
#    → 自动创建 MUT Server，数据成为 SoT
#    → 生成 Access Point: https://api.puppyone.com/api/v1/mut/ap/cli_xxx

# 2. 本地 clone
mut clone https://api.puppyone.com/api/v1/mut/ap/cli_xxx
cd my-project

# 3. 正常开发
echo "new feature" >> src/main.py
mut commit -m "add feature"
mut push

# 4. 拉取远程更新
mut pull
```

### 示例 2：本地空目录开始

```bash
# 1. 本地初始化
mkdir my-project && cd my-project
mut init

# 2. 绑定到 PuppyOne（创建新 server + scope）
mut link access https://api.puppyone.com/api/v1/mut/ap/cli_xxx research

# 3. 开始在 research/ 下工作
echo "# Research Notes" > research/notes.md
mut commit -m "first note"
mut push
```

### 示例 3：本地已有文件

```bash
# 1. 本地已有项目
cd /existing-project
ls  # src/ docs/ config.json

# 2. 初始化 MUT
mut init

# 3. 通过 PuppyOne Filesystem Connector 上传
#    （在 PuppyOne UI 或 CLI 中操作）
#    → 文件上传到 PuppyOne → 创建 MUT Repo + Server
#    → 生成 Access Point

# 4. 绑定
mut link access https://api.puppyone.com/api/v1/mut/ap/cli_xxx

# 5. 正常使用
mut status
mut commit -m "update"
mut push
```

---

## 9. 局限性与待验证事项

| 事项                              | 状态                      | 说明                                        |
| --------------------------------- | ------------------------- | ------------------------------------------- |
| 同 scope 多 client SoT 冲突       | ⚠️ 设计方案已定，待验证 | 通过 scope 隔离 + 新 repo 隔离解决          |
| Filesystem Connector 大文件上传   | ⚠️ 待测试               | 场景 C 中大目录的初始同步性能               |
| `mut link access` 的原子性 | ⚠️ 待实现               | client 和 server 同时创建文件夹需要事务保证 |
| 离线 init 后的首次绑定            | ⚠️ 待测试               | init 后长时间离线，再绑定时的状态同步       |
| LWW 场景下的用户预期管理          | ⚠️ 待 UX 设计           | 用户可能不理解为什么自己的修改被覆盖        |

---

## 10. 与现有架构的关系

| 组件         | 本文涉及                           | 参考文档                                |
| ------------ | ---------------------------------- | --------------------------------------- |
| MUT Engine   | Server 初始化、scope 注册          | [01-mut-engine.md](01-mut-engine.md)       |
| Access Point | URL 格式、credential 解析          | [02-access-points.md](02-access-points.md) |
| CLI          | init、link access、clone 命令      | [03-cli.md](03-cli.md)                     |
| Connectors   | Filesystem Connector（场景 C）     | [04-connectors.md](04-connectors.md)       |
