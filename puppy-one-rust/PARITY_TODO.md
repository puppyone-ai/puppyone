# Rust 前端与 Web 产品对齐 TODO

参考实现：`../../puppyone`（v0.4.0，`product-source.json`）。本清单跟踪原生产品迁移；本轮要求的五个 1:1 复刻领域统一列于 §0.3，后文保留各模块的详细验收项。
状态：`[ ]` 未开始 · `[~]` 部分完成（写明缺什么）· `[x]` 完成并有测试/截图证据。

## 0. 工作方法

### 0.1 TS → Rust 映射规则

按"组件边界"映射，而不是机械地一个文件对一个文件：

| TS 源 | Rust 目标 | 说明 |
| --- | --- | --- |
| `Foo.tsx` 组件 | `foo.rs` 模块，或所属模块里的 `fn foo(...)` | 名称保持 snake_case 同名，便于检索 |
| `useFoo.ts` hook | 所属 entity/controller 的状态与方法 | React hook 没有 GPUI 对应物，不单独建文件 |
| `fooModel.ts` / `*Registry.ts` 纯模型 | 同名纯 Rust 模块（无 gpui 依赖） | 由 `check-ui-boundaries.py` 守护 |
| `*.css` | `theme.rs` token + `ui/` 样式原语 | 功能代码不得自定义颜色 |
| `*VisualSmokeHarness.tsx`、`__tests__` | `excluded`（写明原因）或 Rust 测试 | 不计入映射 |

映射登记在 `tools/ui-migration-map.json`，`python3 tools/audit-ui-migration.py` 枚举源目录全部文件，未登记的自动记为 `pending`，被删除/改名的映射目标会报错。状态只允许 `partial` / `ported` / `excluded`：`ported` 必须写明验证证据（测试名或截图），否则审计失败。Agent 运行时层继续使用已有的 `tools/agent-migration-map.json`。

### 0.2 样式体系

- `src/theme.rs` 是唯一的颜色/几何/字号来源，取值来自：
  - 颜色：`sub-themes/default-neutral/theme.css`（原语）+ `src/styles/tokens.css`（语义层：sidebar、header、divider、menu…）
  - 几何：`packages/shared-ui/src/styles/control-geometry.css`、`tokens.css`（控件尺寸、行高、圆角、间距）
  - 字号：`src/styles/typography/foundations.css`（UI 字号角色，随三档文字尺度变化）
- `src/ui/` 提供与 Web 同名语义的样式原语（sidebar row/group、settings row/switch/segment/select/action、menu、icon button），功能代码只组合原语。
- `check-ui-boundaries.py` 扩展：`features/`、`shell.rs` 等不得出现 `rgb(`/`rgba(` 字面色值。

### 0.3 五个领域的 1:1 复刻验收（2026-10-28 起）

验收单位是 TS 的产品行为、状态转换、异常处理和真实入口；已有接口或局部测试不算整项完成。参考 HEAD 必须同时绑定实际工作树输入哈希。

| 领域 | 当前已接入 | 完成前还必须验证 |
| --- | --- | --- |
| 文件操作 `[~]` | 原 Working Copy/Entity 重绑定；隐藏文档与目录后代保存屏障；复制源 flush；未知回执只对账；移动后 Undo 写回新路径 | 改扩展名的 viewer 转换与历史连续性；与 TS 等价的按资源范围并发队列；所有格式与跨 Root 操作 |
| 工作区与 Explorer `[~]` | 本地树/选择/滚动/剪贴板保活及重核；目录移动保留子树；同工作区单文件边缘拖放及目标生命周期隔离 | 完整每 Pane 视图状态、跨 Root composition；目录订阅；外部原生拖放；键盘/可访问性与 OS/像素验收 |
| Cloud 完整链路 `[ ]` | 认证和 running Provider；显式 opening/polling 协议、项目/generation/期限/取消校验与根目录准入；入口仍禁用 | 项目选择/创建与 opening 可见流程→双入口切换→Editor；完整错误分类、并发打开合并、草稿/未知结果、权限/viewer budget 与执行隔离；真实测试环境验收 |
| 文件查看器 `[~]` | Markdown、CSV、图片；代码/JSON 原生语法编辑、行号/折叠/缩进/括号补全、多光标/撤销；同实例语言重绑；产品查找及 Unicode 规范化 | 代码括号匹配/选词高亮/尾空格装饰、严格几何/字体与历史预算；HTML 实际预览；Context Map/PuppyFlow；App/PDF/数据库/Office/音视频的完整 TS 能力与失败态 |
| Markdown 高级功能 `[~]` | 原生基础格式、代码块及表格；真实工作区元数据解析；CSV 引用打开；Markdown/Wiki 点击与当前文档标题跳转 | 数学公式、Mermaid、图片/视频、HTML/MDX；表格列宽、backlinks/资源预览；跨文档 heading 与 HTML id、引用视觉/可访问性；多 Root URI 和不同系统 locale 排序 |

工作区引用续作：`tools/reference-navigation.mjs --check` 固定 TS HEAD 与实际输入哈希，Rust 对照 1,200 个解析结果、4 个标题索引及 18 个 URL 策略。Shell 测试覆盖 CSV→真实文件、目录重绑定后缓存更新和跨项目保活；GPUI 覆盖 Markdown 点击、4px 拖选取消、空白命中与标题跳转不改正文。完整链接图、资源预览及多 Root 未完成，不能将该切片记为整项通过。

代码编辑续作（2026-10-29）：`tools/reference-code.mjs --check` 执行真实 TS 语言解析与 CodeMirror SearchQuery，756 组语言/缩进与 290 组 Unicode 搜索由 Rust 对照，31 个实际输入摘要保存在 `fixtures/editor/code-reference.json`。原生输入测试覆盖 emoji UTF-16、IME 提交/取消/unmark、冻结保存、外部替换、语言重绑后 Undo、实际键盘 JSON 配对/缩进、多光标、产品查找入口与编辑后计数。`dev-capture` 全量 460 passed / 9 ignored，Clippy all-targets `-D warnings` 与边界检查通过；未计为代码编辑或所有查看器的完整 1:1/OS/像素验收。

本批执行证据：`renaming_a_hidden_document_rebinds_its_native_history_without_changing_focus`、`resource_barrier_waits_for_composition_and_cannot_be_stolen_by_close`、`copying_a_directory_flushes_hidden_working_copies_without_replacing_them`、`failed_snapshot_cancels_the_mutation_and_thaws_every_affected_document`、`lost_rename_receipt_is_reconciled_without_replaying_the_mutation`、`project_return_restores_explorer_state_and_revalidates_loaded_folders`、`delayed_drop_cannot_attach_to_a_removed_and_recreated_pane_id`。这些覆盖文件与工作台切片，不将后面三项标为完成。

### 0.4 已完成项收口（2026-10-28）

- [x] CSV 宿主引用、Pane 菜单与查找接线已验收，见 N9；修正遗留的未完成标记。
- [x] 同步 8 个 locale 的现行 TS 投影；移除已退役的 Git sidebar layout 设置，补上持久化的“显示文件图标”开关；隐藏 glyph 保留行内槽位。证据：`hidden_file_icons_survive_preference_reload`、`legacy_theme_flag_becomes_an_explicit_mode_and_new_fields_default` 和 localization/file-icons 门禁。
- [x] 旧 native-editor-probe 明确退役，其验证入口迁到产品 `src/editor/`，不再构建已删除的输入实现。新门禁要求 IME、CSV 与宿主的具体契约用例通过，零匹配不能报成功；原实验源码仅保留为历史。
- [x] `tools/verify.py` 18 项全部通过：`dev-capture` **448 passed / 9 ignored**，fmt、边界、TS 参考、资产、Clippy、release、CPU 帧预算及现行编辑器专项 **46 passed**。运行前后源文件哈希一致；共享 `CARGO_TARGET_DIR` 的 release 哈希取自 Cargo 实际输出目录。收据：`artifacts/gpui-verification/result.json`、`artifacts/native-editor-verification/result.json`。

此前各日期下“localization / native probe 尚未解决”是当时记录，现由本节更新。§0.3 的五个完整领域仍未通过整体验收；没有把 Cloud、缺失查看器、Markdown 高级功能、跨 Root 或严格像素验收归档或改成完成。

### 0.5 2026-10-29 夜间批次（基准 v0.4.0）

参考实现改为 `../../puppyone`（v0.4.0，`9c500b3d`）。本批完成并有测试：

- [x] 基准升级：6 份参考夹具复核漂移后重新固定；映射审计扩大到 cloud/automation/payments 等 21 个根（未登记数相应增加，见审计输出）。
- [x] Explorer 导入/移动失败横幅（`operationError`）与首页取消关联提示（`removeHint`）。证据：`failed_import_or_move_shows_above_the_tree_and_retry_rereads_the_root`。
- [x] 运行底座：`platform::tasks`（EditorTaskScheduler 策略 v1）、`platform::host_budget`（itemHostBudgetDefaults，终端与 Agent CLI 接入）、File → Manage Running Sessions、`platform::watchdog`（主线程 250 ms 卡顿记录、worker panic 兜底、崩溃记录）、每查看器 `maxSourceBytes` 准入（本地文本上限升至 16 MiB）。
- [x] 多窗口：`shell::windows`（New Window、项目只在一个窗口、菜单跟随当前窗口、Quit 逐窗口屏障、共享偏好、恢复上次项目、Finder 打开文件夹）；本地目录订阅（FSEvents）。证据：`windows_share_preferences_and_one_project_lives_in_one_window`、`external_changes_reread_loaded_folders_through_the_directory_subscription`。
- [x] 应用菜单按 `native-menu-service` 补齐（About、Check for Updates、Services、Hide、Window、Help、Close Window）。
- [x] PDF 查看器（PDFium，`tools/fetch-pdfium.py`）与 AVIF（ImageIO 转码）。内容为引擎渲染，接近即可；外框与状态未做像素对比。
- [x] 账户与 Cloud 拆分（#83 #89）：`features::flags`、Settings Account/Plan 分组、首页 Sign in 跟随 Cloud。
- [x] Cloud 协议/模型：`workspace::cloud::{failure, locator, catalog, recovery, publish}`（打开失败分类、remote 定位与可信 origin、资源链接、首页目录合并排序、仓库关联重试、首次发布状态轴）。**界面尚未接入，C-6.6 草稿策略未做，Cloud 编辑仍不得开放。**

- [x] 第二轮：WebView 底座（`web_host`、`platform::webview` 协议）；HTML Interact/Source；音视频；Office（docx-preview、pptx-renderer、SheetJS、textutil）；SQLite 数据库预览；代码编辑器括号匹配/同词高亮/行尾空格；Cloud 首页目录、显式打开（两句加载文案与取消）、Cloud Explorer Copy Link。Cloud 文档在 C-6.6 草稿策略完成前只读。新界面均未做像素对比，WebView 显示未经真实窗口截图确认。

仍未完成（第二轮后）：HTML 可视化编辑、Context Map、App 预览；Cloud 切换/Share/History/Agent/发布界面/服务管理页/Billing/草稿策略；全部像素对比流程；右侧栏、设置与账户付费的剩余项。

- [x] 第三轮（`15ecae65`..`64e15606`）：Cloud 草稿与未知结果策略（`deferCloudBaseline`，C-6.6，Cloud 文档恢复可编辑）；Header Share 与 Share this project 对话框（缩略图未画）；Cloud History 侧栏（80 条分页、按需详情、共享有界缓存）；Header 本地/Cloud 切换、两侧宿主保活、checkout 的 Cloud 关联（C-4.3、C-7.1–7.3、C-5.4、C-5.8）。像素流程新增：Cloud History（list 99.98% / detail 99.27% / empty 99.91%）、代码 99.7%、JSON 99.7%、图片 99.94%、图片失败 99.89%、二进制占位 99.83%。为代码 gutter 引入 `vendor/gpui-base`（0.8.0 + GutterMetrics，见 `PUPPYONE_PATCH.md`，`[patch.crates-io]`）。
- [x] 第四轮（`110df209`、`9d5be178`、`01568662`）：
  - 首页与 Header 项目菜单共用一个扁平列表（`buildHomepageProjects`）：本地 checkout 和账号目录按实际修改时间、`localeCompare` 名称、ID 排序；只有本轮新读的、可信 origin 的项目根定位器才合并成一行（`git remote -v` 在水合 worker 上读）；三种位置图标；合并行的 Open 下拉（On This Mac / On Cloud Computer），默认本机，Open in Cloud 在本窗口准备，只在 Cloud 的行开专用窗口；打开偏好按账号 + API 记录（上限 100），失败和取消不记录。只在 Cloud 的窗口只通过账号目录里可信的本地 checkout 提供“在本机打开”（C-3.2–3.5、C-7.4）。证据：`the_homepage_merges_a_linked_checkout_and_remembers_where_it_opened`、`openings_default_to_this_computer_and_follow_the_last_successful_one`、`the_open_history_is_bounded_and_stored_like_the_product`。
  - 账号权限（用户、会话代次、API、Cloud 开关）变化时撤销 Cloud 选择：取消进行中的打开、丢弃保活的 Cloud 宿主和 Share 对话框，窗口回到保留的本地宿主、其文件夹或首页；等待中的 Header 切换意图保留。同一目标的重复打开合并，新的选择会取消被替换的准备（C-2.5、C-5.5、C-5.6）。证据：`signing_out_revokes_the_hosted_selection_and_returns_home`、`turning_cloud_off_cancels_an_opening_in_flight`、`the_same_cloud_target_joins_its_pending_opening`。
  - `ui::components::notice`（FloatingNotice / NoticeStack / NoticeAction）；Cloud 冲突改为编辑器内不可关闭的危险提示（“丢弃并重新加载”），不再是对话框；同一账号重新打开同一项目时重新绑定保留的宿主（Explorer、Working Copy、预览）到新租约，`Workspace::adopt` 重读后按存储观察对账，未保存输入下的远端新文本被搁置，失败的写入不重试；订阅失败显示工作区警告提示（Retry、关闭），之后的变更会清除它（S-11 部分、C-6.3、C-6.7）。证据：`a_new_lease_of_the_same_storage_rebinds_the_working_copy_and_keeps_saving`、`a_rebind_holds_newer_remote_text_back_under_unsaved_input`、`a_failed_cloud_subscription_offers_retry_which_rebinds_the_same_host`。
  - 映射审计新登记 6 个 Cloud 组共 38 个源文件（`src/features/cloud` pending 230 → 192）。
  - 本轮新界面（合并行与 Open 下拉、浮动提示）都**没有**像素对比；关联角标没有 TS 的 silhouette backplate。

仍未完成（第四轮后）：Cloud 预览资源（Office/数据库临时文件、HTML data URL 投影）、Scope、MissingCloudProjectRecovery、发布流程与价值页、Cloud Agent、服务管理页、Billing；浮动提示的其余使用方（保存状态浮层、文件操作提示）；首页 Cloud 行与浮动提示的像素流程；HTML 可视化编辑、Context Map、App 预览；右侧栏、设置与账户付费的剩余项。

（第一轮记录）仍未完成：HTML/Office/音视频/数据库/Context Map/App 预览查看器；代码编辑器装饰与冲突横幅；Cloud 全部界面；各处像素对比流程；右侧栏、设置与账户付费的剩余项。完整清单与状态见桌面迁移清单第 2 版。

## 1. 基础设施

- [x] S1 样式 token：`theme.rs` 从 5 个内置主题包（`assets/themes.json`，`tools/import-themes.mjs`）+ `tokens.css` 语义层公式构建；控件几何、UI 字号角色随三档尺度变化。证据：`semantic_tokens_follow_the_web_formulas`、`medium_literals_follow_the_product_role_table`
- [x] S2 样式原语：组件库 `src/ui/components/`（SidebarRow/SidebarGroup、Settings 行/开关/分段/下拉/按钮、IconButton + tooltip、Menu/PopoverMenu、Dialog）与 `src/ui/loading/`（rounded / dither mark、placeholder）
- [x] S3 本地化：加入 `source-control` 命名空间；ICU 子集覆盖目录实际用到的 `{arg}`、`number`、`plural`（含 `=N`、`#`），`select` 目录未使用故未实现；全局当前语言 + `localization::spawn` 让工作线程继承语言。证据：`icu_subset_matches_product_catalog_usage`、`workers_inherit_the_spawning_locale`
- [x] S4 图标：七种产品语义从真实 `PRODUCT_ICONS` 注册表导入；`Icon::product(ProductIcon)` 是视图入口，兼容名称仅在素材层归并；通用 Lucide 保留。证据：`product_registry_is_exhaustive_and_preserves_geometry`、`referenced_icons_exist` 与 UI 边界审计
- [x] S5 文件类型图标：按当前 TS 注册表仅保留 `default`，完整覆盖格式层的 22 种语义类型；导入参数化 glyph、尺寸/线宽策略及颜色绑定，不再固定 18px / 默认主题颜色。852 个 TS 分类与 308 个尺寸/线宽 oracle；继承行文字颜色、当前主题、DPR 均进入渲染/缓存。证据：`classification_and_display_follow_the_product_registry`、`every_kind_has_late_bound_ink_and_valid_geometry_at_each_size`、`every_theme_binding_uses_the_active_palette_and_inherited_ink`。大型文件卡片预览与严格像素一致仍未验收
- [x] S6 映射清单 `tools/ui-migration-map.json` + `tools/audit-ui-migration.py`（29 组；ported 必须引用存在的测试或产物；接入 `tools/verify.py`）
- [x] S7 边界守护：`check-ui-boundaries.py` 拒绝 `theme.rs` 以外的颜色字面量；终端 ANSI/256 色改由 `Theme::ansi_index` 提供

## 2. P0 — 行为错误 / Bug

- [x] P0-1 Settings「Git Ignore」页改回 Web 语义：显示隐藏文件开关 + 排除规则（应用/重置），偏好持久化并作用于文件树。证据：`visibility_display_names_and_selection_follow_the_product`、截图
- [x] P0-2 恢复会话 Tab 的 `history` 图标已导入。证据：`referenced_icons_exist`
- [x] P0-3 Header 右侧入口：Agent 气泡图标 + 显示/隐藏提示；Changes 用 ⚠/↓/↑/✱ 图标 + 计数（无改动时与 Web 一样显示 ✱ 0）
- [x] P0-4 内置 Agent 改名 "Built-in Agent" 并排在最后；"Hermes Agent"；WorkBuddy 区分 China / International
- [x] P0-5 Local Agents 设置：只列已检测到的 Agent + 显示开关（持久化）+ 扫描/空/错误状态 + 对话历史发现开关；Launcher 遵守隐藏
- [x] P0-6 Model Connections 页去掉重复标题
- [x] P0-7 Header Home 按钮进入首页；Explorer 收起时显示展开按钮。证据：`project_menu_home_shows_the_homepage_and_hides_the_editor`

## 3. P1 — 主要功能差距

### 本地化
- [x] P1-1 Agent、Workbench、Changes、Terminal、Model Connections、Local Agents、Shell 空态/弹窗、Create 对话框、Feedback、菜单栏、文件操作/编辑器/Git/模型配置报错全部走本地化（产品目录优先，原生独有文案在 `assets/native-locales.json`，8 种语言齐全，测试校验）。zh-Hans 截图核对

### 左侧栏（`ExplorerTree.tsx` / `DataWorkspace.tsx` / `nodeActions.tsx`）
- [x] P1-2 文件类型图标（跟随文件图标主题设置）+ 扩展名区分
- [x] P1-3 ~~行内 Git 状态字母~~：桌面产品的 Explorer 行不显示 Git 字母/颜色（实测 qubits），已移除；Git 状态只在 Header 与 Changes 中呈现
- [x] P1-4 悬停行操作与右键菜单：在此新建、复制路径、复制相对路径、在 Finder 中显示、用默认应用打开、创建副本、复制/剪切/粘贴、重命名、删除（确认）。证据：`rename_move_copy_import_and_delete_stay_inside_the_grant`
- [x] P1-5 键盘：↑↓←→ Home End Enter；多选（⌘ 加选、⇧ 范围）
- [x] P1-6 拖拽：树内移动到文件夹；从系统拖入文件导入
- [~] P1-7 "New" 是列表末尾的一行；加载/空状态行已做。文件夹读取失败时，错误和"重试"显示在该文件夹行尾（Web 是文件夹下方单独一行）。证据：`failed_folder_read_stays_on_its_row_until_a_retry_succeeds`
- [~] P1-8 最新 macOS 产品不显示底部栏：原生高度归零、Explorer 延伸到底部、去掉 footer 渐隐；Settings 留在应用菜单 / `⌘,`。证据：`macos_has_no_sidebar_footer_and_settings_stays_in_the_app_menu`。非 macOS 保留 Settings + Help（产品 `useWorkspaceSurfaceContent` 把 `git` 从底部导航过滤掉，Changes 在 Header）；无分割线，树在仍有下方行时以 18px 渐隐过渡到底部栏（`useScrollEdgeState`）；高度 = control + 16 随文字尺度变化，按钮 control−4、图标 14px / 描边 1.65、utility 色（`mix(muted 80%, sidebar)`），Help 用产品自有 `FeedbackHelpIcon`。证据：`sidebar_footer_follows_the_navigation_height_formula`、`sidebar_tree_fade_follows_use_scroll_edge_state`、`sidebar_tree_fades_into_the_footer_only_while_rows_remain_below`。已知差异：忙碌时右侧的共享 LoadingMark 是原生临时进度提示（产品用 `FloatingNoticeStack`，尚未移植）；Project Rail 打开时产品隐藏底部栏、把工具按钮移入 Rail，原生未移植
- [~] P1-9 最近项目持久化；项目菜单（项目列表、打开文件夹、首页、移除）；Project Rail 列出项目。缺：Rail 上的重命名/取消关联（`ProjectRowActions`）。证据：`project_history_is_most_recent_first_and_bounded`
- [x] P1-10 首页（`MinimalOnboarding` / `OnboardingHomeLayout` / `OnboardingProjectEntryDialog`，`src/shell/home/`）：
  - 品牌标记 28px + 标题（`text-muted`，−0.035em 字距由 `ui::tracked_text` 逐字形绘制）；深色下标记按产品 `grayscale(1) brightness(0.7)` 预烘焙（`brand/puppy-dark-onboarding.svg`）。有项目时标题为「Which project…」，无项目时为「Start with your files…」且 New empty project 为主按钮
  - 最近项目按最后修改时间排序（`readWorkspaceModifiedAt`：Git 提交时间 + 改动文件时间，非仓库扫描文件，超过 1024 项视为未知，后台线程读取，`src/platform/project_activity.rs`），每行显示上级目录（`~` 缩写）、相对时间（`Intl.RelativeTimeFormat` 规则，8 种语言）与悬停时的取消关联按钮（确认后移出列表）。行用 `MenuRow` + `MenuVariant::Homepage`
  - New empty project 打开创建对话框：默认名「My project XXXX」、默认位置 `~/Documents/PuppyOne`、名称规则同 `requireProjectName`、可改位置、创建空文件夹后打开；Open a folder；Header 右侧 Sign in（打开 Settings → Account）
  - 实测（1280×800，区域一致率，容差 8）：有项目深色 97.6% / 浅色 97.5%、空状态 99.2%、创建对话框 97.9%。剩余差异为亚像素字形位置与 Import
  - 已知差异：Import（Git 克隆 / 云端来源）与模板链接以禁用态显示（悬停提示「not available」）；产品的首次启动遥测说明未移植
  - 证据：`project_names_and_folders_display_like_the_product`、`modification_times_round_down_to_minutes_hours_and_days`、`project_names_follow_the_product_rules`、`a_blank_project_is_a_new_empty_folder`、`a_repository_counts_its_commit_and_its_changes`、`relative_past_follows_intl_relative_time_format`；截图场景步骤 `home` / `remember:` / `forget:` / `create-project:`

### Settings
- [x] P1-11 Appearance：System/Light/Dark（带预览、跟随系统）、主题包、文件图标主题与显示开关、加载样式、Header 元素、指针样式；已移除 TS 退役的 Git 侧栏布局入口；主题包目录/添加、调色板、界面风格禁用展示
- [x] P1-12 Experimental：与 Web 同样的分组和全部行；有原生消费者的接通，其余禁用
- [x] P1-13 Project Info：名称、路径、模式、受保护状态、从最近项目移除
- [x] P1-14 Git：分支、分支数、上游、同步状态、HEAD、远程（复制 URL）、刷新。证据：`remote_labels_and_masking`、截图
- [x] P1-15 General：版本号行；更新行带图标
- [x] P1-16 Other App Imports 页（受 Experimental 开关控制）。证据：`project_and_import_pages_follow_visibility`
- [~] P1-17 Model Connections：列表 → 配置 → 详情的流程与文案已做。缺：本地服务发现、工具支持验证、托管连接

### 右侧 Agent / 工作台
- [x] P1-18 Agent 头部：Web 产品里 `AgentSurfaceHeader` 只在视觉冒烟 harness 中使用，实际由工作台 Tab 承担：品牌图标 + 标题，运行中叠加脉动圆点（`AuxiliaryWorkbenchStatus`）；会话菜单（新会话、History、压缩上下文、关闭连接 + Fork/Rename/Copy）在 Tab 右键菜单；诊断信息与产品的 `AgentPanelStatus` 一样，放在失败状态卡片里可展开（截图 `PUPPYONE_CAPTURE_SURFACE=agent-failed`）
- [x] P1-19 Launcher：已安装组 + 内置组（Built-in Agent、Terminal）；重新扫描、History 按钮、错误/可用性状态；历史浏览器独立
- [x] P1-20 模型配置入口跳转 Settings → Model Connections

### 右侧栏像素级对齐（参考流水线：`tools/reference-workbench.mjs` 渲染真实 TS 组件，`tools/capture-workbench.py` 对比原生 lab）

场景与当前一致率（容差 8，含 Chromium/CoreText 抗锯齿差）：

| 场景 | 深色 | 浅色 | 覆盖内容 |
| --- | --- | --- | --- |
| launcher | 99.54% | 99.52% | 居中行、Tab 栏底色、扫描/History 按钮 |
| chat-empty | 99.25% | 99.36% | 空态品牌标记、输入框、选择器 |
| chat-references | 98.89% | 99.01% | 40px 图片卡、`@path` 提及 chip |
| chat-picker | 99.02% | 99.13% | 选择器弹层（搜索、选中对勾） |
| close-dialog | 98.99% | 97.81% | 关闭确认对话框（浅色差异主要是遮罩 `blur(2px)`） |
| history-permission / history-list | 98.99% / 99.11% | 99.12% / 99.21% | 跨运行时历史浏览器 |
| tabs-narrow | 98.11% | 98.32% | 窄宽度 Tab 布局 |
| chat-transcript / tool-expanded / running / approval / question | 93.6–96.6% | 93.6–96.6% | 对话记录、工具 rail、审批/提问 dock |

已完成：
- [x] Tab 栏：产品几何（`header_layout`）、拖拽插入槽（虚线 accent / 拒绝时 danger）、源 Tab 0.56 透明度、拖拽 pill
- [x] 分屏：内容区半区预览（拒绝时 135° 斜纹）、按条目最小尺寸校验（chat 280×260、终端 188×196）、1px 分隔线 + 8px 命中区、拖拽钳制、Alt+Shift+方向键移动到边缘
- [x] 关闭确认：窗口级 380px `DesktopDialog`（chat/终端各自文案、Esc/背景点击关闭、初始焦点在取消）
- [x] 终端 Tab：Agent CLI 活动网格（`TerminalActivityController`：700ms 输出静默、250ms resize 屏蔽、braille/Cursor 标题协议）
- [x] 启动器：跨运行时 History 浏览器（权限门、合并排序、搜索、刷新、加载更多、已打开排除、来源提示）；容量不足时保留启动器并显示 `launchError`
- [x] 输入框：图片附件架、`@path` 原子提及（空输入 Backspace 删除）、选择器弹层（>6 项搜索、无匹配、N/M 页脚、键盘导航）
- [x] 对话记录：显示窗口截断提示（`AgentHistoryNotice`）、"Starting turn" 状态、空态 logo 悬停变色/按压 91%

## 4. P2 — 视觉与细节

- [x] P2-1 Settings 视觉：侧栏通栏分隔线、组间距、行高、标签色 `text-subtle`、开关/分段/下拉样式（截图核对，无像素比对门禁）
- [x] P2-2 Tab 栏：去掉 `⇵ ◫` 按钮（分屏走拖拽），`× … +` 改为图标，对话 Tab 显示 Agent 品牌图标（Codex 用单色 ChatGPT 标记，与 `AgentMonochromeBrandImage` 一致）
- [x] P2-3 空态：单色品牌标记（点击旋转）+ 本地化提示
- [x] P2-4 对话记录：用户消息气泡、助手消息无角色行、工具活动分组、回合耗时摘要、工作中指示、跳到最新
- [x] P2-5 输入框：选择器单行不换行、附件菜单（文件 + 项目引用）、发送按钮忙碌态
- [x] P2-6 Header 中项目按钮、右侧按钮几何与 Web 对齐
- [x] P2-7 弹层与侧栏页面对齐（以完整 TS 应用实测为参照，目标约 95% 而非逐像素）：
  - 菜单组件 `ui/components/menu.rs` 按 `DesktopMenuSurface` 变体（UI / left-sidebar 字体、popover / compact / 项目菜单阴影、3px 项目菜单内边距、侧栏 launcher 行几何且隐藏分隔线）；定位、视口夹取、外部点击与 Esc 关闭交给 GPUI Kit 的 `Popover` / `Positioner`（`ui/components/popover.rs`），不再手写坐标。证据：`explorer_row_menus_light_their_trigger_and_dismiss`、`project_popup_toggle_outside_and_escape_restore_focus`、`choosing_local_closes_popup_and_restores_trigger`
  - Explorer：行 ⋮ / + 以按钮矩形为锚（下 4px / 6px），右键以指针为锚，"New" 菜单与行同宽右对齐；菜单打开时行保持 open 态（底色、按钮高亮、操作可见）；条目顺序同 `DesktopNodeActionMenu`（含 Change file type，粘贴项禁用而非隐藏）；Custom files 为悬停子菜单；行几何改用桌面 token（content-left 6、gap 4、400 字重、19 行高、`TreeDisclosureMarker`、选中渐变）
  - Header：项目菜单挂在按钮下 2px、240 宽、`.desktop-project-menu` 外观；位置切换按钮只在 Cloud workspace 实验开启时出现；Changes 与 Agent 之间 1×18 分隔线
  - 布局：移植 `resolveDesktopPaneLayout`（Explorer 默认 320 / 220–520，右侧栏默认 560 / ≥320，主区 ≥320，主区先让、右侧栏次之）；右侧栏内容不再被 8px sash 内缩
  - 窗口下限（`window-layout:set-minimum-width`）：原生窗口最小宽度 = 打开的各栏最小宽度之和（+ Project Rail），且不低于 640 × 520；窗口已经更窄时（如在小窗口里打开右侧栏）自动加宽，不再把右侧栏挤出窗口右缘。全屏无法加宽时布局保持最小宽度。证据：`opening_a_pane_in_a_narrow_window_widens_it_to_the_pane_minima`、`the_window_minimum_follows_the_open_panes`
  - 工作台没有任何标签时，启动器铺满右侧栏、不显示标签栏（`AuxiliaryWorkbenchPanel` 的空态）；1280×800 fixture 右侧栏区域 99.7%
  - Changes：`GitChangesSidebar` 结构（安静标题 + History、可折叠 Staged/Unstaged/Merge/Committed 面板、行内 Commit / Stage and Commit、悬停行操作、12px 分隔、Pull 提示），提交使用产品默认消息（`buildDefaultCommitMessage`），去掉底部提交输入框与 Fetch/Refresh。证据：`empty_commits_take_the_product_default_message`
  - 实测（1280×800 深色，同一 fixture 仓库，区域一致率，容差 8）：节点菜单 98.2%、行 + 菜单 98.3%、New 菜单 98.3%、右键菜单 98.8%、项目菜单 98.1%、Changes 99.6%、Agent 右侧栏 97.7%
  - 复现：`dev-capture` 构建以 `PUPPYONE_SCREENSHOT=out.png PUPPYONE_CAPTURE_SCENARIO="select:src;node-menu:docs" ./target/debug/puppy-one-rust --workspace <repo>` 截图（步骤见 `src/shell/capture_scenario.rs`；窗口在后台、不抢焦点）
- [x] P2-9 Git 右侧栏（`GitChangesSidebar` / `WorkingFileDetail` / `GitFileDiffSurface` / `GitHistoryTimeline` / `GitCommitDetail`，`src/features/source_control/`）：
  - 点开改动在侧栏内打开文件 diff：顶部返回 + Open file / Stage（Unstage）/ Discard（`ButtonVariant::GitAction`），已删除文件不能打开；未跟踪文件也可丢弃（删除文件，同 `discardWorkspaceGitPaths`）
  - Diff Registry（`diff/mod.rs`）：按格式选择渲染器，顺序同产品（docx 修订视图原生暂缺，落到二进制摘要）。统一文本 diff：行号 / `+-` / 等宽、增删底色、hunk 分隔、长行换行、截断提示；二进制摘要：格式名、前后大小、打开当前文件。卡片头：文件名（重命名 `old → new`）、状态徽标、`+n −m`。变高虚拟列表渲染
  - 结构化 diff（`platform/git_diff.rs`）移植 `parseGitPatch`（每文件 900 行 / 总 4000 行上限）、未跟踪文件全部视为新增、二进制前后大小；Changes 列表的重命名显示 `old -> new`，状态字母按 Geist 度量对齐基线
  - History（`history.rs`、`platform/git_history.rs`）：按本地日期分组（今天 / 昨天 / 月日，8 种语言），可折叠；每条提交显示增删总数与最多 4 个文件预览（新增 `+`、删除 `−`、`+N files`）。提交详情：标题 + HEAD、可复制 ID、`N files changed +a -d`，下方为该提交的文件 diff（History 用页面密度：13px、42px 行号列）
  - 实测（1280×800 深色，`/tmp` 专用 Git fixture，右侧栏区域，容差 8）：Changes 列表 99.4%、代码 diff 96.0%（浅色 95.8%；剩余为 Chromium / CoreText 字形抗锯齿）、二进制 99.3%、新文件 99.5%、删除 99.5%、重命名 99.6%、History 99.4%、提交详情 99.4%
  - 已知差异：Pull / Push / Discard 的确认仍是侧栏内确认框（产品为对话框）；docx 修订视图、远程管理、待拉取改动审阅未移植
  - 证据：`patches_parse_like_parse_git_patch`、`long_patches_are_capped_per_file`、`working_tree_diffs_cover_each_scope`、`each_file_resolves_to_the_products_renderer`、`the_list_lays_out_cards_with_their_hunks`、`logs_merge_like_read_git_history`、`a_repository_reads_its_history_and_head`、`commits_group_by_day_newest_first`、`changes_open_file_opens_it_in_the_editor`；截图步骤 `git-diff:` / `git-diff-staged:` / `git-history` / `git-commit:`
- [x] P2-8 侧栏动效（移植 `explorerMotionPlan.ts` / `explorerMotionAnimation.ts` / `CollapsiblePaneFrame`）：
  - 文件夹展开 / 收起 220ms，产品的「平滑起步 → 匀速 → 平滑刹停」曲线（ramp 0.22）：新出现的行按连续段依次自上而下露出，消失的行留在原位作为幽灵行、最后一行先收起，其余行与列表末尾 New 行从旧位置平移（FLIP），展开箭头同步旋转；项目首次载入和换项目不播放（`src/shell/explorer/motion.rs`）
  - 侧栏开合 360ms `cubic-bezier(0.42, 0, 0.58, 1)`：只有外框宽度在动，内容保持展开宽度并贴住外侧边裁切，主区跟随；窗口缩放与拖动分隔条不播放，动画中途反向从当前画面开始（`src/shell/panes/motion.rs`）
  - 系统「减少动态效果」开启时两者都不播放。证据：`opening_a_folder_animates_its_rows_unless_motion_is_reduced`、`closing_the_explorer_moves_its_frame_unless_motion_is_reduced` 及两模块的单元测试
  - 逐帧核对：`dev-capture` 构建加 `PUPPYONE_MOTION_AT=<0..1>` 把动画定格在该进度截图（场景步骤 `expand:` / `collapse:` / `toggle-explorer` / `agent`）

## 5. 已知差异（有意保留）

- Changes 面板只在打开的文件夹就是仓库根目录时管理 Git；Web 用 `--is-inside-work-tree`，子目录也会管理整个仓库。Rust 保留这条限制，避免暂存/丢弃波及授权文件夹以外的文件。Settings → Git 页只读，子目录也能显示仓库信息。
- 右侧栏残余像素差（GPUI 能力边界）：行高/基线取整（≤2px 累积漂移）、无 `letter-spacing`（上下文分隔标签）、无 `backdrop-filter`（对话框遮罩模糊）、行内代码 chip 用占位字形近似、Mermaid 不渲染。
- `@path` 提及：Kit 文本框不能承载行内组件，提及 chip 排在提示词首行开头，而非任意光标位置。
- 历史日期按 en-US 格式（`Jan 15, 3:55 PM`）在本地时区显示；产品使用系统区域的 `Intl.DateTimeFormat`。
- 聚焦分组的 1px 内阴影在产品中被不透明子层完全覆盖（参考图像素验证），不移植。
- 拖拽 pill 的 `--po-surface` 在产品主题中未定义，产品实际为透明底；Rust 同样透明，且不画外阴影（GPUI 会把阴影画到透明主体下方）。

## 6. 验证

```bash
python3 tools/verify.py          # fmt、边界守护、本地化/资产/Agent 标记校验、UI 映射审计、测试、clippy、release
python3 tools/audit-ui-migration.py
```

截图：`PUPPYONE_SCREENSHOT=out.png PUPPYONE_LOCALE=zh-Hans PUPPYONE_CAPTURE_SURFACE=settings PUPPYONE_CAPTURE_SETTINGS_PAGE=Git ./target/debug/puppy-one-rust`（需 `--features dev-capture` 构建；`PUPPYONE_LOCALE` 代替系统语言）。

## 7. 原生编辑器：Markdown / CSV / 多窗格（Rust 原生，基于 GPUI Kit `editor_host`）

决定：MD 与 CSV 由 Rust 原生实现；正文文字由 **GPUI Kit `editor_host`** 排版与绘制（不修改 Kit 源码），宿主（本应用）负责文档、装饰、每个块的盒子几何、选区、光标、输入法和指针。沿用原型 `native_editor` 的分层与 Kit 适配方式（`collect_leaf_geometry` 叶子几何），文档内核改为与产品一致的“Markdown 源码为唯一真相”。Rust 版不再内嵌 WebView：所有文档都由原生编辑器打开，没有 WebView 兜底。

### 7.1 架构

完整说明见 `src/editor/ARCHITECTURE.md`（分层、依赖方向、各契约、如何新增 Markdown 功能、如何单独改某一种元素的样式）。要点：

- 视图层（`view/`）：`EditorView` + Kit `editor_host`；块组件契约 `BlockWidget::render(&mut WidgetCx)`，组件拿到块状态（整块选中 / 光标在内 / 编辑器聚焦 / 只读）和回到编辑器的命令通道（`Command`：功能 id + 类型化载荷）；渲染上下文拆在 `view/render/`。
- Markdown（`markdown/`）：`core/feature.rs` 功能契约（与产品 markdownFeatureContract 对应），`composition.rs` 是唯一的内置功能列表；每个功能是一个纵向切片（`features/{code_block,table,rule,task}/`：模型、计划、装饰、组件、命令、样式）；`style/` 每种元素一个类型化样式（surface / body / heading / inline / blockquote / list / block），`cascade.rs` 是行级 CSS 级联，`marks.rs` 是行内标记；core 不认识任何具体功能。
- 表格（`table/`）：CSV 与 Markdown 表格共用的可编辑表格基础件：列宽、结构操作词汇、`--po-editable-table-*` 样式、画布绘制、手势（`Tracks` 几何 + `Gestures` 状态：悬停、行列拖动与落点、结构选区、列宽拖拽）、增行 / 增列条与手柄、操作菜单。
- CSV（`csv/`）：`CsvEditor` 由各部件组合（视口、活动单元格、共享手势、菜单、扩展控件、引用单元格、查找）。

像素对齐手段（均不改 Kit）：
- 块几何由宿主按产品 CSS 精确计算并绝对定位（GPUI 会把盒子和行高取整到像素，逐块累计会漂移）；行数用 GPUI `shape_text` 以与 Kit 相同的 run 预测，Kit 实际行数不同则下一帧校正。
- 每个 Kit 文字叶子按 Chromium 的规则放置，使首行基线落在同一设备像素（Chromium：上下 metrics 取整到设备像素、上半 leading 向下取整；GPUI：整数行高、按实际 metrics 居中、基线取整）。
- 字体：`tools/import-editor-fonts.py` 生成 Geist 各字重静态实例与合成斜体；450 / 500 族的 Bold 槽放 Geist 600（Kit 粗体 = 产品 strong 600）；“PuppyOne Geist Mono Inline” 为 875 units/em，Kit 行内代码按 0.875 缩放后正好是产品的满字号 Geist Mono（只在编辑器构建段落时替换 Kit 主题等宽字体，不影响 Agent 等其他 Kit 文本）。
- 字体平滑：产品全局 `-webkit-font-smoothing: antialiased`；进程启动时把本应用的 `AppleFontSmoothing` 设为 0，GPUI 不再加粗浅色字形（`platform/text_rendering.rs`）。

### 7.2 验收（`tools/compare-native-geometry.py` + 截图像素对比）

- 产品参照：`electron tools/probe-editor.mjs artifacts/probe/sample*.json`（字符矩形、行盒、组件盒、截图）。
- 原生：`dev-capture` 构建，`PUPPYONE_EDITOR_GEOMETRY=out.json`（字符矩形，坐标同参照）；`PUPPYONE_EDITOR_SCROLL` 用于截取下半部分。
- 历史 `fixtures/editor/sample.md`（旧 Web 样式，深色 / 中号；不是本次最新样式的验收结果）：
  - 所有块的位置和高度与参照完全一致（H1 48/71、H2 56.5、H3 47.5、代码块 114、表格 147、分隔线 37）。
  - 字符位置：标题 0.00–0.09px，列表 / 任务 / 引用 ≤0.13px（垂直 0.25px），表格单元格 ≤0.05px，代码块 ≤0.05px。
  - 像素一致率（逐像素差 ≤8）：首屏 99.0%，滚动后的下半部分 99.84%（代码块 100%、表格 99.98%）。

本次最新 Web 样式回归（`tools/verify-editor-style.py`，14 场景，ICC 归一化至 sRGB）：
- 深浅色 × 三档字号的标题、正文、行内代码继承色；正文按内容语言选择 450 / 500；Blink 小数行盒截断与两侧 scrollbar gutter；独立 Markdown 自动列宽（84 个真实 TS oracle 案例）；不改 CSV 列宽策略。
- 所有场景的顶层块边界最大差异 **0.000px**。这不表示块内每个字符或选区像素都一致。
- 两次完整运行中，样式 / 表格逐像素完全相同约 **95.69–98.78%**，RGB 容差 8 约 **97.77–99.69%**；聚焦选区完全相同约 **90.31–97.87%**（浅色选区大面积相差约一个色阶）。截图的细微色阶 / 状态变化仍影响严格分数，不把较好的一次当成固定 golden。背景像素也计入分母，不能把这个数等同于功能完成率。
- `--check` 明确失败，**尚未达到像素级验收**；没有忽略滚动条、选区或字体差异。保留官方 GPUI Kit，没有 fork / patch。
- 345 个应用测试通过（两种 features），9 ignored；Clippy / release / 帧预算通过。继承的 localization 与 native-editor-probe 全验证问题仍未解决。

### 7.3 已知差异（未改 Kit，严格像素验收仍未通过）

- Kit 文本标记无法单独设颜色：粗体颜色（#fafafa vs 正文 #e8e8ea）、斜体灰色、删除线颜色、光标进入时显示的 `**` / `[` / `](url)` 灰色，均按正文色绘制。
- 链接：Kit 固定加 1px、40% 链接色的下划线。
- 行内代码：Kit 固定两侧各 4px 内边距（`INLINE_CODE_PADDING`），其后文字右移 8px；字体与字号已一致。
- GPUI 行高取整到整像素：多行换行段落第 2 行起每行有 ±0.25px 的行距差（块边界已精确）。
- Web 原生滚动条、代码内部换行的选区尾格，以及两个渲染器的字形/颜色量化仍有差异。代码块的聚焦底色和悬停描边已同步；比图会等待 Web 的 140ms 焦点描边过渡完成。

### 7.4 进度

- [x] N1 主题 token 导入与强类型主题（含 editable-table 契约）
- [x] N2 编辑字体（静态字重、合成斜体、Bold 槽、行内代码族、`ch` 度量）
- [x] N3 文本内核（单元测试）
- [x] N4 视图：基于 Kit `editor_host` 重写（块几何、基线对齐、Kit 叶子几何上的光标 / 命中 / 选区 / 行边界、输入法、指针）
- [x] N5 Markdown 语法、块节奏、计划、装饰：标题、段落、强调 / 粗体 / 删除线 / 行内代码 / 链接 / 维基链接 / 转义（含源码揭示）、列表（符号、编号列、嵌套）、任务、引用、分隔线、空行节奏、正在输入的块前缀行、隐藏块标记的光标规则
- [~] N6 Markdown widget
  - [x] 分隔线、代码块（Kit CodeBlock 叶子 + tree-sitter 高亮，映射到产品 11 个颜色角色）、表格（单元格 Kit 叶子直接编辑、表头、边框）
  - [x] 表格交互（共用表格基础件）：增行 / 增列条、行列拖动手柄（拖动移动、单击打开该轴菜单）、右键操作菜单（行、列、对齐、删除表格）、落点线、结构选区；每次结构修改都是一次源码事务（按产品 `serializeMarkdownTable` 重写整表，单步撤销），光标落到目标单元格
  - [x] 块级状态：整块选中时代码块显示选中描边（`--cm-md-block-selected-ring`）、表格边框变为选区色并加 1px 外描边，块内不再画文字选区；代码块悬停 / 光标在内时显示悬停描边
  - [ ] Markdown 表格列宽拖拽（`tableColumnLayoutController`）、单元格内编辑器（产品为浮层输入框）、Mermaid / HTML / 数学 / 图片等其余块功能
- [x] N7 Markdown 命令与键位：回车续列表与重新编号、引用续行、Tab 缩进、标题 / 列表 / 引用切换、行内格式切换、链接、标记删除单元、← / Home 跨隐藏标记、任务切换；源码模式
- [x] N8 原生几何与截图对比工具；sample.md 对比通过
- [~] N9 CSV 原生（`fixtures/editor/sample.csv` 对 `artifacts/editor-reference/csv-{dark,light}.png`：像素一致率 99.98%，所有单元格文字 dx/dy = 0.00，记录号 ≤0.02px）
  - [x] 文档模型、结构操作、历史、列宽（单元测试）
  - [x] 表格绘制：每个单元格自带右 / 下边框（`border-collapse: separate`），最后一列 / 行无边框，四角单元格 9px 圆角，每个像素只画一次；粘性表头（z3）、粘性记录号列（z2，横向滚动后加左边框）、角落（z4），粘性背景为叠在编辑器底色上的不透明色
  - [x] 单元格文字按 `<input>` 规则放置：输入框高度为 100%，Chromium 对内部编辑器改用 `line-height: normal`（13+4=17px）并在内容盒中居中
  - [x] 活动单元格：原生 `EditorView`（与静态文字逐像素一致），2px 聚焦框；Tab / Shift-Tab 按阅读顺序移动，Enter / Esc 无动作，⌘Z 走表格模型历史，粘贴的换行被去掉；点击时光标落在指针处
  - [x] 悬停显示增行 / 增列条（含 + 号）与右下角扩展控件；源码模式（纯文本编辑器）与切换按钮；DocumentEditor 接入（快照 / 脏标记 / 历史 / 只读）
  - [x] 列宽：悬停列右边缘的 9px 调整条（强调色线）、指针捕获拖拽（96–560，Esc 取消）、双击自适应；窗格菜单的“适应视口宽度 / 重置列宽”（`fitEditableTableColumnWidths` 逐项移植）
  - [x] 表头 / 行号开关与每文档视图偏好（表头、行号、列宽 + 分隔符；最近 200 个文档；后台原子写入）
  - [x] 表格操作菜单（`po-editable-table-context-menu` 图标工具栏，共用于 Markdown 表格）：单元格 / 表头 / 记录号右键，方向键 / Home / End / 首字母跳转、Enter 执行、Esc 关闭并归还焦点；移动类操作结束编辑并留下结构选区
  - [x] 行 / 列拖动手柄：跟随悬停，靠近滚动边缘时停靠进粘性表头 / 行号格（遮住文字），单击打开该轴菜单（高亮行 / 列），拖动超过 4px 显示落点线并在松开时移动，Esc 取消；结构选区为 2px 外框，点单元格或 Esc 清除
  - [x] 右下角扩展控件：拖拽按整行（31px）/ 整列（96px）预览并扩展（预览单元格、强调色外框、尺寸状态条，纵向受视口限制，横向贴边自动滚动），单击打开 6×6 尺寸选择器（悬停 / 方向键 / Enter）
  - [x] 引用单元格（`documentNavigation` 的整值识别：URL、Markdown 链接、维基链接、工作区路径，拒绝不安全协议 / 凭据 / 控制字符）：外链显示为下划线链接、点击打开；工作区链接显示标签、悬停操作按钮与来源预览，⌘ 点击打开；宿主解析器接口与 `OpenPaths` 打开消息已就绪
  - [x] 查找适配器（`useCsvFindAdapter`）：匹配单元格着色与内框、当前项 2px 框、编辑后保持当前项
  - [x] 宿主侧：已加载工作区元数据解析、窗格 ⋯ 菜单与查找栏接入。证据：`csv_contributes_view_items_and_find`、`csv_references_use_real_workspace_and_follow_directory_rebinds`；完整 backlinks/跨 Root 等另归 §0.3
  - 截图核对暂停：当前机器处于锁屏，`screencapture -l` 只返回旧图；交互部分已用 GPUI 测试覆盖，解锁后补拍悬停 / 菜单 / 拖拽状态
- [~] N10 编辑器工作台原生
  - [x] 窗格外框（单窗格）：⋯ 手柄（窗格上三分之一悬停显示）、动作菜单（Markdown 实时 / 源码分段控件、查找、用默认应用打开、关闭；CSV 的表头 / 行号开关与列宽命令；开关不关菜单、命令关菜单；方向键 / Home / End / Enter / Esc）
  - [x] 查找栏（`EditorFindHost`）：⌘F / 菜单打开，Enter / ⇧Enter 上下，结果“n / 共 m”，Esc 关闭并回到编辑器；CSV 适配器与编辑视图适配器（CodeMirror 等价：不区分大小写的字面匹配、当前项选中并居中、匹配标记与当前项外框、编辑后保持）
  - [~] 本地标签/MRU、递归分屏与 Pane 移动/调宽、独立 Working Copy、原生布局恢复和本地项目文档保活已接进 Shell；真实 TS 600 个 Pane 转换及原生 Undo/后台保存集成测试覆盖。本批补充本地资源历史重绑定、Explorer 状态保活与同工作区边缘拖放。**不是完整工作台迁移**：Cloud、完整 Pane 视图生命周期、跨 Root composition、扩展名变化后的 viewer 转换、并发资源队列与跨应用拖放等仍缺失；详见 §0.3 与 README 的 Retained Editor workbench。
  - 已知差异：当前匹配被选中时，选区由 Kit 绘制在匹配底色之上（产品为底色在选区之上），颜色叠加顺序略有不同
- [~] N11 路由：MD / CSV / 纯文本只走原生编辑器；WebView 编辑器、其产品代码打包（`editor/`）和 GUI 冒烟驱动已删除，不存在回退路径。缺：代码 / JSON 语法高亮，HTML / PDF / 媒体查看器；原型 `native_editor` 已删除（其自绘输入框无人使用，一并删除；共享编辑动作在 `src/ui/input.rs`，文档格式动作在 `src/editor/actions.rs`）

## 8. 图标注册与共享 Loading 验证（2026-10-27）

- 范围是 `fileFormats → FileSemanticKind → file-icon theme → FileIcon` 与七种 `ProductIcon`；不是 SaaS Logo / 营销素材迁移。那些试验新增文件已移出工作树，本轮不交付。
- 双配置测试各 **351 passed / 9 ignored**；fmt、双配置 Clippy、release、导入物 / 分层 / UI 边界检查、编辑器帧预算通过。整套 `verify.py` 的既有本地化快照与 retired native-probe 问题未在本轮解决。
- `tools/verify-ui-assets.py` 同时渲染真实 TS 和原生共享 fixture：21 个产品图标样本、132 个文件图标（22 类型 × 四种尺寸及两种继承色）、60 个 LoadingMark、2 个 placeholder；深浅色 × 5 时间点，共 10 张组件板，另有 4 张 reduced-motion 板。
- 原生截图先等全部 glyph 解码，再取 OS 图；Web 等字体、组件与冻结动画就绪。保留原图、ICC 归一化后的对比、逐组件分数和差分；不会屏蔽不同像素。
- 全板 exact **96.89–98.46%**；文件图标槽平均 exact **93.97%**、容差 8 **97.16%**。这些都包含背景，**严格 `--strict` 仍失败**，不作像素验收通过声明。不同光栅器的抗锯齿、色阶、alpha 量化和窗口圆角仍有差异。
- 深浅色下，reduced-motion 的 0s / 2.1s 原生图各自完全相同，Web 图也各自相同；dither 的 27 个 TS alpha oracle 逐字节匹配。并未测得 GPU 提交或真实输入延迟保证。
- 大型 `FilePreviewIcon` 卡片预览不在已移植范围；不改 GPUI Kit、不牺牲既有可见区渲染 / 面板缓存。

## 9. Workspace Provider 底座（Cloud 接入第一步）

- [x] `workspace.rs` 统一入口 + `contracts.rs` / `ports.rs`，本地适配器私有；稳定存储/资源身份与可撤销打开租约分离。
- [x] 本地目录、文档条件读写、新建/重命名/移动/复制/导入/删除、预览与文档观察走端口；类型化错误在展示边界转成文字。
- [x] Provider 变更通知取代 Documents 自行定时观察；本地保留 500ms 观察，订阅有界合并、Drop/撤销清理；不是完整目录监听 journal。
- [x] 原文件系统测试经统一入口运行；无本地目录的内存 Provider 验证真实 Documents 保存/预览流程；覆盖身份隔离、权限准入、迟到结果、未知写入结果和监听清理。
- [~] Cloud 认证与 live 文件 Provider 的已验证切片见下节；账号/项目导航和保活、Cloud 草稿冲突策略仍待接入，不因端口或登录存在标为已迁移。

## Native Cloud authentication（第二步）

- [x] 原生 Broker + 独立 macOS Keychain adapter；恢复/刷新合并、账号/环境代次、取消/超时、退出和安全回调；不导入 TS 凭据，不做明文回退。协议参考来源与实际脏输入哈希由 `fixtures/cloud/auth-reference.json` / `tools/check-auth-reference.py` 固定。
- [x] Settings 投影真实公开状态及登录/重开浏览器/取消/重试/退出；原生服务不依赖 GPUI，视图不持有令牌。不确定业务写入不自动重放；Cloud 打开、Billing/订阅依然禁用。
- [x] 正常关闭在现有 Shell 屏障等待凭据修改与失败回滚；清理失败阻止关闭，文档沿原会话恢复输入/监听，普通关闭不当作退出登录。证据：`close_preflight_waits_for_slow_vault_work_before_framework_shutdown`、`failed_rollback_blocks_close_until_cleanup_succeeds`、`another_close_participant_failure_thaws_the_same_session_and_resumes_its_watch`。
- [x] 29 项认证测试 + GPUI 公开投影回归，使用合成 Supabase、真实本地 TCP/HTTP 和内存凭据；全部 Rust 回归两配置各 392 passed / 9 ignored，Clippy / release / frame budgets 通过。
- [ ] 实际 Keychain/系统浏览器/托管测试账号验收、Windows/Linux、同 profile 多进程协作。回调结果页为纯文本，错误诊断仍为原生英文；完整本地化和像素一致未验收。不得用本地 fixture 替代真实环境验收。
- [ ] 完整多根/多文档工作副本注册表、跨平台实机与严格像素一致性：仍未完成。

## Live Cloud file Provider（第三步协议切片）

- [x] 项目根 context + running workbench/generation + 实际根列表准备；5 秒一次性收据。独立 Provider 实现 live list/read、CAS、新建/目录、重命名/移动/删除、不可变字节预览，无本地镜像或 Git 内容回退。
- [x] Broker 持有 HTTP/SSE 与凭据；绑定账号/环境/lease，路径与文件完整性校验，Cloud 8 MiB/10,000 条目与本地原有边界分开；BOM/CRLF 保留，不确定写入不重放。
- [x] 文档/树订阅共享有界 reset SSE；失效后重读、有限重连、正常 token 续期、取消/Drop/权限与 generation 撤权；无 Agent cursor、文件轮询或自动唤醒计算。
- [x] 20 项新增真实 loopback 协议/故障测试；两配置各 412 passed / 9 ignored，Clippy 通过；12 个 TS/后端输入哈希由 `tools/check-cloud-reference.py` 固定。不是实际后端或托管验收。
- [ ] 显式 workbench 创建/唤醒、opening/polling/recovery 准备状态机；当前适配器只接入 running workbench。
- [ ] 按项目选择 → 显式准备 → Explorer → 既有 Editor → 工作区切换的完整链路接入；把 TS 已有 Cloud 草稿/未知写结果行为一起迁移，不另建冲突策略项目或后端 CAS。当前 Cloud UI 仍禁用；本地保活切片不代表 Cloud 导航、执行隔离或保存语义通过。
- [ ] Scope、Cloud 复制/导入、本地执行能力不开放；真实账号/项目、平台、可访问性、大文件编辑延迟和严格视觉验收未覆盖。localization 与旧 probe 验证入口已在 §0.4 收口，其他缺口继续保留。

## 10. 明确不在本轮范围

需要 Cloud 服务或平台服务、当前没有原生实现的功能保持如实提示，不伪造：Plan 计费、Host Server、自动更新下载、Feedback 上传、Share/Reach、子主题包安装、Windows XP 界面风格。Account 登录须显式配置原生 API/Web 环境；服务实现与本地协议测试不等于真实账号验收。
