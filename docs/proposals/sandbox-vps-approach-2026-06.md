# VPS 自建方案可行性:对照我们要实现的 sandbox feature(2026-06)

> 承接 [PUP-sandbox-access-point](./PUP-sandbox-access-point.md)(要实现的 feature)和 [sandbox-provider-comparison](./sandbox-provider-comparison-2026-06.md)(E2B/Cloudflare/Modal 对比)。
> 本文回答:**换成「VPS 方案」是否可行 / 有优势?** 数据来自三轮深度网络调研,关键结论带出处;`?` = 未证实。

---

## 0. 先把"VPS 方案"拆成三种(可行性天差地别)

| 方案 | 是什么 | 一句话 |
|---|---|---|
| **V1. 裸 VPS,一项目一台 VM**(Hetzner 等) | 按需开/关整台 VM,scope 挂卷,每项目独占一台 | **常驻最便宜 + SSH 原生**,但开机慢(需 warm pool)、生命周期/编排自己写、隔离=整台 VM |
| **V2. Fly.io Machines(托管 microVM,VPS-like)** | Firecracker microVM,API 秒级开关,**scale-to-zero**,自带 sshd 暴露 | **"VPS 的优势 + 托管的省心"——本场景最佳落点** |
| **V3. 自建 microVM 沙箱**(fork E2B / Kata-on-K8s,跑在裸金属) | 自己搭 Firecracker/Kata + 编排 + warm pool + 网络 | **小团队的陷阱**:6–18 人月 + 永久 on-call,过了很高规模才值 |

**核心洞察:VPS 路线对我们最大的吸引力,是"SSH 原生"——我们最难的 D 组(VSCode Remote-SSH)在 VPS/Fly 上是免费自带的;而 managed 里 E2B 要 DIY、Cloudflare 干脆开不了公网端口。** 但 V1 的隐藏代价是开机慢 + 要自己造编排;真正划算又省心的是 **V2(Fly Machines)**。

---

## 1. 逐 Feature 对照(我们的 A–E × 各方案)

> 我们的 feature(见 PUP 文档):**A** 持久实例 · **B** session 生命周期(start/kill/restart/idle 回收)· **C** provider 抽象 · **D** VSCode SSH · **E** 可观测。

### D. VSCode 通过 SSH 连接(我们最难、也最能拉开差距的一项)

| | 能不能 SSH | 怎么做 | 评价 |
|---|---|---|---|
| **V1 裸 VPS** | ✅ **原生** | VM 本身就是 SSH 盒子,VSCode Remote-SSH 开箱即用;公网 IPv4 Hetzner €0.50/mo | **最省事** |
| **V2 Fly Machines** | ✅ **一等公民、官方文档** | sshd 跑内部 2222 → Fly Proxy 暴露成 22;`code` 连 `user@app.fly.dev`;需专用 IPv4(~$3.60/mo)或走 6PN/WireGuard | **官方有 blueprint,最对口** |
| E2B(现用) | ⚠️ DIY | 自建 sshd + websocat over `wss://`,VSCode 流程官方没文档 | 要 PoC |
| Modal | ✅ | `unencrypted_ports=[22]` raw TCP,文档点名 VS Code | 好 |
| Cloudflare | ⚠️ | 开不了公网端口,只能 `wrangler containers ssh` 当 ProxyCommand | 仅"人调试" |

→ **VPS 路线(V1/V2)在 D 上原生胜出。** 这是 VPS 方案最大的优势,直接消掉我们最难的需求。

### B. Session 生命周期

| | start/stop | 开机延迟 | idle 回收 | 评价 |
|---|---|---|---|---|
| **V1 裸 VPS** | 有 API(Hetzner 3600 req/hr 等) | **15–30s 冷启**(最快的 Hetzner) | **自己写 controller + reaper** | 慢 + 要自建,**必须 warm pool** |
| **V2 Fly Machines** | ✅ create/start/stop/**suspend**/destroy API | **停机→启动 ~10–150ms**(本地~10ms) | 自带 `auto_stop`/`min_machines_running` | **接近 managed 的体验** |
| E2B/Modal | SDK | <1s(resume/fork) | 内置 | 最省心 |

→ **V1 的痛点在这:裸 VM 冷启动以"秒/分钟"计,要"现在给我个盒子"的交互体验,必须预热一池闲置 VM(warm pool),而 warm pool 的闲置成本可能吃掉省下的钱。V2 用 microVM snapshot 把这个问题解决了。**

### A. 持久实例 + 挂载 scope

| | 实例持久 | 挂 project 文件 |
|---|---|---|
| **V1 裸 VPS** | VM 在就一直在(付闲置费)或挂块存储 | 块存储卷/项目(Hetzner €0.0572/GB-mo),或快照 |
| **V2 Fly Machines** | **rootfs 跨 stop/start 保留**;停机只付存储(~$0.15/GB-mo) | Fly Volumes($0.15/GB-mo) |
| E2B | pause/resume 存内存+FS,24h 上限 | 烤进模板/上传 |
| Modal | 24h 上限 + 快照续命(内存快照断 TCP→断 SSH) | Volume 按项目 sub_path |

→ V1/V2 都能"挂卷 + 长期存活";V2 还能 scale-to-zero 省成本。比 E2B/Modal 的 24h 上限 + 快照舞蹈更自然(尤其对"长期挂着的 SSH 开发机")。

### C. Provider 抽象

我们已有 `SandboxBase` + `SANDBOX_TYPE`。接 V1/V2 都是**新加一个 adapter**,但接口要补**「连接信息(host/port,给 SSH)」**(现在接口是 JSON-edit 遗留)。V2(Fly)的 adapter 比 V1 简单得多(不用自己管 warm pool/网络/隔离)。

### E. 可观测
V1/V2 都要自己接活动日志 / 用量(修 GAP-8);V2 有 Fly 的指标/日志可借力,V1 全自建。

---

## 2. 成本对比(常驻 1 vCPU / 2 GB,及 bursty)

| 方案 | 常驻 24/7 | 多数时间 idle | 备注 |
|---|---|---|---|
| **V1 Hetzner CX23(2/4)** | **~$4.3/mo** | 仍付整机(除非销毁) | 含 20TB 出流量;**出流量 ~$1/TB(AWS 是 $90/TB)** |
| **V2 Fly Machines(2GB)** | ~$11.9/mo | **~$1–3/mo**(停机只付 ~$0.75 存储) | per-second + scale-to-zero |
| E2B Pro | ~$210/mo(**$150 底价**主导)| 按秒,idle 便宜 | 小规模被底价拖累 |
| Modal sandbox | ~$137–300/mo(**3× 加价**) | 按秒 + 快照挂起 | tunnel 免费 |
| Cloudflare | ~$40–53/mo(kept-alive) | scale-to-zero 很省 | 开不了 SSH 公网口 |

**量级**:
- **常驻盒**:Hetzner(~$4)<< Fly(~$12)<< E2B(~$210,**约 20–50×**)< Modal(~$300,**约 60–70×**)。
- **bursty/多 idle**:Fly(停机→近 $0)、Cloudflare(scale-to-zero)、E2B/Modal(按秒)都便宜;V1 裸 VPS 反而吃亏(不销毁就一直付,warm pool 还要额外付)。

→ **VPS 路线对"长期挂着的开发机"便宜得多;managed/Fly 对"很多短命、多数 idle 的盒子"更省。**

---

## 3. 隔离(若跑 agent 生成 / 半可信代码,这是硬约束)

调研的硬结论:**容器(Docker/runc)不是安全边界**——共享内核,一个内核 CVE 就穿透同主机所有租户。半可信代码的合理目标是**每租户一个内核**:

| 方案 | 隔离 | 评价 |
|---|---|---|
| **V1 裸 VPS,一项目一 VM** | 整台 VM 独占 = 强隔离 | 简单粗暴但贵(每项目一台,idle 也付) |
| **V1 共享 VPS + 多租户** | ❌ 裸容器无内核隔离 | **不能直接跑半可信代码**,得自建 Kata/Firecracker/gVisor → 滑向 V3 |
| **V2 Fly Machines** | **Firecracker microVM/台**,硬件隔离 + SOC2 | **免费拿到强隔离** |
| E2B | Firecracker(最强) | |
| Modal | gVisor(较弱) | |

→ **V2(Fly)= 不花隔离的工程就拿到 microVM 级隔离**;V1 想省钱共享主机就得自建隔离(=V3 陷阱)。

---

## 4. 自建(V3)的真相 —— 小团队的陷阱

调研一致结论:
- **裸容器不够**,半可信代码要 Kata/Firecracker microVM(每租户独立内核)。
- **E2B 自建栈(Nomad+Consul+Firecracker)是 GCP-first / AWS-beta,没有 turnkey 的 Hetzner/on-prem 路径**;搬到 Hetzner **裸金属**(不是 Cloud VPS,要嵌套虚拟化)= 自己重写它的 Terraform/密钥/网络,是"硬 fork",不是 `terraform apply`。
- 真正难的不是开机,而是:**microVM snapshot 快速恢复、warm pool 右配(闲置成本可能超过 managed 的加价)、并发下 CNI 网络(实测 +263% 启动延迟)、镜像分发惊群、短期 SSH 凭证、永久的内核 CVE 打补丁 + 多租户爆炸半径责任**。
- 量级:做到**合规级 12–18 人月 + 专职安全**,被判定"只对要做 AWS Lambda 竞品或垂直云的团队才 ROI 为正"。
- **什么时候才值**:持续高并发、利用率高(warm pool 不浪费),且 managed 账单稳定超过自有裸金属(Hetzner AX ~$200/mo/96vCPU)若干倍、并且有专职平台/安全负责人。否则是陷阱。

---

## 5. 结论 + 建议

**「换成 VPS 方案」是否可行 / 有优势?**

- **可行,且对我们的核心需求(VSCode SSH)有原生优势** —— 但**最优形态不是裸 VPS 自建,而是 Fly.io Machines(V2)**:它把 VPS 的优势(原生 SSH、整盒控制、便宜、可挂卷长期存活)和 managed 的省心(秒级 API、scale-to-zero、Firecracker 隔离)合到一起,**正好把我们最难的 D 组(VSCode SSH)变成一等公民**,且 month-cost 比 E2B/Modal 低一个量级。
- **裸 VPS(V1)** 只在"少量、长期常驻、可接受自建 controller + warm pool + 一项目一台"时,成本最低(Hetzner ~$4/mo)。它的代价是开机慢、编排自建、多租户隔离要么"一项目一台"(贵)要么自建(=V3)。
- **自建 microVM 栈(V3)** 现在不要碰 —— 小团队陷阱,除非规模/合规/数据主权硬到跨过门槛并配了专职负责人。

**推荐落地(配合我们已有的 `SandboxBase` 抽象):**
1. **provider 抽象先泛化**(PUP §C):接口补"连接信息/端口暴露",去掉 data.json 包袱。
2. **用 Fly.io Machines 做主力 + 打通 VSCode SSH 闭环**(PUP §D):官方有 sshd blueprint,最快验证;Firecracker 隔离够跑半可信代码;scale-to-zero 控成本。
3. **(可选)Hetzner 一项目一 VM 作为"低成本常驻档"**:对长期挂着、低并发、强隔离要求高的项目,用裸 VPS + 块卷,成本压到地板;但要自己写 start/stop/reaper + warm pool。
4. **E2B 留作对照/备份 provider**(已有),或在需要其 pause/resume 内存态时用。
5. **暂不自建 microVM fabric。**

> 一句话:**VPS 路线的"对"的打开方式是 Fly.io Machines —— 它就是"带 API 的 VPS",原生 SSH、便宜、microVM 隔离、秒级开关,恰好补上 E2B 在 SSH 上的短板;裸 Hetzner 适合做低成本常驻档;自建 microVM 栈是规模没到时的陷阱。**

---

## 6. 风险 / 待核实

- **Fly 可靠性**:有 2024/2025 多起事故记录 + 社区"Reliability: It's Not Great"。开发沙箱(非对外生产)可接受,但别把单台 Machine 当高可用;要做重启/迁移容错。
- Fly 单 Machine 最长存活上限 `?`(模型上是无限,可一直 stop/start)。
- 裸 VPS 多租户跑用户代码可能触发 provider AUP/滥用检测;实例默认配额低(需工单提额)。
- 各家 warm exec 延迟、Fly suspend 恢复毫秒数、HIPAA/ISO 细节均 `?` —— 选定后**自己跑一轮基准**(创建→exec→SSH 实连往返)。
- 我们若要跑**不可信** agent 代码,隔离必须是 microVM(Fly/E2B/自建 Kata),不能用共享容器。
