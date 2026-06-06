# PuppyOne V2 改动总结(2026-06-06 ~ 06-07)

分支:`feat/context-entrypoints`(未合并)
范围:Context 四大入口点收尾 · 父子 scope 同步 · Access 页 Git Remote 归一 · "Damaged folder" 数据完整性根因修复 + 工具 · 若干收尾清理

---

## 0. 提交清单

| 提交 | 主题 | 类别 |
|---|---|---|
| `ce9c8fdf` | Activity 只读端点(`context_activity_items` 视图) | 四大入口 |
| `7c5b3855` | 前端 Activity Stack 展示 Connect/Sync 运行 | 四大入口 |
| `ff6566f8` | 四大入口点真实状态核验文档 | 四大入口 |
| `43ea5608` | root scope = 项目全局视图,不再 carve 子 scope | 父子 scope |
| `6e0f4060` | scope head 被投影时留下可审计记录 | 父子 scope |
| `7ab4ee84` | scope 视图 exclude 改为 OID 级、容忍损坏 blob | 健壮性 |
| `d04a41ad` | 拆分 `git_remote`(Git Remote)与 `filesystem`(Local Folder Sync) | Access 页 |
| `8c87e7ea` | Local Folder Sync 专属图标 | Access 页 |
| `b96fc99a` | 清理已验证死代码 + 厘清共享 ARQ Redis | 收尾 |
| `30753573` | "Damaged folder" dangling 子树:防再发生 + 读时自愈 | 数据完整性 |
| `18a595f2` | Damaged folder 修复工具(判定可恢复性 + 重接) | 数据完整性 |
| `e5a16f30` | 迁移文件乱序修复(本会话起点) | 收尾 |

> 注:`ddc9f3e5`/`ca6c3186`/`8d93b248` 是 Git Remote 两张卡的早期"显示层合并"尝试,后被 `d04a41ad` 的正确方案(按真实功能拆分)取代。详见第 3 节。

---

## 1. Context 四大入口点(Upload / Import / Connect / Access)

**Feature 描述**
"上下文进入项目"的四种统一入口:
- **Upload** 上传文件(`upload_jobs` / `upload_items`)
- **Import** 一次性导入,如 GitHub 仓库(`import_jobs` + ARQ import worker)
- **Connect** 持续连接/同步外部源(`connections` / `sync_runs`)
- **Access** 访问面(`access_surfaces`:Git Remote / CLI / Local Folder Sync / Agent / MCP / Sandbox)

**之前状态**
后端表、target 表、`context_activity_items` 联合视图与 backfill 迁移基本已就绪(约 90% 实现),但有几处边缘没收口:Activity 没有读取端点、前端 Activity Stack 不展示 Connect/Sync 运行、Import worker 连错了 Redis 导致任务卡在 `queued`。

**做了什么**
- 新增只读端点 `GET /api/v1/activity`,基于 `context_activity_items` 视图,强制项目级鉴权(`ce9c8fdf`);
- 前端 `useActivity` / `ActivityStack` / `SyncJobsWidget` 把 Connect/Sync 运行也展示出来(`7c5b3855`);
- 厘清 Import 与 ETL worker **共用同一个 Redis、靠队列名区分**(`imports` vs `etl`),`IMPORT_REDIS_URL` 是无效变量;运营上把 import worker 的 `ETL_REDIS_URL` 对齐到 api 后,导入恢复正常(代码侧说明见 `b96fc99a` + `ingest/file/config.py` 注释);
- 在部署环境对四个入口做了**多文件实际同步的端到端深测**(非单测):Access ✅、Upload ✅、Import ✅(改 Redis 后)、Connect API ✅。

**效果**
四个入口端到端打通;三类作业(Upload/Import/Connect)在 Activity 里统一可见;导入不再卡 `queued`。

---

## 2. 父子 scope 同步

**期望行为**
同一个文件,无论从父 scope 还是子 scope 看,都应能看到最新版本、不丢失;且每次改动/同步都用**正确的 auth**(子 scope 同步父 scope 改动时不能用父的 auth,反之亦然)。同步发生在 **server 侧**:server 是 source of truth,client 只要拉取对应 scope 下 server 的最新内容即可。

**之前问题**
经实测,声明的子 scope 被 `carved_excludes` 隔离——root(父)视图把子 scope 的子树 carve 掉了,导致 root 看不到 / 不同步子 scope 的内容。

**做了什么**
- `compute_carved_excludes` 对 root scope(`path==""`)返回空——**root 即项目全局视图,能看见/写入/同步所有子 scope**;非 root 的 carving 行为不变(`43ea5608`);
- scope head 因项目根投影而推进时,写入 `version_transactions` + `audit_logs`(`source_channel="scope-sync"`,`operator_type="system"`),留下**可审计、可区分发起方**的记录(`6e0f4060`);
- 读路径继续遵循"从 canonical root 重派生 scope 视图"的 root-first 不变量。

**效果**
父子 scope 之间共享内容双向可见、可同步;每次投影同步都有审计痕迹,auth 边界清晰。

---

## 3. Access 页:两张 "Git Remote" 卡 → Git Remote + Local Folder Sync

**问题描述**
某个 scope 的 Access 页显示了**两张 "Git Remote" 卡**,其中一张是"功能完善"的,另一张是 raw / "Access setup is preparing"。

**之前的真实根因**
这两张卡**根本不是重复**,而是两个不同的内置功能被贴错了标签:
- `git_remote` = 原生 Git Remote(clone/pull/push);
- `filesystem` = **本地文件夹双向同步(Local Folder Sync / OpenClaw)**。

后端规范模型(`connector_service.PROVIDERS_BIDIRECTIONAL`)早已是这样,但 legacy 前端把 `filesystem` 误标成 "Git Remote"、又完全不认识 `git_remote`(title-case 成 "Git Remote" + preparing),于是两个不同功能都显示成 "Git Remote"。

**做了什么(Option A:对齐到规范模型)**
- 标签拆分:`git_remote → "Git Remote"`、`filesystem → "Local Folder Sync"`(`PROVIDER_LABELS`、连接器分组、type-line、创建弹窗、侧栏 chip);
- 新增 `isGitBuiltinProvider()`:两者同走 Git 传输,所以**共享卡片样式/图标/手动命令/setup prompt**,仅标签与描述按精确 provider 区分;
- **撤销**早期的显示层合并(那个把两者合成一张卡的做法会把 Local Folder Sync 藏掉);`(scope_id, kind)` 唯一索引本就保证每种 kind 每 scope 一行;
- Local Folder Sync 配**独立图标**(文件夹 + 双向箭头),与 Git Remote 的分支图标区分(`8c87e7ea`)。

**效果**
一个 scope 现在显示 **Git Remote + Local Folder Sync + CLI** 三张标签正确、图标各异的卡,不再有重复的 "Git Remote";后端无需改动,也未删任何数据。

---

## 4. "Damaged folder/file" 数据完整性(本次核心)

**问题描述**
数据浏览器里 `文档`、`docs` 等文件夹显示红色 **"Damaged"**,展开报 `VERSION_STORAGE_INTEGRITY_ERROR`。

**根因诊断(线上只读取证)**
"Damaged folder" = 某个 tree 条目引用的**子树对象在对象存储里缺失**,而父 tree 仍引用它。叶子 blob 还在(写入安全网保住了),但子树 tree 对象没了 → 父能列出文件夹名、展开却失败。共发现**三个独立缺口**:

1. **GC 不是 fail-safe(会永久删数据)**:`object_gc.mark_reachable_objects` 在遍历对象图时,**读某个对象失败就跳过**,导致那棵子树没被标记为 reachable → 被误判为孤儿 → 删除。
2. **写入安全网只查 blob、不查 tree 闭包**:`_verify_blobs_present` 只 HEAD 叶子 blob,从不校验已发布 root tree 的子树对象,builder 一旦回归就可能发布 dangling tree 而不被发现。
3. **读路径只展示、不自愈**:遇到 dangling 子树只标 "damaged",从不尝试从 canonical 重派生。

**怎么修(`30753573`,均带测试)**
1. **GC fail-safe**:把**遍历(walk)**的读错误与无害错误分开;只要遍历对象图时出过读错误(闭包可能不完整),就**拒绝删除**该项目(仍报告"本会删哪些"供观测)。同时区分"读不到对象"(拦截)与"读到但不是 git 对象"(当不透明叶子,不拦截),避免合法的非 git 对象把 GC 永久卡死。
2. **写入 tree 闭包护栏**:新增 `find_missing_tree_objects`(只查存在性、不下载 blob 的闭包遍历);在 `ProductOperationAdapter._apply_operation` 提交后加一道**配置开关 `VERSION_VERIFY_TREE_CLOSURE_ON_WRITE`**(默认关,因为全树遍历有开销)的运行时护栏,发现 dangling tree 即 `MissingBlobError` 报错。builder 不产生 dangling 由 `test_tree_closure` 固定证明。
3. **读路径自愈**:`tree_reader.list_dir` 检测到 damaged 子项时,best-effort 调既有的 `_repair_project_root_from_scope_state` 从 canonical scope state 重派生——健康项目 no-op,损坏的子 scope 则重新 graft 回来或丢掉死条目。

**修复工具(`18a595f2`)**
新增 `scripts/repair_damaged_folders.py`,在后端环境运行:
- dry-run(只读)对每个 damaged 文件夹判定 **tier ①(可恢复)/ tier ②(已丢失)**;
- `--apply` 把可恢复的子树重新 graft 回 root(单次 CAS,**只 graft、从不删**,不会丢数据)。
- 内容寻址语义:某 hash 的对象没了就没有第二份,"恢复"= 找到该路径**存活的另一版本**(改写过的文件夹的历史版本、或存活的子 scope 树);只写过一次且唯一版本已丢的,正确报告 GONE。

**关于已损坏数据 + 新内容安全性的结论**
- 截图里的 `docs`/`文档`:dry-run 实测为 **tier ②(GONE)**——canonical、location index、旧命名空间 `mut/`、bundle 里都没有存活子树,内容(均为一次性写入的测试文件)无法恢复,**删掉死条目清理即可**。
- **新内容不会再 damaged**,依据:
  1. 生产里**所有自动删对象的路径都是关的**:GC(`VERSION_OBJECT_GC_ENABLED=False`)、bundle sweep(仅 GC 调用)、loose 完整性扫描 heal(`VERSION_INTEGRITY_SCAN_ENABLED/_HEAL=False`);命名空间迁移脚本是一次性、只 copy 不删、手动执行;
  2. 写入 builder 持久化**完整闭包**(已被单测证明);
  3. **实证**:近期 `019e9c*` 一批带 docs 子 scope 的项目全部干净,只有早期 `019e7*`/`019e792*` 批次损坏——说明损坏是历史残留,非在发生的机制;
  4. 纵深防御:万一以后开启 GC,它现在 fail-safe,绝不会再误删活对象。

---

## 5. 其它收尾

- **迁移文件乱序**(`e5a16f30`):`supabase db push --dry-run` 报 `20260531010000_shadow_snapshot_grep_shared.sql` 顺序错误。按"不绕过迁移检查"的原则,**重命名**为 `20260531030000_...` 排到已应用迁移之后,而非用 `--include-all` 绕过。
- **scope 视图 exclude 改 OID 级**(`7ab4ee84`):3 处 exclude 过滤从"下载 blob 再重建"改为 `tree_to_flat` + `build_tree_from_blob_ids`(OID 级、不下载 blob、容忍损坏叶子 blob),更快也更健壮。
- **死代码清理 + Redis 说明**(`b96fc99a`):删除经验证无引用的死代码(`PROVIDERS_SELF_AUTH`、`legacy_changes_from_tree_delta`、`SearchService.now_iso`/`ensure_namespace_schema`、`destroy_workspace`);在 `ingest/file/config.py` 写清 import + etl 共用一个 Redis、靠队列名区分,`IMPORT_REDIS_URL` 不被读取。

---

## 6. 测试与验证

- **单测**:GC fail-safe 回归(遍历读错 ⇒ 不删除)、`test_tree_closure`(builder/graft 持久化完整闭包、checker 能抓 dangling 子树/blob)、修复工具三例(恢复改写文件夹的历史版本 / 从存活 scope_hash 恢复 / 一次性写入丢失正确报 GONE)。相关 integrity/projection/GC 套件全绿。
- **线上**:四大入口端到端深测;`git-view /health`、`ap-fs/tree`、审计日志只读诊断定位损坏项目与根因;修复工具 dry-run 实测确认 tier ②。
- 已知无关失败:`test_engine_resolve::test_resolve_landing_pending_keeps_row_resolving` 引用了已删除的 `engine._submit_version_root_first`,是预存的失效测试,与本次改动无关。

---

## 7. 待办 / 边界

1. **清理已损坏的死条目**:在 UI 删除(或 `ap-fs/rm --recursive`,tree 级删除,不读缺失子树)`docs`、`文档`。`docs` 是声明的子 scope,如需连 scope 定义一起清,在 Access 页删除对应 scope。
2. **可选加固**:想要运行时实证,可临时设 `VERSION_VERIFY_TREE_CLOSURE_ON_WRITE=true` 一段时间——任何写入若产出 dangling tree 会当场报错 + 记日志(默认关因为有 O(tree) 开销)。
3. **未能 100% 锁定当年确切元凶**(日志和对象都已不在),但已逐一排除所有当前还活着的删除路径,这是更强的保证。
4. **合并**:本分支 `feat/context-entrypoints` 尚未合并;合并后部署即生效。
