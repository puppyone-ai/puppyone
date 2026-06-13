# E2B vs Fly.io —— 实测对比(2026-06-13)

两个 provider 都已**实环境验证**(E2B:`sandbox-validation-results-2026-06.md`;Fly:`sandbox-fly-validation-2026-06.md`)。本文是验证之后的**实证对比**,聚焦四点:性能、价格、**多租户隔离**、**持久化**。

> 背景:我们的模型是「**一个 scope 一个 sandbox,scope 内多用户共享**」。所以"多租户"有两层:**跨 scope**(不同项目/scope = 不同箱)和 **scope 内多用户**(同一箱里的多个用户)。隔离与持久化要分这两层看。

## 1. 性能(实测,单次,Windows→Singapore)

| 指标 | E2B | Fly | 说明 |
|---|---|---|---|
| 冷创建 → running | **1.0s** | 6.8s(镜像已缓存;首次 ~21s) | E2B Firecracker 模板秒起;Fly 要拉镜像+起机 |
| exec 往返(5 次中位) | 406ms | **141ms** | E2B 的 `exec` 每次 `Sandbox.connect()` 重连有开销;Fly 直连 Machines API。**注:真实用法是持久 SSH 会话,二者每命令延迟都远低于此** |
| stop | **0.66s** | 3.38s | E2B pause 快;Fly stop 异步、关机较慢 |
| resume → running | **0.53s** | 1.33s | E2B connect 到 paused 快;Fly start 冷启 |

**结论**:E2B 在 create/pause/resume 上明显更快(pause-resume 是它的强项);Fly 单次 exec 更快,但这条受我们 E2B exec 实现(每次重连)影响,不代表交互式 SSH 的体感。**两者 warm 操作都在亚秒~数秒级,交互体验都可接受。**

> 口径:单次采样、跨洲网络、E2B exec 含重连开销。要严谨需多次取样 + 同区域客户端;但量级关系稳定(E2B 更快冷/热切换,Fly 更省钱见下)。

## 2. 价格

| | E2B | Fly |
|---|---|---|
| 计费 | 用量计费;**不自托管时有套餐底价**(历史 ~$150/mo 档) | 纯 pay-as-you-go,**按秒** |
| 小机器满月(类比 shared-cpu-1x 512MB) | 取决于套餐 | ~**$3.9/mo**(256MB ~$1.94) |
| **停机成本** | paused 仍占快照存储(有存储费) | **stopped ≈ $0 compute**(只剩 rootfs 存储,极低)→ scale-to-zero |
| 公网 SSH 入口 | 走 wss 代理(含在内) | 需**专用 IPv4 $2/mo/个**(或免费 `fly proxy`) |
| 自托管 | ✅ **可自托管**(只付自己基础设施) | ❌ 托管 only |

**结论**:对「多数时间 stopped、按需起」的 scope 箱,**Fly 的 scale-to-zero + 按秒计费最省**(停着几乎不花钱)。E2B 不自托管时有套餐门槛;**E2B 自托管则是成本下限**(免套餐费,但要自己运维 Firecracker/Nomad)。我们实测花费:Fly 每次测试几分钱,IPv4 $2/mo(用毕即释放)。

## 3. 多租户隔离(分两层)

### 3.1 跨 scope(不同箱)—— 都是**硬隔离**
- E2B 和 Fly **都是 Firecracker microVM**:每个 scope 的 sandbox 是独立 VM,**硬件级(KVM)隔离**,内核/内存/文件系统互不可见。这是强隔离,两者等价。
- **自托管/数据主权**:E2B 可放进**自己的基础设施**(BYOC/on-prem)→ 合规/数据不出域的唯一选项;Fly 是托管,数据在 Fly 的区域(可选 region,但不在你机房)。**对隔离/合规要求极高、要数据不出域 → E2B 自托管。**

### 3.2 scope 内多用户(同一箱)—— **软隔离(按设计)**
这是关键、也最容易误解的一点:**同一 scope 的多个用户共享同一个 OS 账号**(E2B 是 `user`,Fly 是 `puppy`)。我们做的隔离是:
- **per-user SSH key**:每人自己的公钥进 `authorized_keys`,带 `expiry-time` + `puppyone:user=<id>` 标签 → **可审计到人、短期、可单独撤销**;
- **per-user working tree**(`~/<user_id>`)+ **per-user git 身份** → push 归属到人、互不踩工作目录;
- 但**同一 UID**:严格来说同箱用户之间**不是 OS 强制隔离**(能看到彼此的进程、`~/<other_user>` 文件、sudo 都是 puppy/user)。这是「半可信的同一 scope 协作者」边界,不是「互不信任租户」边界。
- E2B 与 Fly 在这一层**等价**(都靠我们的凭证层 + git 身份,不靠 OS 多用户隔离)。

**要点**:跨 scope = VM 硬隔离(两者都强);scope 内 = 软隔离(同 UID + 凭证/身份审计)。如果将来需要 scope 内**用户间也硬隔离**,要么一人一箱(成本上升),要么真正的多 OS 用户 + 权限(更重的后续项)。

## 4. 持久化

| | E2B | Fly |
|---|---|---|
| stop/pause 保留什么 | **文件系统 + 内存快照**:resume 后**进程/RAM 状态都还原**(长跑进程跨 pause 存活) | **rootfs(磁盘)保留**,但**内存不保留**:start 是冷启,进程重跑、**文件还在** |
| 我们的 scope 工作树(git) | ✅ 跨 pause/resume 存活 | ✅ 跨 stop/start 存活(rootfs) |
| 跨 destroy | ❌ 都不保留(下次全量重 clone) | ❌ rootfs 不保;**如需跨 destroy/迁移持久 → 挂 Fly Volume**(块存储) |
| resume 语义 | 真·热恢复(秒级、状态完整) | 冷启(进程重启,但磁盘/文件在) |

**结论**:
- 我们的设计是「stop 留盘 → resume 走增量 `git fetch`」,**E2B 和 Fly 都满足**(文件跨 stop/start 都在)。
- **E2B 额外保留内存/进程**(pause-resume 是快照)→ 长跑进程、未保存的内存状态能跨 pause 存活,这是 E2B 独有优势。
- **Fly 的持久性绑在「同一台机器的 rootfs」**;要数据跨机器迁移/跨 destroy,需 **Fly Volume**。但因为我们的 scope 内容是**可从 git 重建的**,volume 非必需;真要长期持久卷,Fly Volume 是干净方案,E2B 则是 sandbox 级快照。

## 5. SSH 入口(顺带)
- **E2B**:无原生 TCP → sshd + **websocat over wss**(`wss://8081-<id>.e2b.app`),客户端 `ProxyCommand`。
- **Fly**:**原生公网 TCP**(专用 IPv4,`ssh puppy@<app>.fly.dev`)**或**免费 `fly proxy`/WireGuard 隧道。Fly 更接近"真 VPS"。

## 6. 选型建议

| 场景 | 推荐 |
|---|---|
| **默认 / 成本敏感 / 原生 SSH** | **Fly** —— scale-to-zero 最省、原生 TCP、起机 ~7s 可接受 |
| **数据主权 / 合规 / 数据不出域** | **E2B 自托管** —— 唯一能放进自己基础设施 |
| **需要秒级热恢复 / 长跑内存态跨 pause** | **E2B** —— 内存快照 pause-resume |
| **极致冷启动速度** | **E2B**(1s vs 7s) |

两者都已在我们的抽象后跑通、可由前端 provider 选择器按部署配置切换(`SCOPE_SANDBOX_PROVIDER` + 各自 creds)。**架构上 provider-agnostic**:凭证层、scope clone、session 管理对两者一致,差异只在 ConnectionInfo(E2B 带 proxy_command,Fly 直连)与持久化语义。

> 复现:`backend/scripts/scope_sandbox_bench.py`(性能);验证脚本见两份 validation 文档。
