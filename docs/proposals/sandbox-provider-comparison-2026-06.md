# Sandbox Provider 深度对比:E2B vs Cloudflare Sandbox vs Modal(2026-06)

> 目的:为 PuppyOne「sandbox 作为 access point + VSCode 通过 SSH 连入 + 挂载 project scope + 成本敏感」的需求(见 [PUP-sandbox-access-point](./PUP-sandbox-access-point.md))选型。
> 数据来自三家官方文档 + 2025/2026 第三方信息,关键结论均有出处;**标注 `?` 的为官方未公开 / 未证实**,不要当事实用。
> 我们当前用的是 **E2B**(老板觉得偏贵,想评估替代)。

---

## 0. 一句话结论(按我们的用例)

| | 适配度 | 一句话 |
|---|---|---|
| **Modal** | ★★★★ | **SSH/VSCode 最直接**(原生 raw TCP,文档点名 "VS Code servers");但 **sandbox 计费是普通的 ~3 倍**、硬上限 24h(靠快照续命,而内存快照会断 TCP/SSH)。 |
| **E2B** | ★★★☆ | **隔离最强**(Firecracker)、pause/resume 优雅、**唯一可自托管**(终极降成本);但 **SSH 要自己 DIY**(sshd+websocat over wss)、$150/mo 套餐底价(不自托管时)。 |
| **Cloudflare** | ★★☆ | **bursty 最便宜**、`wrangler containers ssh` 可做 VSCode ProxyCommand;但**不能开放公网 TCP/SSH 端口**、**磁盘休眠即清空**(必须挂 R2/S3)、平台锁定不可自托管。 |

**给 PuppyOne 的初步建议**:见文末 §9。简言之——**要快、要省事且 SSH 体验好 → Modal**;**要把成本压到底或跑不可信 agent 代码 → 自托管 E2B**;**已重度用 Cloudflare 且只需"人连进去调试"而非稳定公网 SSH 端点 → Cloudflare**。

---

## 1. SSH / 网络暴露(我们的决定性维度)

| | E2B | Cloudflare | Modal |
|---|---|---|---|
| 暴露 HTTP 服务 | ✅ `getHost(port)` → `https://<port>-<id>.e2b.app`(HTTP/WS 反代) | ✅ `exposePort()` 预览 URL / 命名隧道(**仅 HTTP/HTTPS/WS/SSE**) | ✅ `encrypted_ports` → TLS URL |
| **开放原生 TCP 端口** | ❓ 未文档化(只有 HTTP/WS 代理) | ❌ **明确不支持**("Raw TCP/UDP" 列为 NOT supported) | ✅ **`unencrypted_ports=[...]` / `modal.forward(port, unencrypted=True)` → raw TCP** |
| **VSCode Remote-SSH** | ⚠️ DIY:自建 sshd+websocat,`ProxyCommand=websocat … wss://…`;**官方未文档化 VSCode 流程**,需 PoC | ⚠️ 不开端口,但 **`wrangler containers ssh`(GA)可做 OpenSSH `ProxyCommand`** → VSCode 可走;官方未明说 VSCode | ✅ **文档直接点名 "VS Code servers / SSH"**;sandbox 内跑 sshd,VSCode 指向 tunnel 的 `tcp_socket` |
| SSH 保活 | pause 会停 | **SSH 连接本身不保活容器**,要 `keepAlive`/`sleepAfter` 另管 | **活跃 TCP tunnel 会重置 idle 计时**(SSH 会话自然保活) |

**要点**:这是三家差异最大的地方。**Modal 是唯一"原生支持把 SSH 端口暴露成 raw TCP、且文档明确 VSCode 场景"的**;Cloudflare 架构是 HTTP-only,SSH 只能经 `wrangler` 隧道(适合"人调试",不适合给外部稳定 SSH 端点);E2B 能做但全靠自己拼 websocat 隧道。

---

## 2. 核心功能

| | E2B | Cloudflare | Modal |
|---|---|---|---|
| exec / 进程 | ✅ `commands.run` | ✅ `exec` + 后台进程 + 代码解释器 | ✅ `sb.exec(...)` 流式 stdout/stderr |
| 文件读写 | ✅ read/write/watch/上传下载 | ✅ 读写/目录/inotify watch/git clone | ✅ `sb.filesystem`(读≤5GB,写不限) |
| **挂载 project 文件** | ⚠️ 无 host bind-mount;烤进模板或 SDK 上传 + 快照保留 | ✅ **挂 R2/S3/GCS 为本地 FS**(持久数据靠这个) | ✅ **`modal.Volume` + `with_mount_options(sub_path=…)`** 按项目隔离(经典 Volume 仅终止时回写,v2 可 live) |
| 自定义镜像 | ✅ 模板(Dockerfile) | ✅ 自定义 Dockerfile / Docker Hub | ✅ pip/apt/Dockerfile/registry |
| 运行时/语言 | Python + JS/TS SDK | 默认 Python+Node;TS SDK(在 Worker 里) | **Python 优先**;JS/TS/Go SDK beta |
| 并发上限 | 20(Hobby)/100→1100(Pro)/Enterprise | 账户级:1500+ standard-1、thousands lite | 100(Starter)/1000(Team)容器 |

---

## 3. 持久化 / Session 生命周期(我们要"per-project 长期存活")

| | E2B | Cloudflare | Modal |
|---|---|---|---|
| 默认超时 | 5 min | `sleepAfter` 默认 10 min | 5 min |
| **最长连续存活** | **24h(Pro)** 后必须 pause | 无硬上限;`keepAlive` 可一直跑(一直计费) | **硬上限 24h** |
| pause/resume | ✅ **保存内存+FS**,resume ~1s,**pause 期间 $0** | ⚠️ DO 保状态,**磁盘休眠即清空**(fresh disk) | ⚠️ 快照:FS(永久)/目录(30d)/**内存(7d,但会断 TCP→断 SSH)** |
| 磁盘持久 | 随 pause/resume 持久 | ❌ 必须挂 R2/S3 或用 Backups | Volume 持久;sandbox 本地盘随生命周期 |
| 长期(数天/周) | pause 保留**有争议**(官方文档"永久" vs 三方"30天",**需向 E2B 核实**) | 命名隧道 URL 持久;磁盘要外置 | 靠 FS 快照(永久)续命,记快照 ID |
| 跨重启位置 | — | 可能落到**不同地理位置** | — |

**要点**:三家都不是"一个容器永生"。E2B 的 pause/resume(连内存)体验最好但 24h 要 pause 一次;Modal 24h 上限 + 快照续命,但**内存快照会断 SSH**——对"持久 SSH 开发机"是硬伤,得用 FS 快照重启(丢内存态);Cloudflare 磁盘 ephemeral,数据必须外置到 R2/S3。

---

## 4. 价格(全部 per-second;按"常驻 1 vCPU + 2 GiB,24/7"折算)

| | 计算单价 | 套餐底价 | 常驻小盒/月* | 备注 |
|---|---|---|---|---|
| **E2B** | $0.0504/vCPU-hr + $0.0162/GiB-hr | **$150/mo(Pro)** + $500/mo 高并发 | 计算 ~**$119** + $150 套餐 | pause 即 $0;Hobby 免费送 $100、20 并发、1h 上限;**自托管可免套餐费** |
| **Cloudflare** | CPU **仅按实际占用** $0.00002/vCPU-s;内存 $0.0000025/GiB-s;盘另计 | **$5/mo(Workers Paid)** | kept-alive standard-2(1vCPU/6GiB)≈ **$40+** + DO duration + egress | **bursty 最省**;但内存/盘/DO 在"醒着"时一直计费;egress $0.025/GB |
| **Modal** | **Sandbox 加价 ~3×**:CPU $0.00003942/core-s(1 core=2vCPU)、内存 $0.00000672/GiB-s | $0(Starter,送$30)/ $250(Team) | ≈ **$137**(1 core/2GiB) | **tunnel 免费**;Volume $0.09/GiB-mo(1TiB 免费);idle 缩到 0.125 core 省很多 |

\* 仅示意"单个一直开着的小盒",真实成本取决于是否 pause/缩容/并发数。

**成本要点**:
- **真正"一直开着"的开发机**:Cloudflare(缩容 + active-CPU 计费)< E2B(pause) < Modal(3× 加价)。
- **bursty / 频繁 idle**:E2B(pause→$0)和 Cloudflare(scale-to-zero)都很省;Modal 要靠快照挂起。
- **想把成本压到地板**:只有 **E2B 可自托管**(Apache-2.0 infra,自己在 GCP/AWS 跑 Nomad/Consul/Firecracker),免掉所有套餐费——代价是自己运维。
- 老板觉得 E2B 贵,主因大概率是 **$150/mo Pro 底价 + $500/mo 高并发**,而非 per-second 单价(单价其实有竞争力)。

---

## 5. 安全 / 隔离

| | 隔离技术 | 合规 | 网络管控 |
|---|---|---|---|
| **E2B** | **Firecracker microVM**(每盒独立内核,硬件级,**最强**) | SOC2 Type II;HIPAA(企业+BAA);BYOC/on-prem | 互联网访问可控;公网 URL 可加 token |
| **Cloudflare** | "每盒独立 VM"——但**具体 hypervisor 官方未命名 `?`** | SOC2 Type II、ISO 27001/27018/27701(平台级;容器是否在范围内 `?`) | 出站默认开;入站仅 HTTP;Worker 代理下发短期 JWT |
| **Modal** | **gVisor**(用户态内核,比 microVM **弱**;跑不可信多租代码时boundary 较浅) | SOC2 Type II;HIPAA(企业+BAA) | 默认无出入站;`block_network`/`outbound_cidr_allowlist` |

**要点**:若 sandbox 要跑**不可信的 agent 生成代码**,隔离强弱重要:**E2B(Firecracker)> Cloudflare(VM,技术未公开)> Modal(gVisor)**。若只是第一方开发机,三者都够。

---

## 6. 性能

| | 冷启动 | 单盒最大资源 | GPU | 区域 |
|---|---|---|---|---|
| **E2B** | ~150–200ms(resume ~1s) | 8 vCPU / 8 GiB / 20 GB | ❌ 无 | US、EU |
| **Cloudflare** | 1–3s | standard-4:4 vCPU / 12 GiB / 20 GB | ❌ | "Region: Earth" 全球就近 |
| **Modal** | ~1s(官方)/ ~150ms(三方) | 盘最大 3 TiB;核/内存上限 `?` | ✅ 多种 GPU | 未公开 `?` |

冷启动:E2B(microVM ~150ms + resume ~1s)最快;Modal ~1s;Cloudflare 1–3s。warm exec 延迟三家都未公开。

---

## 7. 易用性 / DX

| | SDK | 自托管 | 文档 / 状态 |
|---|---|---|---|
| **E2B** | Python + JS/TS,API 干净 | ✅ **可自托管**(Apache-2.0,Nomad/Consul/Firecracker;GCP 全、AWS beta) | 成熟;自托管运维门槛高 |
| **Cloudflare** | TS(在 Worker 内) | ❌ 仅平台 | 平台 **GA(2026-04-13)**,但 SDK **pre-1.0(v0.11.0,API 可能变)** |
| **Modal** | **Python 优先**(JS/TS/Go beta) | ❌ 仅云 | 文档分类清晰、质量好 |

**要点**:我们后端是 Python,**Modal(Python 优先)和 E2B(Python+JS)都顺手**;Cloudflare 要在 Worker(TS)里调,和我们的 Python 后端集成方式不一样。**只有 E2B 能自托管**(对成本和数据主权是大优势)。

---

## 8. 企业级

| | SLA | 部署形态 | 备注 |
|---|---|---|---|
| **E2B** | `?`(企业私有) | **BYOC(自己 AWS/GCP VPC)/ on-prem / 自托管**;HIPAA+BAA | 企业能力最全(尤其私有部署) |
| **Cloudflare** | 无容器专属 SLA `?` | 仅平台;私网经 Cloudflare Tunnel/One,无原生 VPC | 走 Cloudflare 大盘合规 |
| **Modal** | `?` | 仅云;企业自定义;VPC/私网 `?` | 企业自定义域名;无公开 SLA/区域 |

企业/数据主权:**E2B 明显领先**(BYOC + on-prem + 自托管);Modal/Cloudflare 都是托管。

---

## 9. 给 PuppyOne 的建议

按我们 [PUP-sandbox-access-point](./PUP-sandbox-access-point.md) 的需求(持久 per-project 盒 + VSCode SSH + 挂 scope + 成本敏感 + 可能跑 agent 代码):

**主推:`Provider 抽象 + 双轨`,不要押一家。** 我们已有 `SandboxBase` + `SANDBOX_TYPE` 抽象,正好支持按需选 provider:

1. **短期最快出活 → Modal**:SSH/VSCode 原生支持(raw TCP,文档点名 VS Code)、Python SDK 顺手、Volume 按项目挂载。代价:**3× sandbox 加价**(用 idle 缩容 + FS 快照挂起控成本)、24h 上限要靠快照、**内存快照断 SSH**(用 FS 快照重启)、gVisor 隔离较弱。**先用 Modal 把 D 组(VSCode SSH)端到端打通最省事。**

2. **中长期降成本 / 数据主权 / 跑不可信代码 → 自托管 E2B**:Firecracker 隔离最强、pause/resume 优雅、**自托管免套餐费**。代价:SSH 要自己拼(sshd+websocat),且要运维 Nomad/Consul/Firecracker。**如果成本是头等约束、且我们愿意运维,这是终局方案。**

3. **基本不推 Cloudflare**(对我们的用例):**不能开公网 SSH/TCP 端口**(只能 `wrangler` 隧道,给"人调试"还行,给产品化稳定 SSH 接入不合适)、磁盘 ephemeral 要外置、TS-in-Worker 与 Python 后端集成别扭。除非我们整体迁到 Cloudflare 生态。

**落地顺序**:先按 §C(provider 抽象泛化,见 PUP 文档)把接口加上"连接信息/端口暴露"能力 → **用 Modal 验证 VSCode SSH 闭环** → 评估成本后,决定是否并行接入"自托管 E2B"作为低成本/高隔离档。

---

## 10. 仍需核实(各家未公开/有争议)

- **E2B**:pause 保留期(永久 vs 30 天,**直接问 E2B**)、raw TCP 是否可暴露、VSCode Remote-SSH 实测、Enterprise 报价/SLA。
- **Cloudflare**:隔离 hypervisor、容器专属 SLA、容器是否在各合规报告范围内、区域钉定。
- **Modal**:单盒核/内存上限、区域/数据驻留、SLA、VPC/私有部署。
- **三家通用**:warm exec 延迟均无公开数字 —— 若延迟敏感,**自己做一轮基准测试**(创建→exec→读回 往返)。
