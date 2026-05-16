# PuppyOne 文档索引

> PuppyOne 是为 AI Agent 构建的云文件系统，核心是 MUT（Managed Unified Tree）版本化文件系统。
> 本目录按架构层级组织所有设计文档。

---

## 架构全景

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Clients: Web UI / CLI / MCP / Agent / Connector / SDK    │  │
│  └────────────────────────────┬──────────────────────────────┘  │
│                               │                                 │
│  ┌────────────────────────────┴──────────────────────────────┐  │
│  │  Connectors: Datasource / Filesystem / Agent / MCP /      │  │  ← 04
│  │              Sandbox / Database → 统一 access_points 表    │  │
│  └────────────────────────────┬──────────────────────────────┘  │
│                               │                                 │
│  ┌────────────────────────────┴──────────────────────────────┐  │
│  │  Access Points: URL + Credential → Scope + Permission     │  │  ← 02
│  └────────────────────────────┬──────────────────────────────┘  │
│                               │                                 │
│  ┌────────────────────────────┴──────────────────────────────┐  │
│  │  MutOps: 统一操作入口 (write/read/delete/move)             │  │  ← 01
│  └────────────────────────────┬──────────────────────────────┘  │
│                               │                                 │
│  ┌────────────────────────────┴──────────────────────────────┐  │
│  │  MUT Handlers: Merkle tree + 3-way merge + audit          │  │  ← 01
│  └────────────────────────────┬──────────────────────────────┘  │
│                               │                                 │
│  ┌──────────────┐  ┌─────────┴────────┐                        │
│  │  S3 (blobs)  │  │  PG (控制平面)    │                        │
│  └──────────────┘  └──────────────────┘                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 阅读顺序

| # | 文档 | 内容 | 适合谁 |
|---|------|------|--------|
| 00 | [产品愿景与架构原理](architecture/00-vision.md) | 为什么做 PuppyOne？P1-P7 问题定义、MUT-native 技术决策、场景矩阵 | 新人入门、产品理解 |
| 01 | [MUT 引擎核心架构](architecture/01-mut-engine.md) | MUT 引擎如何工作：SOT 设计、S3/PG 解构、MutOps 通道模型、权限 | 后端开发、架构理解 |
| 02 | [Access Point 接入模型](architecture/02-access-points.md) | 外部客户端如何连接：URL + credential、connector 类型、权限模型 | 后端/CLI 开发 |
| 03 | [CLI 规范](architecture/03-cli.md) | MUT CLI + PuppyOne CLI 命令规范 | CLI 开发、用户文档 |
| 04 | [Connector 架构](architecture/04-connectors.md) | 统一 access_points 表、6 种 connector 类型、数据流、插件接口 | 后端/集成开发 |
| 05 | [MUT Init / Clone / Access Point](architecture/05-mut-init-clone-accesspoint.md) | init、clone、Access Point 绑定与初始化流程 | CLI/后端开发 |
| 06 | [Gateway 与 Access Point 拆分](architecture/06-gateway-access-point-split.md) | Gateway、Access Point、Git 接入边界拆分 | 后端/架构演进 |
| 07 | [Git Kernel Migration Plan](architecture/07-git-kernel-migration.md) | 移除外部 `mutai`，以 Git 为版本内核并保留 PuppyOne 协作语义 | 架构迁移、后端开发 |

---

## 文档与代码的关系

| 文档 | 对应代码模块 |
|------|------------|
| 00-vision | 产品愿景，不直接对应代码 |
| 01-mut-engine | `backend/src/mut_engine/` |
| 02-access-points | `backend/src/mut_engine/auth.py` + `access_points` 表 |
| 03-cli | `cli/` |
| 04-connectors | `backend/src/connectors/` + `access_points` 表 |
| 07-git-kernel-migration | `backend/src/mut_engine/` + Git adapters + storage ports |
