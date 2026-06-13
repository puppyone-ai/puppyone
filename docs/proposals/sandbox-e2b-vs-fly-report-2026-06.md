# Scope-Sandbox Provider 对比分析报告:E2B vs Fly.io

**日期**:2026-06-13 · **作者**:平台/版本引擎组 · **状态**:两 provider 均实环境验证完毕
**范围**:为 V2「sandbox 即访问面」(scope-keyed 远程开发箱,VSCode Remote-SSH 接入)选型
**关联**:`sandbox-validation-results-2026-06.md`(E2B)、`sandbox-fly-validation-2026-06.md`(Fly)、`sandbox-e2b-vs-fly-2026-06.md`(精简版)、`sandbox-provider-comparison-2026-06.md`(选型前调研)

---

## 0. 执行摘要(结论先行)

- **两者都已跑通**,且都是 **Firecracker microVM**,跨 scope 之间是**硬件级(KVM)隔离**。在我们的抽象后,凭证层 / scope clone / session 管理对两者完全一致,差异只在**连接方式**与**持久化语义**。
- **默认推荐 Fly**:scale-to-zero(停机几乎不花钱)+ 按秒计费 + **原生公网 TCP SSH**,运营最省心、成本最低,冷启 ~7s 可接受。
- **数据主权 / 合规 / 数据不出域 → E2B 自托管**:这是 E2B **唯一不可替代**的能力(可放进自有基础设施)。
- **需要秒级热恢复(内存态跨 pause 存活)→ E2B**:pause/resume 是内存快照,resume ~0.5s 且进程不丢。
- **关键澄清(多租户)**:我们的隔离是**两层**——跨 scope = VM 硬隔离;**scope 内多用户 = 软隔离**(同一 OS 账号 + per-user 密钥/身份/工作树,审计到人,但**非 OS 强制的用户间隔离**)。两 provider 在 scope 内这一层**等价**,都不提供 OS 级的用户间隔离。

---

## 1. 方法论与口径

- **被测对象**:生产代码本身——`E2BProvider`(包 `e2b` SDK)与 `FlyMachinesProvider`(Fly Machines REST API),经同一 `SandboxProvider` 抽象。
- **性能脚本**:`backend/scripts/scope_sandbox_bench.py`,对两者跑同一序列:create→running、exec×5(取中位)、stop、resume→running、destroy。
- **环境**:客户端 Windows(中国),provider 区域 **Singapore(sin)**;Fly 机器 `shared-cpu-1x:512MB`;E2B 默认模板。
- **样本**:**单次采样**(成本/时间考量)。量级关系稳定,但绝对值受跨洲网络、单次抖动影响。**要做容量/SLA 决策需多次取样 + 同区域客户端复测。**
- **花费纪律**:每次测试用最小机器、用毕即销毁;公网测试临时分配 IPv4($2/mo)用毕即释放。全过程实测花费控制在 $5 内。

---

## 2. 性能(实测)

| 指标 | E2B | Fly | 解读 |
|---|---:|---:|---|
| 冷创建 → running | **1.0 s** | 6.8 s | E2B Firecracker 模板秒级启动;Fly 需拉取镜像层 + 启动 microVM(首次未缓存 ~21s,缓存后 ~7s) |
| exec 往返(5 次中位) | 406 ms | **141 ms** | ⚠️ E2B 数字偏高是**我们实现**所致:`SdkE2BClient.exec` 每次 `Sandbox.connect(id)` 重连;Fly 是一次 HTTP POST。**交互式 SSH 会话里二者每命令延迟都远低于此**,不代表体感 |
| stop | **0.66 s** | 3.38 s | E2B `pause` 快;Fly `stop` 异步关机较慢 |
| resume → running | **0.53 s** | 1.33 s | E2B `connect` 到 paused 秒回;Fly `start` 冷启 |

**分析**:
- **冷/热切换 E2B 全面更快**(create 1s、resume 0.5s)——pause/resume 是 E2B 的核心强项,适合「频繁开合、要求秒回」的交互。
- **Fly 冷启 ~7s** 一次性,之后常驻;对「连进去用一段时间」的工作流完全可接受,且可用「保温窗口 + reaper」摊薄。
- **exec 延迟**不应据此判 Fly 优于 E2B:真实路径是用户的持久 SSH 会话(命令延迟≈网络 RTT),exec 仅用于 server 侧 provisioning;两者都够快。
- **改进点(E2B)**:`SdkE2BClient.exec` 每次重连可优化为复用句柄,能显著降其 exec 延迟(已在对比中标注,属后续优化项)。

---

## 3. 价格

### 3.1 计费模型(结构)

| 维度 | E2B | Fly |
|---|---|---|
| 计费方式 | 用量(按秒 compute);**托管版有套餐底价**(历史 ~$150/mo 档,**请以官网当前为准**) | 纯 pay-as-you-go,**按秒** |
| 运行中 compute | 按 vCPU/RAM·秒 | shared-cpu-1x:256MB≈$1.94/mo、512MB≈$3.89/mo(24/7 折算,**列表价,需核**) |
| **停机** | paused 仍占**快照存储**(有存储费) | **stopped ≈ $0 compute**(仅 rootfs,极低)→ 真 scale-to-zero |
| 持久卷 | sandbox 级快照 | Fly Volume ≈ $0.15/GB·mo(**需核**) |
| 公网 SSH 入口 | 含在内(wss 代理) | **专用 IPv4 $2/mo/个**(或免费 `fly proxy`/WireGuard) |
| 出网带宽 | 视套餐 | 按 GB(区域定价,**需核**) |
| **自托管** | ✅ 只付自有基础设施(免 E2B 费) | ❌ 托管 only |

> ⚠️ 所有具体数字为**列表价快照**,会变动;落地预算前请核对官网当前定价。本节重点是**成本结构**,它比绝对数字稳定。

### 3.2 worked example(我们的真实用量形态)

设:一个组织 **20 个 scope**,每个 scope 平均每天被用 **3 小时**,其余时间 stopped;机器 `shared-cpu-1x:512MB`。

- **Fly**:每箱 3/24 ≈ 12.5% 在线 → 512MB 满月 ~$3.89 × 12.5% ≈ **$0.49/箱·mo** → 20 箱 ≈ **$10/mo** + 停机 rootfs(可忽略)+ SSH 走免费 `fly proxy`(或少量专用 IPv4)。**月成本约 $10–$15。**
- **E2B(托管)**:若有 ~$150/mo 套餐底价,则**底价主导**,20 个低频 scope 的边际 compute 很小,但**月成本 ≥ 套餐底价**(数量级 $150+)。
- **E2B(自托管)**:无 E2B 套餐费,只付你自己的 Firecracker/Nomad 集群基础设施 + 运维人力。**在足够规模下单位成本最低**,但有运维门槛。

**结论**:
- **中小规模 / 低频 scope** → **Fly 显著更省**(scale-to-zero 让停机几乎免费)。
- **大规模 + 愿意自运维** → **E2B 自托管**单位成本可压到最低。
- 我们实测:Fly 每次测试**几分钱**,IPv4 $2/mo(用毕释放)。

---

## 4. 多租户(本报告重点)

我们的模型:**一个 scope 一个 sandbox,scope 内多用户共享同一个箱**。因此「多租户」必须**分两层**讨论。

### 4.1 第一层:跨 scope(不同箱)——**硬隔离**

- E2B 与 Fly **都是 Firecracker microVM**:每个 scope 的 sandbox 是**独立 VM**,KVM 硬件虚拟化,内核/内存/文件系统互不可见。**这是强隔离边界,两者等价。**
- 一个 scope 的用户**无法触及另一个 scope 的箱**(不同 VM、不同凭证、不同 git remote access_key)。
- **数据主权**:E2B 可部署进**自有基础设施**(BYOC/on-prem)→ 数据不出域、满足强合规;Fly 为托管,数据落在 Fly 选定 region(不在你机房)。**这是合规场景下 E2B 不可替代的点。**

### 4.2 第二层:scope 内多用户(同一箱)——**软隔离(按设计)**

⚠️ **最容易误解、也最需要写清楚的一点**:同一 scope 的多个用户**共享同一个 OS 账号**(E2B=`user`,Fly=`puppy`)。我们提供的是:

| 机制 | 作用 | 强度 |
|---|---|---|
| per-user SSH 公钥进 `authorized_keys`,带 `expiry-time` + `puppyone:user=<id>` 标签 | 短期、可单独撤销、**审计到人**(离职即失权) | 凭证级 |
| per-user working tree(`~/<user_id>`)+ per-user git 身份 | push 归属到人、互不踩工作目录 | 约定级 |
| sshd 硬化(publickey-only、`UsePAM no`) | 杜绝「none 认证」绕过,访问严格 = 你的 authorized_keys 行 | 认证级 |

**但是同一 UID**:严格说,同箱用户之间**不是 OS 强制隔离**——他们能看到彼此的进程、读写 `~/<other_user>` 下的文件、`sudo` 都是同一账号。这是 **「半可信的同一 scope 协作者」** 边界,**不是「互不信任租户」** 边界。

**威胁模型对照**:
- ✅ 防得住:外部未授权者(无 key 进不来)、离职者(撤 key 即断)、误操作归属不清(git 身份 + key 标签可审计到人)。
- ❌ 防不住(当前设计内可接受):**同 scope 内一个用户主动窥探/篡改另一个用户的进程或文件**(同 UID)。
- **E2B 与 Fly 在这一层等价**——都靠我们的凭证层 + git 身份,**都不依赖 OS 多用户隔离**。

**若将来需要 scope 内也硬隔离**(把同 scope 用户当互不信任):
1. **一人一箱**(每个 (scope,user) 一个 microVM)——最强,但成本随用户数线性上升、丢失「共享工作区」语义;
2. **真正的多 OS 用户 + 文件权限 + 限制 sudo**——VM 内软隔离增强,工作量大;
3. 维持现状——对「同一团队协作同一 scope」是合理且常见的边界。

### 4.3 审计

两者都通过 provider.exec / SSH 操作,凭证签发/撤销、连接、git push 都可落审计(`audit_logs`,operator 区分 user/admin/system)。归属粒度 = per-user key + git identity。

---

## 5. 持久化

| 维度 | E2B | Fly |
|---|---|---|
| stop/pause 保留 | **文件系统 + 内存快照** | **rootfs(磁盘)**,内存**不**保留 |
| resume 语义 | 真·热恢复:进程/RAM 状态完整还原(秒级) | 冷启:进程重跑,**文件还在** |
| 我们的 scope 工作树(git) | ✅ 跨 pause/resume 存活 | ✅ 跨 stop/start 存活(rootfs) |
| 「留盘→增量 fetch」设计 | ✅ 满足 | ✅ 满足 |
| 跨 destroy | ❌ 不保留(下次全量 clone) | ❌ rootfs 不保;**跨 destroy/迁移持久 → 挂 Fly Volume** |
| 长跑进程跨 stop | ✅(内存快照里) | ❌(冷启会重启进程) |

**分析**:
- 我们的核心设计是「stop 留盘,resume 走增量 `git fetch`」——**两者都满足**(文件跨 stop/start 都在)。
- **E2B 独有**:内存/进程快照——未保存的内存态、长跑进程能跨 pause 存活。对「挂着一个 dev server / REPL,离开再回来还在」的体验更好。
- **Fly 的持久绑在「同一台机器的 rootfs」**;要数据**跨机器迁移或跨 destroy**,用 **Fly Volume**(干净的块存储方案)。但因为我们的 scope 内容**可从 git 重建**,Volume 非必需。
- **取舍**:E2B 快照 = 体验更"有状态";Fly rootfs+Volume = 更"显式、可控"的持久。对我们的 git-为真相 模型,两者都够用。

---

## 6. 连接方式与架构契合

| | E2B | Fly |
|---|---|---|
| 原生 TCP 入口 | ❌ 无 → sshd + **websocat over wss**(`wss://8081-<id>.e2b.app`),客户端 `ProxyCommand` | ✅ **原生公网 TCP**(专用 IPv4)**或**免费 `fly proxy`/WireGuard |
| `ConnectionInfo` | 带 `proxy_command`(websocat) | 直连 `host=<app>.fly.dev:22`,`proxy_command=None` |
| sshd 部署 | **运行时** provision(`ssh_e2b`,装 sshd+websocat,运行时硬化) | **烤进镜像**(`sandbox/scope-fly/`),开机即 publickey-only sshd |
| VSCode Remote-SSH | 用 websocat 当 `ProxyCommand` | 直连 / 或 `fly proxy` 当 `ProxyCommand` |

**架构契合**:抽象做到了 **provider-agnostic**——凭证层(`ssh_credentials`)、scope clone(`scope_provision`)、session 管理(`manager`)、reaper、持久 store 对两者完全一致;前端 provider 选择器按部署配置(`SCOPE_SANDBOX_PROVIDER` + 各自 creds)切换。**切 provider 是配置改动,不是代码改动。**

---

## 7. 运营 / 可维护性

| | E2B | Fly |
|---|---|---|
| 运维负担(托管) | 低 | 低 |
| 运维负担(自托管) | **高**(自管 Firecracker/Nomad/Consul) | 不适用(无自托管) |
| SSH 入口运维 | websocat 转发器(需 `nohup` 脱离,曾踩坑) | 原生,或 `fly proxy`(零配置) |
| 镜像/模板 | 自定义模板(烤入 sshd+websocat 可省运行时安装) | 远程构建推送(无需本地 Docker),开机即就绪 |
| 区域 | 多区 | 多区(注意:`hkg` 已废弃,用 `sin`) |
| 计费可控性 | 套餐/用量 | **无硬性消费上限**(Fly 已知缺陷),靠 credit 预充 + Cost Explorer 盯 |

---

## 8. 验证中发现并修复的真问题(合并)

| # | provider | 问题 | 修复 |
|---|---|---|---|
| 1 | E2B | 默认模板 sshd 接受 **SSH `none` 认证**(任何人无视 authorized_keys 进入) | `ssh_e2b` 释放 systemd socket 占用的 :22,起自己的 publickey-only sshd(`AuthenticationMethods publickey`/`UsePAM no`) |
| 2 | Fly | 镜像 `useradd` 默认**锁定**账号,OpenSSH 10 在 `UsePAM no` 下拒锁定账号 key 认证 | Dockerfile `usermod -p '*' puppy` 解锁(仅 key 登录) |
| 3 | Fly | `hkg` region 已废弃 → create 400 | 用 `sin` |
| 4 | Fly | `stop` 异步,紧接 `start` 返回 412 | `start()` 容忍 412 → 等 `stopped` → 重试 |
| 5 | E2B | SDK 无 `resume`,`connect(id)` 即 resume | `SdkE2BClient` 对齐真实 SDK |

> 这些都是**实环境测试才暴露**的——尤其 #1/#2 是**安全相关**(都会让访问控制形同虚设),验证的价值在此。

---

## 9. 选型矩阵与建议

| 场景 / 约束 | 推荐 | 理由 |
|---|---|---|
| **默认 / 成本敏感 / 低频 scope** | **Fly** | scale-to-zero、按秒、原生 SSH,~$10–15/mo 量级 |
| **数据主权 / 合规 / 数据不出域** | **E2B 自托管** | 唯一能放进自有基础设施 |
| **极致冷启动 / 频繁开合** | **E2B** | create 1s、resume 0.5s |
| **长跑内存态需跨 pause 存活** | **E2B** | 内存快照 pause/resume |
| **大规模 + 愿自运维** | **E2B 自托管** | 单位成本下限 |
| **想要"真 VPS"式原生 TCP** | **Fly** | 原生公网 TCP :22 |

**落地建议**:
1. **默认 provider = Fly**(已设为 `SCOPE_SANDBOX_PROVIDER` 默认前我们设的是 e2b——见说明),前端选择器允许企业/项目按需切到 E2B 自托管。
   > 注:当前代码默认 `e2b`(实环境验证最久的路径);若以成本/原生 SSH 为先,可将默认改为 `fly`。两者皆已验证,改默认仅一行配置。
2. **合规客户**:提供 E2B 自托管部署选项。
3. **成本护栏**:Fly 无硬上限 → 预充 credit + 监控;reaper 务必开启(stop 省钱)。
4. **后续优化**:E2B exec 复用句柄降延迟;Fly 公网生产需专用 IPv4(或统一走 `fly proxy`)。

---

## 10. 复现与附录

- 性能:`python -m scripts.scope_sandbox_bench`(同时跑两者,读 `backend/.env` creds)。
- E2B SSH/凭证:`scripts/ssh_credentials_live.py`、`scripts/e2b_ssh_demo.py`。
- Fly:`scripts/scope_sandbox_fly_smoke.py`(生命周期)、`scripts/fly_ssh_e2e.py`(proxy SSH)、`scripts/fly_ssh_public_e2e.py`(公网 :22)、`scripts/fly_vscode_check.py`(VSCode 就绪)。
- 原始数据(2026-06-13,单次,sin):create E2B 1.0s/Fly 6.8s;exec(中位)E2B 406ms/Fly 141ms;stop E2B 0.66s/Fly 3.38s;resume E2B 0.53s/Fly 1.33s。
- 详见 `sandbox-validation-results-2026-06.md`、`sandbox-fly-validation-2026-06.md`。

> **声明**:价格为列表价快照、性能为单次采样,均需在落地前用当前官网定价 + 多次/同区域复测核实。隔离与持久化的**机制性结论**(VM 硬隔离 / scope 内软隔离 / 快照 vs rootfs)是稳定的。
