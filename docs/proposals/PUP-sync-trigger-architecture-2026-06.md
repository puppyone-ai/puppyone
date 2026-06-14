# PUP:Sandbox 同步触发架构(change/version 分层 + 托管 trigger)

**日期**:2026-06-13 · **状态**:设计提案 · **目标读者**:平台/版本引擎组
**关联现状**:`shadow_snapshot`(草稿层)、`submission_writer`(root-first 线性发布)、`outbox`+`agent_resolver`(服务端冲突解决)、`projection.graft_subtree`(父子投影)、git upload-pack(增量 fetch)。

---

## 0. 问题陈述

我们提供 sandbox 管理 + 同步服务 + SSH 接入;**真正操作 sandbox 内文件的是 SSH 之外的 client**(VSCode、各类 AI agent)。用户(开发者 + 非开发者)倾向于"让 agent 帮我干活"。我们要保证**所有 client 都工作在 source of truth(SoT)上**,但不能:

- **P1 — change ≠ version**:不能每次文件改动都 commit 一个新版本。很多改动是临时/试验性的、随时要撤回或补充;若全部进 SoT,会**不断产生 conflict、污染 SoT**,用户因此**不敢用**(最严重的后果)。
- **P2 — 何时/如何拉取他人改动**:不能他人一改就拉。我们是**服务端中心化**冲突解决,链路是「先 commit 本端改动 → server resolve → 再拉取」;这条链**长、易被多 client 阻塞、产生大量不必要 conflict**。
- **P2b — 父子 scope 传播**:子 scope 改完,root 下所有相关 scope 权限的 client 都要同步,**与这些 client 自己正在改的东西冲突**。(现状:投影是 **eager 强推**,这正是病根。)

并且:**trigger 由我们配置和开启,不让用户配**(他们不懂)。

---

## 1. 设计原则

1. **双速模型**:改动以**廉价、频繁、私有、可撤回**的方式被捕获(checkpoint);只有**少数、刻意**的时刻才提升为 SoT 版本(publish)。"不丢任何改动" ≠ "每个改动都进 SoT"。
2. **冲突只在 publish 时发生**,且发生一次、范围有界、优先交给 agent 解决。日常编辑不碰冲突路径。
3. **拉取是懒的、按路径范围的、通知优先(notify-don't-force)**,绝不强行 merge 进用户正在改的脏文件。
4. **path 隔离**:绝大多数编辑在不相交的路径上 → 天然无冲突。冲突面 = 真正重叠的路径。
5. **托管策略**:trigger 是我们按 **persona(开发者/非开发者)× 角色(root/子 scope)× client 类型** 选好的预设;用户至多看到一两个开关,不碰原始配置。
6. **最大化复用现有原语**:checkpoint=shadow snapshot;publish=promote→commit;冲突=outbox+agent_resolver;父子=projection;增量=git fetch。新增的只是"编排层 + 守护进程 + 事件通道"。

---

## 2. 核心模型:三层状态(解决 P1)

```
 ┌─────────────────────────────────────────────────────────────┐
 │ ① Working tree(sandbox 内,agent 直接编辑,脏、私有、实时) │
 └───────────────▲───────────────────────────┬─────────────────┘
       inotify/防抖 │ (read-only 快照)           │ checkout(仅不相交路径)
 ┌───────────────┴───────────────────────────▼─────────────────┐
 │ ② Checkpoint lane(草稿/检查点链)                            │
 │   = shadow snapshot(manifest+blobs,NOT promoted)            │
 │   频繁、廉价、私有(per scope×user×session)、可撤回、崩溃安全 │
 │   不进 SoT、不产生 conflict、不通知他人                       │
 └───────────────────────────────┬─────────────────────────────┘
                publish trigger   │ promote(rebase-onto-head → ff)
 ┌───────────────────────────────▼─────────────────────────────┐
 │ ③ Version / SoT(commit_history,线性历史,root-first)       │
 │   刻意、稀疏、共享、可 rollback;唯一会触发冲突解决与传播      │
 └──────────────────────────────────────────────────────────────┘
```

- **改动**落在 ②(checkpoint),不进 ③。用户可随时撤回/补充,**不污染 SoT、不产生 conflict**。→ 解决 P1。
- 只有 **publish trigger** 把当前 checkpoint 提升为 ③ 的一个版本。
- ② 已存在(`local_shadow_snapshots` + `promote_snapshot()`);需新增的是:**连续 checkpoint 化**(守护进程驱动)+ **checkpoint 链**(撤回时间线,而非单行覆盖)。

> 实现复用:守护进程就是把今天「CLI 手动 push shadow snapshot + promote」的流程**自动化 + 加智能 trigger**,并补上拉取/集成逻辑。

---

## 3. 组件架构

### 3.1 In-sandbox Sync Sidecar(新增,核心)

一个 **PuppyOne 托管**的进程,跑在 sandbox 内、**独立于 agent 的 SSH 会话**(agent 只管编辑文件,无需感知)。职责:

- **watch**:inotify 监听 working tree(忽略 `.git`、构建产物、按 `.gitignore`)。
- **checkpoint**:按 trigger(防抖/配额)把当前工作树哈希成 shadow snapshot(复用 manifest + 上传缺失 blob 的现有 API),写入 checkpoint 链。**只读工作树,任何时刻安全。**
- **publish**:按 publish trigger 走 promote 流水线(§3.3)。
- **integrate**:消费"上游推进"事件,按路径范围**懒集成**(§3.4)。
- **expose**:撤回(restore working tree 到某 checkpoint)、状态(dirty/synced/holding)。

> 它就是我们对外说的"同步服务"。filesystem connector 已被删(qubits),sidecar 是其 V2、scope-keyed 的替代;但它**不是双向魔法同步**,而是受 trigger 与 path 规则约束的编排器。

### 3.2 Checkpoint lane = shadow snapshot(复用 + 小改)

- 复用 `local_shadow_snapshots`(S3 manifest + blob 上传 + TTL reaper)。
- **小改**:从「单行覆盖」扩成**滚动 checkpoint 链**(保留最近 N 个/最近 T 时间,供撤回时间线),仍由 TTL reaper 控量。
- checkpoint **不触发** outbox/冲突/投影 —— 纯私有草稿。

### 3.3 Publish pipeline(复用线性发布 + 冲突解决)

`publish` 触发时,**唯一一次**强制同步发生在这里(把 P2 的长链路压缩成一次受控操作):

1. **fetch** 最新 SoT(git 增量)。
2. **rebase** 当前 checkpoint 到 scope head 之上(线性历史要求)。
3. clean → **ff publish**(promote_snapshot → submit_git_tree),产生版本;发出**路径范围**的"上游推进"事件。
4. conflict → 复用 §3.5 解决(一次、范围有界、优先 agent)。

→ 直接解决 P2 的链路问题:checkpoint 不走服务端冲突路径,只有 publish 这一刻走,且 diff 有界(自上次共同基)。

### 3.4 上游事件通道 + 路径范围懒集成(解决 P2 / P2b)

SoT 推进时(他人 publish,或父子投影),server 计算**受影响路径集**并发"上游推进(paths=…)"事件给在线 client。sidecar 按规则消费:

- **不相交**(受影响路径 ∩ 本端脏工作集 = ∅)→ **静默 fast-forward**:增量 fetch + **仅 checkout 这些路径**。agent 无感、零冲突。
- **相交** → **hold + notify**:不强行 merge 进脏文件;打标"上游改了你正在改的 X",**延迟到下次 quiescence/publish 时 rebase 集成**,或让 agent 决定。
- **合并/防抖**:批量快速事件,不逐条反应。

→ 把"他人一改就全员强拉"改成"懒、按路径、通知优先",**冲突面收敛到真正重叠的路径**。

### 3.5 冲突解决(复用 outbox + agent_resolver)

- 只在 publish 的 rebase 阶段产生。
- in-engine 安全策略(identical/one-side/json/append/line)先吃掉非重叠 hunk。
- 真重叠 → 按 SyncPolicy 路由:**agent persona → `agent_auto_resolve`/`agent_review`**(agent 在 sandbox 内带上下文解决,最契合"让 agent 干活");dev → 浮出审阅。
- 服务端中心化不变,但**调用时机受控**(publish 时、有界 diff),不再是连续洪流。

### 3.6 父子 scope:从 eager 强推 → 路径范围事件

- 现状 `projection.graft_subtree` + 投影是 **eager**(子 scope 一 commit,root 视图立即推进并强制下游同步)→ P2b 病根。
- **改法**:**服务端投影仍 eager**(保持 SoT 一致、root-first 不变量不动);但**下游 client 的消费改为 §3.4 的懒/路径范围/通知优先**。
  - 子 scope publish 只影响其子树路径;**编辑 root 中其它路径的 client 完全不被触碰**(不相交 → 不通知)。
  - 只有真正也在改这些子树路径的 root client 才 hold+notify,在自己 publish 时 rebase 集成。
- 仍保留 `parent-scope-wins` 作为重叠时的确定性兜底(已存在)。

---

## 4. Trigger 分类法(多样化 + 托管)

把 trigger 拆成 **事件源 × 动作 × 范围**,组合成策略。

### 4.1 事件源
- `file-change`(inotify)· `idle/quiescence`(编辑停止 N 秒)· `max-interval`(活动期每 T 秒)
- `agent-signal`(若 client 经 MCP/CLI 主动报"任务完成/保存")· `client-connect` / `disconnect`
- `explicit`(用户/agent 点"保存/发布")· `verification`(测试/构建通过,dev 向)
- `upstream-advance`(SoT 推进事件,见 §3.4)· `schedule`(兜底周期)

### 4.2 动作
`checkpoint`(写草稿)· `publish`(提升版本)· `fetch`(增量拉)· `notify` · `auto-integrate`(仅不相交)· `hold`(重叠时挂起)

### 4.3 映射(默认编排)
| 事件源 | 默认动作 |
|---|---|
| file-change(防抖 3–5s)| checkpoint |
| 活动期 max-interval(~60s)| checkpoint |
| **quiescence(长静默 2–5min)** | **publish**(把"一段工作做完"的强信号转成版本)|
| agent-signal "done" / explicit "save" | **publish** |
| verification 通过(dev)| publish |
| client-connect | fetch(从 SoT 起步)|
| **pre-publish** | **fetch + rebase(唯一强制同步)** |
| disconnect | checkpoint(必),publish(看策略)|
| upstream-advance | 不相交→auto-integrate;重叠→hold+notify |

> **agent 任务边界怎么识别**(client 是任意 VSCode/agent):**quiescence 是通用兜底**(没改动 N 秒 ≈ 一个工作单元结束);若 client 是 PuppyOne-aware(经 MCP tool / CLI marker),可显式报 `checkpoint`/`publish` 作为精确信号。两者叠加。

### 4.4 托管预设(用户不配,我们按 persona/角色选)

- **非开发者 + agent(autopilot)**:激进 checkpoint;publish on `agent-done` + 长静默;upstream 不相交自动集成;冲突走 `agent_auto_resolve`;**全程不暴露 git**。目标:**永不丢、不卡、看不到冲突**。
- **开发者 + agent(assisted)**:频繁 checkpoint;publish on `explicit`/`verification`;pre-publish rebase;冲突 `agent_review`/浮出;可见历史/撤回。
- **Reviewer / root owner**:子 scope 改动以**通知/提案**到达,按自己节奏集成;`manual_review`。

存储:`SyncPolicy`(server 侧,per scope×persona),从我们维护的预设库选;sidecar + server 执行。前端至多暴露 "自动同步:开 / 发布时机:任务完成|我点保存"。

---

## 5. 为什么常态无冲突(把 P1/P2 串起来)

1. 编辑 → checkpoint(私有,不进 SoT)→ **不产生 conflict、不污染 SoT**(P1 解)。
2. 不同 client 在**不相交路径** → upstream 事件 auto-integrate,**零冲突**。
3. 真要进 SoT 时 publish:**唯一一次** fetch+rebase,diff 有界,冲突一次性、优先 agent 解决(P2 链路解)。
4. 父子传播改为路径范围懒集成:编辑无关路径的 client **永不被打扰**(P2b 解)。
5. 撤回:checkpoint 链 = 本地秒级撤回(不碰 SoT);已发布版本 = rollback API(已存在)。

> 结果:**绝大多数操作零冲突**;冲突罕见、受控、在 agent 上下文里一次解决 → 用户**敢用**。

---

## 6. 增量(纠正"每次全量拉")

- git upload-pack **本就增量**(client 只 want 缺失对象)。确保 sidecar **用 `git fetch` 而非 re-clone**;初次进 sandbox 才全量 clone,之后只取 delta。
- upstream 集成只 **sparse checkout 受影响路径**。
- scope 视图"serve 整棵子树"是 scope 粒度问题,不是每次全量传输——增量 fetch 后只过 changed objects。**若现状确有 re-clone,改为 fetch 是关键修复点。**

---

## 7. 复用 vs 新增

| 能力 | 复用现有 | 新增 |
|---|---|---|
| 草稿/checkpoint | `local_shadow_snapshots`+S3 manifest+blob 上传+TTL reaper | checkpoint 链(滚动多版)、连续 checkpoint 化 |
| 发布/版本 | `promote_snapshot`→`submit_git_tree`、线性历史 rebase | pre-publish 自动 rebase 编排 |
| 冲突解决 | `outbox`+`agent_resolver`+in-engine 策略 | agent-in-sandbox 上下文解决接线 |
| 父子传播 | `projection.graft_subtree`、root-first、parent-scope-wins | **下游消费改懒/路径范围**、事件化 |
| 拉取 | git 增量 fetch / upload-pack | sparse 按路径集成、re-clone→fetch |
| trigger | `connections.trigger_type`/`sync_runs` | **事件驱动 trigger(inotify/quiescence/upstream)**、`SyncPolicy` 预设、in-sandbox sidecar |
| 通知 | — | 上游推进事件通道(path-scoped) |

---

## 8. 落地分期

- **M1 — sidecar + checkpoint(P1 骨架)**:sandbox 内守护进程,inotify→防抖→shadow checkpoint;撤回到 checkpoint;publish=手动/quiescence。先证"改动永不丢、不进 SoT、可撤回"。
- **M2 — publish 编排 + pre-publish rebase**:publish trigger(quiescence/explicit/agent-signal)+ 发布时一次性 rebase+冲突(复用 outbox/agent_resolver)。
- **M3 — 上游事件通道 + 路径范围懒集成**:server 发 path-scoped 上游事件;sidecar 不相交 auto-ff、重叠 hold+notify。
- **M4 — 父子传播事件化**:下游消费改懒;无关路径 client 不被打扰。
- **M5 — SyncPolicy 预设 + persona 自动选 + 前端开关**:托管化 trigger。
- **M6 — 增量加固**:确保 fetch 非 re-clone、sparse 集成、可观测(checkpoint/publish/conflict 计数进 `sync_runs`)。

---

## 9. 风险 / 待定

- **agent 任务边界识别**:纯 quiescence 兜底可能"过早 publish"或"过晚"。~~建议提供可选 MCP/CLI marker~~ **✅ 已实现**:sidecar `signal done|save|publish|checkpoint` 子命令 + watch 循环即时消费(`_handle_signals`,先于 quiescence);install 路径由 `sidecar_provision.marker_command(kind)` 统一(MCP `sync_signal` 工具 / SSH agent 都 shell 到它)。非感知 client 仍退化到 quiescence + explicit,两者叠加。
- **sidecar 与 agent 写竞争**:集成 checkout 必须只动不相交路径;重叠一律 hold,绝不覆盖脏文件。~~需 working-tree 写锁/原子 checkout~~ **✅ 已实现**:`integrate` 改为**逐路径 just-in-time 脏检查**(锁内再查,TOCTOU-safe;脏路径 HOLD 不覆盖)+ **temp+rename 原子写**(二进制安全,agent 绝不会读到半截文件)+ 上游已删的路径 HOLD 不破坏性删除;并加**可重入跨进程 worktree 锁**(mkdir 原子,stale 回收 + 超时降级),让 watch 守护与手动 CLI 调用串行,避免争抢 git 自身 `index.lock` 把守护进程打挂。
- **checkpoint 体量**:高频 checkpoint 的 blob 去重(内容寻址天然去重)+ TTL/数量上限。**✅ 数量/TTL 上限已实现**:`SyncPolicyConfig.checkpoint_chain_max`(非 dev 50 / dev·reviewer 200)+ `checkpoint_chain_ttl_s`(非 dev 1h,其余 0=关),经 `build_sidecar_env` → `SYNC_MAX_CHECKPOINTS`/`SYNC_CHECKPOINT_TTL_S`;sidecar 每次 checkpoint 后 `_compact_checkpoints` 检查"领先上次 publish 的私有链"长度/最老节点年龄,超限即 `reset --soft` 折叠为一个(纯元数据,工作树/暂存区不动,绝不丢改动,仅丢超限的深层私有 undo)。blob 去重靠 git 内容寻址天然成立。
- **"过早 publish 污染 SoT"**:宁可多 checkpoint、少 publish;非 dev 预设默认 publish 偏保守(任务完成 + 长静默双条件)。
- **父子重叠的语义**:parent-scope-wins 是兜底,但要让用户/agent 看得懂"为什么我的改动被父级覆盖"——需可读的冲突说明(已有 `superseded_by_parent` 记录)。**✅ publish 冲突的可读说明已实现**:sidecar publish 真冲突时,先在暂停的 rebase 状态下抽取每个路径的 `<<<<<<< / ======= / >>>>>>>` 冲突块、生成人/agent 可读的 JSON+Markdown 报告(双方内容 + 自然语言"你的改动没丢、publish 被 HELD")写到 `SYNC_CONFLICT_DIR`,再 abort 还原干净工作树;并按注入的 `conflict_policy` 路由(`agent_*` → 让 sandbox 内 agent 带上下文在干净树上重做并重发;`manual_review` 等 → 浮给人)。返回 `CONFLICT:agent|manual <paths> report=<md>`。(服务端 `outbox`+`agent_resolver` 仍服务于非 sidecar 的 typed-write 路径。)
- **多 sandbox/多 client 同 scope**:checkpoint 是 per scope×user×session;同一用户多端需合并策略(可暂定"每端独立 lane,publish 时各自 rebase")。**✅ 已落地**:每端是独立 clone = 独立私有 checkpoint lane,publish 经 fetch→rebase→ff-push 在共享 SoT 汇合(不相交编辑自动合并,仅真重叠才冲突);`LANE`(默认 hostname,可 `SYNC_LANE` 覆盖)写入 checkpoint 的 `Sync-Lane:` trailer(经 rebase 保留 → SoT 可溯源是哪端发布)并隔离各端 cursor;publish 的 push-race 重试由固定 3 次改为 `SYNC_PUBLISH_ATTEMPTS`(默认 5)+ 退避。多端不相交并发 publish 汇合已端到端验证。

---

## 9.5 实现状态(2026-06-13)

全部里程碑已实现并单测;E2B 实环境验证了核心 M1。代码在 `backend/src/platform/scope_sync/` + sidecar `sandbox/scope-sync-sidecar/`,**待部署到 qubits 实测**。

| M | 内容 | 状态 |
|---|---|---|
| M1 | policy 引擎 + coordinator(checkpoint/publish/tick)+ git 适配器 + **sidecar 守护进程** | ✅ 单测 + **E2B 实环境 ALL PASS**(edit→checkpoint→quiescence-publish→disjoint integrate→overlap conflict) |
| M2 | publish 流水线(fetch→rebase→ff push,冲突 abort+上报) | ✅ git 适配器实测 |
| M3 | 上游事件通道(`scope_sync_events` 表 + 端点 + classify)+ sidecar 消费(`consume_events`) | ✅ 单测;emit 接入 version_engine post-push hook(best-effort) |
| M4 | 父子传播路径范围 fanout(`fanout.py` + `record_publish`)→ 下游懒消费 | ✅ 单测;不相交 scope 不被打扰 |
| M5 | 托管设置(`scope_sync_settings` 表 + persona/auto_sync 端点)+ 前端 "Remote sync" 开关 | ✅ 单测 + tsc clean |
| M6 | 增量(sidecar 用 `git fetch` 非 clone;`scope_provision` 幂等 clone)+ 可观测(`/activity` 事件日志) | ✅ |

**部署到 qubits 时需要**:① 应用两个迁移(`20260613000000_scope_sync_events`、`20260613001000_scope_sync_settings`);② `SCOPE_SANDBOX_STORE=supabase` 让事件/设置用持久库;③ sidecar 装进 sandbox 镜像 + 启动时带 `SYNC_*` 环境(尤其 `SYNC_EVENTS_URL/PROJECT_ID/SCOPE_ID/TOKEN` 开启事件消费);④ 验证 version_engine post-push 的 emit 真正 fan-out(查 `scope_sync_events` 表或 `/activity`)。

> 70 个 scope_sync 单测全绿;E2B 端到端 ALL PASS。

### 9.6 P0 闭环接线 + 任务边界 marker(2026-06-14)

- **connect → sidecar 自动启动**:`scope_sandbox.connect` 在授权后(best-effort、按 scope `auto_sync` 开关)调 `sidecar_provision.install_and_start`,把 sidecar 装进 box 并带上由 `build_sidecar_env` 从托管 policy 映射出的 `SYNC_*` 启动 watch。`sidecar_starter` 可注入,connect 单测保持 hermetic。
- **access-key 事件端点**:新增 `GET /api/v1/scope-sync/ap/events`(`X-Access-Key` 鉴权,scope 从 key 反查),供 box 内 sidecar 用它克隆时已持有的 access_key 拉取上游事件——无需 JWT。`consume_events` 改发 `X-Access-Key`。
- **agent 任务边界 marker(#3)**:见 §9 第一条。
- **本地真 git 端到端**(无 E2B/网络):`sandbox/scope-sync-sidecar/tests/test_e2e_local.py` 用真实 git 世界(裸 SoT + 两个工作树 + localhost `/ap/events` stub)跑通 edit→checkpoint(私有)→publish(ff push)→integrate(稀疏拉取)、publish 冲突上报(非崩溃)、`consume_events` 经 `X-Access-Key` 集成不相交路径 / 重叠 HOLD、以及 marker 先于 quiescence 立即 publish。7 用例全绿。
> 201 个 scope_sync + scope_sandbox 单测 + 7 个 sidecar 本地端到端全绿。

### 9.7 真环境深度测试(2026-06-14,部署版 qubits + 真 E2B)

新建测试 project(seed)取 root access_key,实环境跑通:
- **Stage 1 sidecar→qubits publish 闭环**:真 sidecar 在克隆库里 edit→publish→push 到真 qubits SoT;qubits emit → `/activity`(event id+affected_paths+origin)、新 `/stats`(publish 量/distinct origins/paths)、新 `/ap/events`(`X-Access-Key`,scope 从 key 反查,无 JWT)全部命中。✅
- **Stage 2 consume 闭环**:第二端 publish 一个不相交文件 → A 端真 sidecar 轮询真 `/ap/events`(cursor 推进)→ 稀疏 integrate 该文件。✅
- **Stage 3 connect→E2B→sidecar(发现并修复 2 个真 bug)**:部署版 `connect` 真起了 E2B box(SSH+clone+per-user 工作树都在),但 **sidecar 没起**(`_maybe_start_sidecar` best-effort 静默失败)。两个 bug:
  1. **打包**:`load_sidecar_script()` 读 repo-root/`sandbox/`(在 `backend/` 之外,部署镜像里没有)→ FileNotFoundError。修:把脚本 vendored 进 backend 包(`scope_sync/_sidecar/`),canonical 优先、bundled 兜底,drift-guard 测试保持一致。
  2. **E2B 后台启动**:`setsid … &` 自分离在 E2B `commands.run` 下不活(返回即杀进程树);`pkill…; <env> python3…` 链式命令也破坏 E2B 后台启动。修:`ProviderCapabilities.background_exec_required`(E2B=True)、`exec(background=True)`(E2B→`commands.run(background=True)`;Fly no-op)、`install_and_start` 对后台型 provider **单独** foreground pkill + 后台干净 watch。
  - 已用**真 E2B box + 真生产代码路径**(E2BProvider→SdkE2BClient.exec(background=True)→真 install_and_start)验证:sidecar 起来、marker 触发 publish、qubits SoT 推进+emit。✅
- **仍待**:部署版 `connect` 端点自动起 sidecar —— 需带上修复 commit **再次重部署** 后,重跑 connect E2E 即可确认(代码侧已实环境证实正确)。

> 210 个 scope_sync + scope_sandbox 单测 + 18 个 sidecar 本地端到端全绿;sidecar↔qubits 全闭环 + E2B connect 自动起(修复后)均实环境验证。

## 10. 一句话总结

**把"改动"和"版本"分成两速**:改动落进**私有、廉价、可撤回的 checkpoint(复用 shadow snapshot)**,绝不污染 SoT;只有少数**托管 trigger**(任务完成/长静默/显式)才**一次性 rebase-publish** 成版本。拉取改成**懒、按路径、通知优先**,父子传播下游消费同此规则。冲突因此只在 publish 罕见发生、优先交 agent 解决——常态零冲突,用户敢用。trigger 全部由我们按 persona 预设,用户不碰。
