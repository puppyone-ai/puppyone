# 四大入口点(Context Entry Points)· 真实状态核实与收尾

**日期**:2026-06-06
**分支**:`feat/context-entrypoints`(基于最新 `qubits` 起的隔离分支,**全程不改 qubits**)
**目标**:核实"四大入口点"(Upload / Import / Integration / Access)新设计的实际落地程度,端到端验证,收尾真实边缘缺口。

---

## 0. 一句话结论

**四大入口点的后端、DB、前端其实已由团队基本实现**(在 Newmu 合并里执行的迁移),不是待建。
本次工作是 **核实 + 收尾边缘**,不重写已完成的部分。核实发现唯一真正"建了没接通"的缺口是
统一活动视图 `context_activity_items`,已补齐(后端只读端点 + 前端 sync 活动浮现)。

---

## 1. 真实状态总表(逐项核实,带代码证据)

| 维度 | 文档目标 | 实际现状 | 证据 |
|---|---|---|---|
| **DB** | 7 张目标表/视图 + backfill | ✅ 已建齐 | 迁移 `20260602010000`:`upload_jobs`/`upload_items`/`connections`/`sync_runs`/`access_surfaces` + `context_activity_items`(视图);含三段 backfill(legacy connectors / repo_scopes → 新表) |
| **Integration** | 走 `connections`+`sync_runs`,停 `import_once` | ✅ 已迁完 | `SyncRepository` 全程 `self.CONNECTIONS`;`SyncRunRepository` `NEW_TABLE="sync_runs"` 写新表 + 回填 `connections.last_sync_run_id`;`import_once` 四处**全是 `HTTPException(400)` 拒绝**并导向 ImportJob |
| **Access** | 运行时读 `access_surfaces` | ✅ 权威源已切 | `AccessSurfaceRepository` 为权威;Sandbox 等运行时直读 `access_surfaces`;`ConnectorRepository` 仅剩薄 facade(`TABLE="access_surfaces"`) |
| **Import** | `import_jobs` + 独立 worker | ✅ 完整 | `platform/imports/*` 整套 + 独立 ARQ 队列 `import_arq_queue_name` |
| **Upload** | `upload_jobs`/`upload_items` + ETL | ✅ 完整 | `ingest/*` + `etl_arq_queue_name` + `etl_finalize_upload_job`(finalize 经 Version Engine) |
| **前端 IA** | Add content / Integration / Access 分类 | ✅ 已对齐 | `CreateMenu.tsx`:`onImportFrom*` 与 `onConnect*` 命名分类、`UploadIcon`/`ConnectIcon`；`Connect` 是旧 UI 动词/代码名,产品分类应写 Integration |
| **前端 Activity** | 统一 upload/import/sync 活动流 | ⚠️→✅ 本次补 | 原 `ActivityStack` 只有 Import+Upload widget,**sync 不显示**;现已加 `SyncJobsWidget` |

---

## 2. 边缘核实结论(四项)

1. **`connections` 过渡列读写一致性** —— ✅ **通过**。
   表里同时有 `trigger`/`trigger_type`/`trigger_config`、`credential_ref`/`credentials_ref` 等过渡列;
   核实运行时**写读都用同一套新列**:`SyncRepository.create` 写 `trigger_type`+`trigger_config`+`credential_ref`,
   `_connection_to_model` 读同一套,scheduler 的 `_load_scheduled_syncs` 也读 `trigger_type`/`trigger_config`。
   旧列(`trigger`、`credentials_ref`)是无害遗留,运行时不读 → 留作 Phase 2 清理。

2. **迁移 backfill 完整性** —— ✅ 三段 backfill 均存在(`connections`、`sync_runs`、`access_surfaces`),
   源自 legacy `connectors`/`repo_scopes`,import-only 行保留为历史。
   (注:逐行计数对账需连真实 DB,本地无法执行,留作部署后核对。)

3. **Activity 接线** —— ⚠️ **发现真实缺口**:`context_activity_items` 视图建了,但**后端无端点、前端无消费**(死对象);
   且 **sync 活动完全不在 Activity UI**。→ 本次已修(见第 3 节)。

4. **执行模型(worker 队列)** —— ⚠️ 已有 `etl`/`imports` 两个 ARQ 队列,但 **sync 仍跑在 APScheduler 线程池**,
   没有独立 `syncs` 队列。属增强(隔离性),非阻塞,留作可选项(见第 4 节)。

---

## 3. 本次完成的收尾(2 个提交,均在 `feat/context-entrypoints`)

### `ce9c8fdf` 后端:接通 `context_activity_items` 视图
- 新增 `backend/src/platform/activity/`(schemas/repository/service/dependencies/router)。
- 端点:`GET /api/v1/activity?project_id=&kind=&active_only=&limit=` —— **只读**,UNION 三类(upload/import/sync_run)。
- 鉴权边界:service-role 客户端绕过视图 RLS,故服务层用 `get_by_id_with_access_check` 强制项目访问校验(对齐 imports 端点)。
- `active_only` 用 `completed_at IS NULL`(kind 无关),避免硬编码各表状态词表。
- **7 个单测全过**(项目隔离不串、kind 过滤、active_only、查的是视图非表、鉴权边界)。

### `7c5b3855` 前端:让 sync 活动浮现
- 新增 `lib/activityApi.ts` + `lib/hooks/useActivity.ts`(SWR,仅在有进行中项时轮询,对齐 `useProjectImportJobs`)。
- 新增 `components/SyncJobsWidget.tsx`(只读,镜像 `ImportJobsWidget`),挂进 `ActivityStack`(Import / **Sync** / Upload)。
- **`tsc --noEmit` 全量通过**。

> 取舍:Activity UI 保留"各 kind 独立 widget"的现有形态(文档允许聚合层有多种实现),
> 只补上缺失的 sync widget + 让死视图可用,而**不**强行把三类塞进一个统一组件——最小改动、零回归风险。

---

## 4. 仍剩余的**可选项**(非阻塞,未做)

| 项 | 性质 | 建议 |
|---|---|---|
| 独立 `syncs` ARQ 队列 + sync_worker | 增强(进程隔离,防慢任务互相饿死) | 团队排期决定;当前 APScheduler 线程池可用 |
| 退役 `ConnectorRepository` facade | 纯改名(~6 文件,原子风险) | 价值低、风险在"必须同时切换所有调用方",建议谨慎或暂缓 |
| Phase 2:drop legacy 表/过渡列 | 运营 | 运行时完全无引用后再做 |
| Activity 统一组件(替代多 widget) | 产品/UX | 可选,现状已能显示三类 |

---

## 5. 验证状态

- 后端新模块 **7/7 单测通过**;router 可干净导入(`/activity`)。
- 前端 **tsc 全量通过**。
- 端到端运行时验证(API→表→Version Engine)受限于本地 Supabase 未启动,仅做了代码路径追踪;
  真实 e2e 需在 staging/qubits 环境跑。
- **隔离保证**:全部改动在 `feat/context-entrypoints`,该分支已断开 origin 上游(`--unset-upstream`),
  **qubits 分支(另一 worktree)未被触碰**。

---

*配套:四大入口点设计见 [`10-context-entrypoints.md`](10-context-entrypoints.md)、数据模型见 [`11-context-entrypoint-data-model.md`](11-context-entrypoint-data-model.md)。*
