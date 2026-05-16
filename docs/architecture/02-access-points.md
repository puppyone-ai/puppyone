# Access Point Architecture

> **Mostly current, with one update**: the access key now authorises
> **stock Git** at `/git/ap/<key>.git` and the FS HTTP API at
> `/api/v1/ap-fs/*`. The legacy `/api/v1/mut/ap/<key>/*` URL is gone
> (see [07-version-engine-supplement.md](07-version-engine-supplement.md)
> §3). The auth model, scope binding, identity-bound mode, and channel
> pause semantics described below are otherwise unchanged.

Access Point 是 PuppyOne 对外暴露的统一入口。一个 access key 解析到一个项目 + 一个 scope（path/exclude/mode），后端的 Git 适配器和 FS HTTP API 都用同一份解析结果。Client 只需要知道 URL + credential，背后的 connector 类型和权限配置对 client 透明。

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                      MUT Client                             │
│                                                             │
│   mut clone <url> --credential <key>                        │
│   mut push / pull / commit                                  │
│                                                             │
│   Client 只认:                                               │
│     - Access Point URL                                       │
│     - Credential (access_key)                                │
│   Client 不知道:                                             │
│     - 背后是什么 connector                                    │
│     - 有什么权限限制                                          │
│     - 项目名、平台等概念                                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Access Point Layer                       │
│                                                             │
│   URL: https://api.puppyone.com/mut/{access_key}            │
│                                                             │
│   access_key 在 server 端映射到:                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  project_id      : proj_abc123                      │   │
│   │  connector_type  : agent | sandbox | datasource |   │   │
│   │                    filesystem | mcp | direct        │   │
│   │  scope           : /                    (路径范围)   │   │
│   │  permissions     : read | write | rw    (基本权限)   │   │
│   │  connector_config: { ... }   (connector 特有配置)    │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
│   职责:                                                      │
│     1. 验证 access_key                                       │
│     2. 加载权限配置                                           │
│     3. 检查操作是否允许 (scope + permissions)                 │
│     4. 路由到 MutOps                                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 权限检查通过
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        MutOps                               │
│                     (统一操作入口)                            │
│                                                             │
│   所有 connector 类型最终都走同一个 MutOps:                   │
│     - clone / push / pull / negotiate                       │
│     - 版本管理、冲突解决                                      │
│                                                             │
│   MutOps 不关心请求来自哪种 connector                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      MUT Tree                               │
│                   (Merkle tree storage)                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Connector 类型

每种 connector 背后可能有不同的细微权限配置，但对 MUT client 而言是透明的。

| Connector Type | 说明 | 典型权限配置 |
|----------------|------|-------------|
| `direct` | 直接访问项目（人类用户/通用） | scope, permissions |
| `agent` | AI Agent 访问 | scope, permissions, tool_access |
| `sandbox` | 代码沙箱访问 | scope, permissions, exec_allowed |
| `datasource` | 数据源同步（Notion/Gmail/...） | scope, sync_direction |
| `filesystem` | 本地文件夹同步 | scope, permissions, watch_mode |
| `mcp` | MCP 协议端点 | scope, exposed_tools |

---

## 权限模型

### 基本权限 (permissions)

所有 connector 共享的基本权限：

```json
{
  "permissions": "rw"  // read | write | rw
}
```

### Scope (路径范围)

限制 access point 可访问的路径：

```json
{
  "scope": "/research"  // 只能访问 /research 及其子目录
}
```

### Connector 特有配置 (connector_config)

每种 connector 可能有额外配置，藏在 access point 后面：

```json
// Agent
{
  "connector_type": "agent",
  "connector_config": {
    "tool_access": ["search", "summarize"],
    "model": "gpt-4"
  }
}

// Sandbox
{
  "connector_type": "sandbox",
  "connector_config": {
    "runtime": "python",
    "exec_allowed": true,
    "max_execution_time": 30
  }
}

// Datasource (e.g., Notion)
{
  "connector_type": "datasource",
  "connector_config": {
    "provider": "notion",
    "sync_direction": "pull",  // pull | push | bidirectional
    "oauth_ref": "oauth_xxx"
  }
}

// Filesystem
{
  "connector_type": "filesystem",
  "connector_config": {
    "watch_mode": "realtime",  // realtime | manual
    "ignore_patterns": [".git", "node_modules"]
  }
}
```

---

## 用户视角

用户（包括 AI Agent）只看到一个 URL + credential：

```bash
# 创建 access point (在 PuppyOne)
puppyone access create my-project --type agent --scope /data --permission rw
# → https://api.puppyone.com/mut/ak_abc123

# 使用 access point (在 MUT client)
mut clone https://api.puppyone.com/mut/ak_abc123 ./workspace
mut commit -m "update"
mut push
```

用户不需要知道：
- 这是什么类型的 connector
- 有什么细微的权限配置
- 背后的 project_id 是什么

---

## Server 端处理流程

```
1. 收到请求: POST /mut/ak_abc123/push
                         │
2. 解析 access_key ──────┘
   │
   ▼
3. 从 access_points 表加载配置:
   {
     project_id: "proj_xyz",
     connector_type: "agent",
     scope: "/data",
     permissions: "rw",
     connector_config: { tool_access: [...] }
   }
   │
   ▼
4. 权限检查:
   - 请求的路径是否在 scope 内？
   - 请求的操作是否在 permissions 内？
   │
   ├── 失败 → 403 Forbidden
   │
   ▼ 成功
5. 调用 MutOps.handle_push(project_id, ...)
   │
   ▼
6. 返回结果
```

---

## 数据模型

复用现有 `access_points` 表：

```sql
-- access_points 表
id              text PRIMARY KEY
project_id      text NOT NULL
provider        text NOT NULL      -- 'mut' for MUT access points
access_key      text UNIQUE        -- ak_xxx
config          jsonb              -- { connector_type, scope, permissions, connector_config }
status          text               -- active | paused
created_at      timestamp
```

```json
// config 字段示例
{
  "connector_type": "agent",
  "scope": "/",
  "permissions": "rw",
  "connector_config": {
    "tool_access": ["search"],
    "model": "gpt-4"
  }
}
```



Access Point 的 CLI 命令（`puppyone access create/list/delete`）参见 [03-cli.md](03-cli.md)。
