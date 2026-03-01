# Connector Sync Strategy & Architecture

## Overview

PuppyOne 的 Connector 负责将外部数据源（Gmail、Notion、GitHub 等）的数据拉取到平台中，存储为结构化的 Content Node，并通过版本管理持续追踪变更。

本文档定义 Connector 同步的产品策略与技术架构，确保：

- **所有数据写入（包括首次导入）统一走版本管理**
- **Connector 职责单一** — 只负责取数据，不感知触发方式和存储方式
- **新增 Connector 成本极低** — 只需实现一个 `fetch()` 方法

---

## Sync Modes

用户在连接信息源时，通过 **"Sync frequency"** 选择同步模式：

| Mode | 用户看到的标签 | 描述 |
|------|--------------|------|
| **Import once** | Import once | 一次性导入，之后不再更新。不创建持续同步关系。 |
| **Manual** | Manual refresh | 创建同步绑定。用户手动点击 Refresh 按钮时拉取最新数据。 |
| **Scheduled** | Scheduled | 定时自动检查更新。选择后展开二级配置面板（复用 Scheduled Agent 的交互）。 |
| **Real-time** | Real-time ⚡ | 外部数据一有变动，立即同步。（Phase 3 实现，当前预留。） |

---

## Connector × Sync Mode Matrix

| Connector | Import once | Manual | Scheduled | Real-time (future) |
|-----------|:-----------:|:------:|:---------:|:------------------:|
| **Gmail** | ✅ | ✅ | ✅ | 🔮 Pub/Sub |
| **Notion** | ✅ | ✅ | ✅ | 🔮 Webhook |
| **GitHub** | ✅ | ✅ | ✅ | 🔮 Webhook |
| **Google Drive** | ✅ | ✅ | ✅ | 🔮 Push |
| **Google Docs** | ✅ | ✅ | ✅ | 🔮 Push |
| **Google Sheets** | ✅ | ✅ | ✅ | ❌ |
| **Google Calendar** | ✅ | ✅ | ✅ | 🔮 Push |
| **Linear** | ✅ | ✅ | ✅ | 🔮 Webhook |
| **Airtable** | ✅ | ✅ | ✅ | 🔮 Webhook |
| **URL (Firecrawl)** | ✅ | ✅ | ✅ | ❌ |
| **OpenClaw (本地)** | — | — | — | ✅ 已实现 |

> 🔮 = Phase 3 预留，当前不实现。

---

## Default Sync Mode

每种 Connector 的默认选中值（用户可更改）：

| Connector | Default | 理由 |
|-----------|---------|------|
| Gmail | Import once | 邮件数据量大，默认一次性导入更安全 |
| Notion | Manual | 用户通常在需要时手动更新 |
| GitHub | Import once | 代码仓库数据量大，默认一次性导入 |
| Google Drive | Import once | 文件可能很大，默认一次性导入 |
| Google Docs | Manual | 文档会频繁编辑，方便用户手动刷新 |
| Google Sheets | Manual | 表格数据可能频繁变化 |
| Google Calendar | Scheduled | 日程信息时效性较强，适合定时同步 |
| Linear | Manual | 项目管理数据按需更新 |
| Airtable | Manual | 按需更新 |
| URL | Import once | 网页快照，默认一次性导入 |
| OpenClaw | Real-time | 本地文件夹始终实时监听 |

---

## User Experience

### 连接信息源 — 一级选择

用户选择信息源后，在配置面板中看到 **"Sync frequency"** 下拉：

```
Sync frequency:
┌─────────────────────────────┐
│ ▾ Import once               │  ← 默认值（因 connector 而异）
│   Manual refresh            │
│   Scheduled                 │
│   Real-time ⚡  (coming soon)│  ← 灰色不可选，仅在支持的 connector 上显示
└─────────────────────────────┘
```

### 选择 Scheduled 后 — 二级配置

用户选择 "Scheduled" 后，展开 Schedule 配置面板（复用 Scheduled Agent 的组件）：

```
Sync frequency:
┌─────────────────────────────┐
│ ▾ Scheduled                 │
└─────────────────────────────┘

┌─ Schedule Settings ─────────────────────┐
│                                         │
│  🕐 Time      [09] : [00]              │
│                                         │
│  📅 Start     [Mar 2, 2026      ▾]     │
│               [Today] [Tomorrow]        │
│                                         │
│  🔁 Repeat    [Daily            ▾]     │
│               ┌──────────────────┐      │
│               │ Once             │      │
│               │ Daily            │      │
│               │ Weekly           │      │
│               └──────────────────┘      │
│                                         │
└─────────────────────────────────────────┘
```

### 已连接后 — 状态展示

```
┌──────────────────────────────────────────────┐
│  📧 Gmail - user@gmail.com                   │
│                                              │
│  Import once                                 │
│  Imported on Mar 1, 2026                     │
│                                              │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│  📝 Notion - My Workspace                    │
│                                              │
│  Manual refresh                              │
│  Last synced: 5 minutes ago                  │
│                                              │
│  [↻ Refresh now]                [⚙ Settings] │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│  📅 Google Calendar - Personal               │
│                                              │
│  Scheduled · Daily at 09:00                  │
│  Last synced: 2 hours ago                    │
│  Next sync: Tomorrow at 09:00               │
│                                              │
│  [↻ Sync now]                   [⚙ Settings] │
└──────────────────────────────────────────────┘
```

| Mode | 显示内容 | 操作按钮 |
|------|---------|---------|
| Import once | "Imported on {date}" | Settings（可升级到 Manual/Scheduled） |
| Manual | "Last synced: {time}" | Refresh now, Settings |
| Scheduled | "Scheduled · {repeat} at {time}" + "Next sync: {time}" | Sync now（手动触发一次）, Settings |
| Real-time | "Connected" / "Reconnecting..." | Settings |

### 更改 Sync Mode

用户可以在 Settings 中随时更改：

- **升级**（Import once → Manual → Scheduled）：创建或更新 sync 绑定
- **降级**（Scheduled → Manual → Import once）：移除定时任务，保留已同步数据
- 更改不影响已导入的数据内容，只改变未来的更新行为

---

## Rollout Phases

### Phase 0 — 当前状态 ✅

- Import once（所有 SaaS connector）
- Real-time（仅 OpenClaw 本地文件夹）

### Phase 1 — 架构重构 + Manual Refresh

重构为三层架构，同时为所有 SaaS connector 添加 Manual refresh。

**架构改造：**
- 统一 SyncEngine 执行引擎，所有写入走 CollaborationService
- Connector 合并为单一 `fetch()` 方法，移除 `import_data()` 和 `pull()` 双路径
- 实现 Connector Registry 自动发现机制
- 前端通过 API 动态获取 Connector 列表，移除硬编码

**功能交付：**
- 所有 SaaS connector + URL connector 支持 Manual refresh
- UI 上已连接信息源增加 "Refresh now" 按钮
- 连接信息源时增加 "Sync frequency" 选择器

### Phase 2 — Scheduled Sync

在新架构上添加定时自动同步（Trigger Layer 扩展）。

**范围：**
- "Sync frequency" 选择器增加 "Scheduled" 选项
- 选择 Scheduled 后展开 Schedule 配置面板（复用 Scheduled Agent 组件）
- APScheduler 增加 sync job 类型（复用 Scheduled Agent 调度基础设施）

### Phase 3 — Real-time Sync（预留）

按 provider 逐步添加实时同步（Trigger Layer 扩展），解锁 "Real-time ⚡" 选项。

**推荐实施顺序（按复杂度从低到高）：**

| 顺序 | Connector | 机制 |
|------|-----------|------|
| 1 | Notion | 原生 Webhook |
| 2 | GitHub | 原生 Webhook |
| 3 | Linear | 原生 Webhook |
| 4 | Airtable | 原生 Webhook |
| 5 | Google Calendar | Google Push Notification |
| 6 | Google Drive + Docs | Google Push Notification |
| 7 | Gmail | Google Cloud Pub/Sub |

---

## Open Questions

**产品层面：**

1. **Scheduled sync 是否需要付费？** — Scheduled 和 Real-time 会增加服务器成本，是否作为 Pro 功能？
2. **同步冲突处理** — 如果用户在 PuppyOne 里修改了已同步的数据，再次 sync 时如何处理？覆盖？提示？
3. **同步范围** — Scheduled 模式下，同步的数据范围是否应该可配置？（如 Gmail 只同步最近 7 天的邮件）
4. **通知** — 同步完成或失败时，是否通知用户？
5. **API 配额** — Google API 有调用配额限制，高频 Scheduled 时如何处理限流？
6. **Timezone** — 是否需要支持用户自选时区？

**架构层面：**

7. ~~**Bootstrap 首次获取仍绕过版本管理**~~ — **已修复。** Bootstrap 完成后立即调用 `SyncEngine.execute()` 填充首次数据，统一走版本管理。
8. ~~**Registry 每请求重建**~~ — **已修复。** `ConnectorRegistry` 改为应用级单例，启动时构建一次（`init_registry()`），后续请求复用同一实例。
9. **Notion API Key 回退丢失** — Notion 原有 `settings.NOTION_API_KEY` 优先于 OAuth 的逻辑，在新架构下丢失。需要在 credential resolution 层补充 API Key 回退。
10. **历史 sync 记录缺少 user_id** — `SyncEngine` 从 `sync.config.user_id` 读取用户 ID 用于 OAuth 查询，但早期创建的 sync 记录可能没有此字段。需要兼容处理。
11. **SyncService 存在死代码** — `pull_sync()` / `_pull_one()` 仍使用旧的 `connector.pull()` 路径，但 router 已改用 `SyncEngine.execute()`。后续应清理。

---
---

# Architecture Reference

以下为 Connector Sync 的技术架构设计，作为实现参考。

---

## System Architecture（系统架构图）

```
                          ┌──────────────────────┐
                          │       Frontend       │
                          │                      │
                          │  Sync Frequency UI   │
                          │  Refresh / Sync Now  │
                          └──────────┬───────────┘
                                     │ API
                                     ▼
┌────────────────────────────────────────────────────────────────────┐
│                           API Layer                                │
│                                                                    │
│  POST /sync/bootstrap          ← 创建同步                         │
│  POST /sync/syncs/{id}/refresh ← 手动刷新                         │
│  PATCH /sync/syncs/{id}/trigger← 更改同步模式                     │
│  GET  /sync/connectors         ← 获取可用 Connector 列表           │
│  POST /sync/webhook/{provider} ← 接收外部 Webhook（未来）          │
└────────────────┬───────────────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│                        SyncEngine（统一执行引擎）                    │
│                                                                    │
│   1. 接收同步信号（不管来源）                                        │
│   2. 从 Registry 查找 Connector                                    │
│   3. 获取 OAuth 凭证                                               │
│   4. 调用 connector.fetch() 取数据                                  │
│   5. 对比 content_hash 判断是否有变化                                │
│   6. 有变化 → 构造 Mutation → commit                               │
│   7. 无变化 → 跳过                                                  │
│   8. 更新 sync 记录                                                 │
│                                                                    │
└──────┬──────────────┬──────────────────┬──────────────┬────────────┘
       │              │                  │              │
       ▼              ▼                  ▼              ▼
┌─────────────┐ ┌───────────┐ ┌──────────────────┐ ┌────────────┐
│  Connector  │ │  OAuth    │ │ Collaboration    │ │  Sync      │
│  Registry   │ │  Service  │ │ Service          │ │  Repository│
│             │ │           │ │ (Write Layer)    │ │            │
│ Gmail       │ │ 凭证获取  │ │                  │ │ syncs 表   │
│ Notion      │ │ Token刷新 │ │ 版本管理         │ │ remote_hash│
│ GitHub      │ │           │ │ 冲突检测         │ │ cursor     │
│ GDrive      │ │           │ │ 审计日志         │ │ trigger    │
│ ...         │ │           │ │ 内容锁定         │ │ status     │
│             │ │           │ │                  │ │            │
│ 自动发现    │ │           │ │    ↓             │ │            │
│ Spec 查询   │ │           │ │ content_nodes 表 │ │            │
└─────────────┘ └───────────┘ └──────────────────┘ └────────────┘

       ▲
       │  定时触发
┌──────┴──────┐
│ APScheduler │
│             │
│ Sync Jobs   │
│ Agent Jobs  │
└─────────────┘
```

**核心原则：所有同步（不管触发来源）都汇入 SyncEngine 这一个入口，由它协调 Connector、OAuth、Write Layer 三者完成同步。**

---

## Core Architecture — 三层分离

三层分离是 SyncEngine 内部的逻辑分层：

```
┌─────────────────────────────────────────────────────────┐
│                     Trigger Layer                        │
│                    （什么时候取）                          │
│                                                         │
│   Manual Button  ·  APScheduler  ·  Webhook  ·  Pub/Sub │
│                                                         │
│   → 全是通用基础设施，Connector 不感知                    │
└───────────────────────────┬─────────────────────────────┘
                            │
                            │  "该取了"
                            ▼
┌─────────────────────────────────────────────────────────┐
│                    Connector Layer                       │
│                    （取什么、怎么取）                      │
│                                                         │
│   Gmail.fetch()  ·  Notion.fetch()  ·  GitHub.fetch()   │
│                                                         │
│   → 唯一职责：拿凭证、调外部 API、返回数据                │
│   → 不知道自己是被谁触发的                                │
│   → 不知道数据最终怎么存储                                │
└───────────────────────────┬─────────────────────────────┘
                            │
                            │  content + metadata
                            ▼
┌─────────────────────────────────────────────────────────┐
│                      Write Layer                        │
│                     （怎么存）                            │
│                                                         │
│   CollaborationService.commit(mutation)                  │
│                                                         │
│   → 版本管理、冲突检测、审计日志                          │
│   → 全是通用基础设施，Connector 不感知                    │
└─────────────────────────────────────────────────────────┘
```

**Connector 只有一个 `fetch()` 方法。给它配置和凭证，它返回数据。仅此而已。**

---

## SyncEngine — 统一执行引擎

SyncEngine 是连接三层的中枢，负责：

1. 从 Trigger Layer 接收"该同步了"的信号
2. 从 Connector Registry 查找对应的 Connector
3. 通过 OAuth Service 获取凭证
4. 调用 Connector 的 `fetch()` 获取数据
5. 对比 `content_hash` 判断数据是否有变化
6. 如果有变化，构造 Mutation 交给 CollaborationService
7. 更新 sync 记录（remote_hash、cursor、last_sync_version）

**不管是首次导入、定时同步、还是手动刷新，SyncEngine 走的都是同一条路径。**

---

## 三层职责详解

### Trigger Layer（触发层）

| 触发方式 | 触发来源 | 说明 |
|---------|---------|------|
| Bootstrap | 用户首次创建 sync | 创建完 sync 记录后立即执行一次 |
| Manual | 用户点击 "Refresh now" 按钮 | API → SyncEngine.execute() |
| Scheduled | APScheduler 定时任务 | 到点自动调用 SyncEngine.execute() |
| Webhook | 外部服务推送通知（未来） | 接收通知 → SyncEngine.execute() |

触发层不关心数据内容，只负责在正确的时机调用 SyncEngine。

### Connector Layer（连接器层）

每个 Connector 通过 **Connector Spec** 声明自己的元信息：

| 字段 | 说明 | 示例 |
|------|------|------|
| provider | 唯一标识 | `gmail` |
| display_name | 显示名称 | `Gmail` |
| auth | 认证方式 | OAuth / API Key / None |
| oauth_type | OAuth 类型（如需） | `gmail` |
| supported_sync_modes | 支持的同步模式 | `[import_once, manual, scheduled]` |
| default_sync_mode | 默认同步模式 | `import_once` |
| default_node_type | 数据存储类型 | `json` / `markdown` |
| config_fields | 用户可配置的选项 | label、max_results 等 |

Connector 只需实现一个方法：

- **`fetch(config, credentials) → FetchResult`** — 调用外部 API，返回数据内容和 content_hash

Connector 不持有 `node_service`、`collab_service` 等平台服务的引用，保持纯粹。

### Write Layer（写入层）

所有数据写入统一通过 CollaborationService（Mutation Protocol）：

| 职责 | 说明 |
|------|------|
| 版本管理 | 每次写入生成新版本，支持版本回溯 |
| 冲突检测 | 基于 base_version 检测并发写入冲突 |
| 审计日志 | 记录每次变更的来源（哪个 connector、什么时间） |
| 内容锁定 | 防止同一节点被多个操作同时写入 |

**关键：首次导入和后续同步走完全相同的写入路径。数据从诞生的第一刻起就有版本记录。**

---

## Connector Registry（连接器注册中心）

所有 Connector 通过 Registry 统一管理，实现自动发现和注册：

| 职责 | 说明 |
|------|------|
| 自动发现 | 扫描 connectors 目录，自动注册所有 Connector |
| 元信息查询 | 通过 provider 查询 Connector Spec |
| API 暴露 | 提供 `/connectors` API，前端动态获取可用 Connector 列表 |
| 依赖管理 | 统一管理每个 Connector 所需的依赖（OAuth service 等） |

新增 Connector 只需：

1. 在 `connectors/` 目录下创建新文件
2. 定义 Connector Spec（声明元信息）
3. 实现 `fetch()` 方法

Registry 自动发现并注册，前端自动展示，无需修改其他文件。

---

## 同步场景流程

### 场景 1：Bootstrap（首次创建同步）

```
用户点击 "Create sync endpoint"
    │
    ▼
平台执行：
    1. 创建 sync 记录
       (provider=gmail, trigger={type:scheduled, schedule:...})
    2. 创建目标 content_node（空节点）
    3. 如果是 scheduled → 注册 APScheduler 定时任务
    4. 立即执行一次 ─────────────────────────────────┐
                                                     │
                                                     ▼
                                          SyncEngine.execute(sync)
                                                     │
                              ┌───────────────────────┤
                              ▼                       ▼
                       Connector Layer          Write Layer
                              │
                    connector.fetch()
                    → 调外部 API
                    → 返回数据 + content_hash
                              │
                              ▼
                    SyncEngine 判断：
                    → sync.remote_hash 为空（首次）
                    → 构造 Mutation
                    → CollaborationService.commit()
                    → 写入节点内容
                    → 创建版本 v1
                    → 记录审计日志
                    → 更新 sync.remote_hash
                    → 更新 sync.cursor（如果有）
```

### 场景 2：Scheduled Trigger（定时触发）

```
APScheduler 到点
    │
    ▼
SyncEngine.execute(sync)       ← 和首次走的是完全同一条路径
    │
    ▼
connector.fetch(config, credentials)
    → 调外部 API
    → 返回数据 + content_hash
    │
    ▼
SyncEngine 判断：
    → sync.remote_hash ≠ result.content_hash
    → 有变化！
    → 构造 Mutation
    → CollaborationService.commit()
    → 写入新内容，创建新版本 v2
    → 记录审计日志
    → 更新 sync.remote_hash
```

### 场景 3：Manual Refresh（手动刷新）

```
用户点击 "Refresh now"
    │
    ▼
POST /api/v1/sync/syncs/{id}/refresh
    │
    ▼
SyncEngine.execute(sync)       ← 还是完全同一条路径
    │
    ▼
connector.fetch(config, credentials)
    → 调外部 API
    → 返回数据 + content_hash
    │
    ▼
SyncEngine 判断：
    → sync.remote_hash == result.content_hash
    → 没有变化，跳过写入
```

### 场景 4：Webhook（未来实现）

```
外部服务推送通知
    │
    ▼
POST /api/v1/sync/webhook/{provider}
    │
    ▼
SyncEngine.execute(sync)       ← 依然是同一条路径
    │
    ▼
connector.fetch(config, credentials)
    → 调外部 API
    → 返回最新数据 + content_hash
    │
    ▼
SyncEngine 判断：
    → 对比 hash，决定是否写入
    → 如果有变化 → commit → 新版本
```

**四个场景，同一条执行路径。唯一的区别是"谁调用了 SyncEngine"。**
