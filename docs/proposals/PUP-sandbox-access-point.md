# PUP — Sandbox 作为 Access Point(企业数据治理 + Session 管理 为核心)

> 状态:**Feature 梳理 v2(尚未实现)**。v1 偏"造个能跑命令的盒子";v2 按老板的真实诉求重写——**核心是企业对员工数据的治理,以及 session 管理的成本/时效 trade-off**。
> 相关:[provider 对比](./sandbox-provider-comparison-2026-06.md) · [VPS 方案可行性](./sandbox-vps-approach-2026-06.md)。结论:**主力 Fly.io Machines,E2B 作可自托管/合规档,两版本用户可选。**

---

## 1. 动机 / 愿景 —— 这是为企业数据治理做的

老板关心的不是"沙箱本身",而是**企业希望员工的工作内容落在企业可管理的范围内,而不是员工自己的 PC / 设备上**。把工作放进我们托管的 sandbox 后:

- **数据始终在我们这(server 端),从不落到员工的设备**——企业放心。
- **员工离职 → 自动失去对应 PuppyOne repo 的权限**;我们可以把对应 sandbox **kill / 回收 / 拒绝该用户访问**。
- 员工**通过 sandbox 连接 access point** 之后,**所有操作——包括 git remote 和 fs 的 CLI——都在这个 sandbox 内执行**,而不是在员工本地。

所以 **sandbox 不是一个"计算玩具",而是"企业可治理的唯一工作执行面 + 数据边界"**。这是这个 feature 的根本价值,所有设计都要服务于它。

---

## 2. 核心模型

### 2.1 通过 sandbox 接入 = 所有访问都在 sandbox 内执行
- 员工不在本地 `git clone`,而是**经 VSCode Remote-SSH 连进该 scope 的 sandbox**,在里面工作。
- sandbox 内**预置了 scope 的 access 凭证(server 侧持有,员工看不到原始 access key)**:git remote 指向我们 server、CLI(AP-FS)对该 scope 操作。
- 员工的所有读写都经 sandbox → 我们 server。数据不经过、不留存在员工设备。

### 2.2 Sandbox 按 scope 共享(不是 per-user)
- **同一 scope 下的多个用户(同企业 / 同 repo)共用一个 sandbox**。
- 关系:**一个活跃 scope ↔ 至多一个活跃 sandbox**。用户级的差异体现在"能不能连进来 + 连进来后的权限",而不是各开各的盒子。
- **共享 = 共享计算 + 共享 repo 对象缓存(省 re-pull),但每个用户在盒内有自己的 working tree + 自己的 git 身份/auth**。
- **写并发不需要 sandbox 层加锁** —— 和没有 sandbox 时一样,由 PuppyOne 的 git 协议 / Version Engine 在 server 端解决(push 时 LWW/merge/冲突策略)。各用户在各自 working tree 改 → push → server 解决冲突,模型与今天完全一致。
- sandbox 在共享模型里真正要保证的是:**每个用户的 git 操作带其本人身份/auth**(push 归属到人、审计到人、离职撤权干净),而不是并发锁。

### 2.3 Server 是 source of truth → sandbox 可随时关停而不丢数据
- 一切走 **git 协议**,canonical 内容**同步在 server 端**;sandbox 只是**工作副本 + 执行环境**。
- 因此 **sandbox 被销毁 = 不丢任何数据**。这是"敢于回收 sandbox 省成本"的前提。

### 2.4 VSCode SSH 接入(是手段,不是难点)
- 员工从 VSCode 经 SSH 连入 scope sandbox。Fly 原生支持(官方 blueprint),E2B 需 DIY 隧道。
- **明确:难点不在"起 sandbox"也不在"SSH 连入",而在 §3 的 session 管理。**

---

## 3. Session 管理(本 feature 的核心难点)

**问题本质**:一个 scope 的 sandbox 该一直开着,还是 idle 了就关?
- **不每次都关**:关了再起,要**重新全量 pull** 整个 repo,耗时长、体验差。
- **可以关**:走 git 协议、source of truth 在 server,关掉**不丢数据**。
- 所以这是一个**「warm 的闲置成本」vs「cold 重启的时延 + 全量 pull 成本」**的权衡,需要**好的 metrics 来动态判断**。

### 3.1 三态模型(关键:区分 stop 与 destroy)
| 态 | 计算 | 工作副本(磁盘/卷) | 重启代价 | 成本 |
|---|---|---|---|---|
| **active** | 运行 | 在 | — | 全额计算 |
| **stopped**(留盘) | 停 | **保留** | **快**:增量 `git fetch` | 仅存储(很低) |
| **destroyed**(全清) | 无 | 清 | **慢**:**全量 pull** | $0 |

> **关键优化:计算与存储解耦。** idle 时优先 **stop(只停计算、留工作副本卷)** 而不是直接 destroy——重启走增量 fetch,避开全量 pull;只有"长期不用 / 资源紧张 / 用户离场"才 **destroy**(连卷一起回收)。Fly Machines(rootfs 跨 stop/start 保留 + Volumes)、E2B(pause/resume 保 FS)都支持这个区分。**这一条直接把"重启要全量 pull"的痛点降到只在真正驱逐时才发生。**

### 3.2 决策用的 metrics(每个 scope-sandbox 维护)
- `last_active_at` —— 最近一次活动(SSH 连接 / 命令 / git 操作)时间(**recency**)。
- `activity_rate` —— 滚动窗口内的活动频率(ops/小时)(**frequency**)。
- `active_user_count` / `recent_user_count` —— 当前在连 + 近期用过的用户数(共享 scope,人越多越该 warm)。
- `repo_size` / `last_full_pull_seconds` —— 全量 pull 的实测成本(repo 越大,cold 重启越贵 → 越该多 warm 一会儿)。
- `warm_cost_per_hour` vs `cold_restart_cost` —— 直接的成本/时延两端。

### 3.3 策略(自适应,而非固定超时)
- **active**:有用户在连 / 近期有操作 → 保持运行。
- **idle_short → stop(留盘)**:空闲超过自适应短超时即停计算、留卷。短超时 = f(repo_size, activity_rate, user_count)——**repo 越大 / 用得越频繁 / 人越多 → 超时越长**(因为重启越贵、越可能马上又用)。
- **idle_long / 驱逐 → destroy**:长期空闲,或资源紧张时按**价值分**驱逐:`value = f(recency, frequency, users) / cold_restart_cost`,先 destroy 价值最低的。
- **预热(pre-warm)**:用户打开项目 / 预测即将访问时,提前 start + 增量 fetch,等他点开 SSH 时已就绪。
- **(可选)定时 fetch 保新**:warm 期间后台增量 fetch,让工作副本跟 server 同步,减少连入时的等待。

> 这套 metrics + 策略是本 feature 真正要打磨的地方。建议**先用保守的固定 stop/destroy 超时 + 计算/存储解耦上线**,采集 §6 的实测数据,再迭代成自适应策略。

---

## 4. 权限 / 治理 / 离职(企业放心的落点)

- **接入凭证 = 短期、绑定 scope 权限**:员工经 PuppyOne 身份鉴权后,**按其 user→scope 权限**签发**短期 SSH 证书 / token** 才能连进该 scope 的 sandbox;过期自动失效。
- **离职 / 移除即失权**:撤销该用户的 scope 权限 → 证书不再续签 → **立即无法连入 sandbox / 无法触达数据**。数据全程在 sandbox/server,不在其设备。
- **共享 sandbox 不因单人离职而停**:同 scope 还有他人用时,只撤该用户访问,不动 sandbox;无人后按 §3 回收。
- **企业管理员可强制 kill/回收** 某 scope 的 sandbox。
- **权限边界**:只读 scope → sandbox 内只读挂载;写权限映射到 git push/CLI 写能力。
- **全程审计**(audit_logs):connect / disconnect / exec / git push|pull / 凭证签发 / 离职撤销 / kill,operator 区分 user/admin/system。

---

## 5. Provider:两版本,用户可选(配合已有 `SandboxBase` 抽象)

我们已有 `SandboxBase` + `SANDBOX_TYPE` 抽象。**实现两个可互换的 provider 后端,企业/项目可选**:

- **版本 A —— Fly.io Machines(默认 / 推荐)**:托管 Firecracker microVM;**原生 SSH(官方 blueprint)**、秒级 start/stop、**stop 即近乎零成本(只付存储)**、成本比 E2B/Modal 低一个量级。最契合 §3 的"stop 留盘、快速重启"模型。
- **版本 B —— E2B(可自托管 / 合规档)**:Firecracker 隔离;**唯一可自托管(Apache-2.0,BYOC/on-prem)**——给"要数据主权 / 合规 / 把数据放进自己基础设施"的企业;pause/resume 保内存+FS。SSH 需 DIY 隧道。

抽象需要**泛化**(去掉 JSON-edit 历史包袱),统一暴露:`start/stop/destroy/status/restart` · `exec` · 文件/卷挂载 · **连接信息(host/port,给 SSH)** · provider capability 声明(是否支持 stop-留盘、端口暴露、成本档)。

> (Hetzner 裸 VPS"一 scope 一台 VM"可作未来第三档"低成本常驻 / 自有基础设施",同一抽象下可加;先做 A+B 两版。)
> **待确认**:两版具体定为 Fly + E2B,还是按"托管 vs 自托管/VPS"分?见文末。

---

## 6. 可观测 / 成本(也是 session 策略的数据来源)

- 把每个 scope-sandbox 的:warm 时长、warm/cold 次数、**实测全量 pull / 增量 fetch 耗时**、闲置成本、活跃用户、被回收原因,写入 metrics + dashboard(同时修 GAP-8:sandbox 用量当前恒为 0)。
- 这些**实测数据反哺 §3 的自适应策略**(超时阈值、价值分权重)。
- 复用本周新增的 `/api/v1/activity` 展示 sandbox 会话活动。

---

## 7. 现状盘点(已有什么 / 缺口)

**✅ 已有**:`access_surfaces.kind='sandbox'`;sandbox endpoint CRUD(mounts/权限/runtime/资源限制/access_key);`SandboxBase` 抽象 + `SANDBOX_TYPE`(e2b/docker/auto,E2B+Docker 两实现);stateless exec(clone→跑→写回);agent 侧 session 复用 + idle 回收(4min);docker 回收器。

**⚠️ 需改造**:exec 是 stateless 一次性的,**不是 scope 共享的长存 session**;接口偏 JSON-edit;session 状态在进程内存(**多实例/重启会丢——必须外部化到 DB/Redis**)。

**❌ 缺口(本 feature 要补)**:
1. **scope 级共享的长存 sandbox** + 三态(active/stopped/destroyed)生命周期;
2. **metrics 驱动的 session 管理策略**(§3)——**核心工作量**;
3. **计算/存储解耦**(stop 留盘、增量 fetch);
4. **用户级接入凭证 + 离职撤销 + 审计**(§4);
5. **sandbox 内预置 git remote/CLI 接入**(所有访问在盒内跑);
6. **Fly Machines provider(版本 A)**+ 抽象泛化(连接信息/端口/卷/三态);
7. **VSCode SSH 接入**(Fly blueprint);
8. **会话状态外部化 + 可观测**(§6,含修 GAP-8)。

---

## 8. 难点排序(明确)

> **难点 = §3 的 session 管理:warm/cold 的成本-时效 trade-off,要靠好的 metrics(使用频率、最近间隔、用户数、repo 大小、重启成本)动态维护。**
> **不是难点**:起一个 sandbox、SSH 连进 sandbox——这些有现成能力(Fly 原生 SSH + 秒级开关)。所以工程重心放在 session 策略 + 计算/存储解耦 + 治理/权限,而非"造盒子"。

---

## 9. 建议推进顺序

1. **抽象泛化 + Fly Machines provider(版本 A)**:`SandboxBase` 加三态/连接信息/卷;接 Fly Machines API。
2. **scope 级共享长存 session + 状态外部化(DB/Redis)**:一 scope 一 sandbox,状态可跨 worker/重启接管。
3. **计算/存储解耦 + stop 留盘 + 增量 fetch**:先用**保守固定超时**跑通"idle→stop→快速重启"。
4. **VSCode SSH 接入闭环**(Fly blueprint)+ **用户级短期凭证 + 离职撤销 + 审计**(§4)。
5. **可观测埋点(§6)采集实测数据** → 迭代成 **§3 自适应 metrics 策略**。
6. **版本 B(E2B,可自托管/合规)** 接入,用户可选。
7. (未来)Hetzner VPS 第三档。

---

## 10. 待确认 / 风险

- **两版本具体是哪两个?**(建议 Fly + E2B;或按"托管 vs 自托管/VPS"分——取决于企业是否要把 sandbox 放进自己的基础设施。请老板拍板。)
- **全量 pull 成本**对大 repo 多大?(决定 stop-留盘的收益;建议先实测。)
- **共享 sandbox 内的 per-user 隔离与身份**(注意:**不是并发锁问题** —— 写并发由 git 协议/Version Engine 解决,同无 sandbox 时):要细化的是"每用户独立 working tree + 每用户独立 git 身份/auth"如何在共享盒内落地(各自 home/checkout、各自短期凭证映射到本人 scope 权限),确保 push 归属到人、审计到人、离职撤权干净。见 §2.2。
- **Fly 可靠性**(有事故记录):开发沙箱可接受,但要做重启/迁移容错;别把单台当 HA。
- 跑**半可信 agent 代码**时,隔离必须是 microVM(Fly/E2B 都满足),不可用共享容器。
