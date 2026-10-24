# Rust 前端与 Web 产品对齐 TODO

参考实现：`../../puppyone-qubits`（`product-source.json`）。本清单只覆盖左侧栏、Header、Settings、右侧 Agent/工作台以及它们依赖的样式与本地化基础设施。
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

## 1. 基础设施

- [x] S1 样式 token：`theme.rs` 从 5 个内置主题包（`assets/themes.json`，`tools/import-themes.mjs`）+ `tokens.css` 语义层公式构建；控件几何、UI 字号角色随三档尺度变化。证据：`semantic_tokens_follow_the_web_formulas`、`medium_literals_follow_the_product_role_table`
- [x] S2 样式原语：`src/ui/primitives.rs`（sidebar row/group、settings row/switch/segment/select/action、tooltip 化 icon button）、`src/ui/menu.rs`、`src/ui/pulse_grid.rs`
- [x] S3 本地化：加入 `source-control` 命名空间；ICU 子集覆盖目录实际用到的 `{arg}`、`number`、`plural`（含 `=N`、`#`），`select` 目录未使用故未实现；全局当前语言 + `localization::spawn` 让工作线程继承语言。证据：`icu_subset_matches_product_catalog_usage`、`workers_inherit_the_spawning_locale`
- [x] S4 图标：Lucide 0.562 导入清单扩充；Agent 入口图标；`tools/generate-assets-rs.py` 生成资产表。证据：`referenced_icons_exist`
- [x] S5 文件类型图标：5 套图标主题生成 light/dark SVG（`tools/import-file-icons.mjs`）；扩展名 → 语义类型与 Web 注册表一致。证据：`classification_and_display_follow_the_product_registry`
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
- [x] P1-8 底部栏与产品一致：只有 Settings + Help（产品 `useWorkspaceSurfaceContent` 把 `git` 从底部导航过滤掉，Changes 在 Header）；无分割线，树在仍有下方行时以 18px 渐隐过渡到底部栏（`useScrollEdgeState`）；高度 = control + 16 随文字尺度变化，按钮 control−4、图标 14px / 描边 1.65、utility 色（`mix(muted 80%, sidebar)`），Help 用产品自有 `FeedbackHelpIcon`。证据：`sidebar_footer_follows_the_navigation_height_formula`、`sidebar_tree_fade_follows_use_scroll_edge_state`、`sidebar_tree_fades_into_the_footer_only_while_rows_remain_below`。已知差异：忙碌时右侧的 pulse grid 是原生临时进度提示（产品用 `FloatingNoticeStack`，尚未移植）；Project Rail 打开时产品隐藏底部栏、把工具按钮移入 Rail，原生未移植
- [~] P1-9 最近项目持久化；项目菜单（项目列表、打开文件夹、首页、移除）；Project Rail 列出项目。缺：Rail 上的重命名/取消关联（`ProjectRowActions`）。证据：`project_history_is_most_recent_first_and_bounded`
- [x] P1-10 首页（Home）：最近项目 + 打开文件夹；品牌标记 28px，标题为 `text-muted`，深色下标记按产品 `grayscale(1) brightness(0.7)` 预烘焙（`brand/puppy-dark-onboarding.svg`）。已知差异：GPUI 无 letter-spacing（产品 −0.035em）

### Settings
- [x] P1-11 Appearance：System/Light/Dark（带预览、跟随系统）、主题包、文件图标主题、Git 侧栏布局、加载动画、Header 元素、指针样式；主题包目录/添加、调色板、界面风格禁用展示
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
  - Changes：`GitChangesSidebar` 结构（安静标题 + History、可折叠 Staged/Unstaged/Merge/Committed 面板、行内 Commit / Stage and Commit、悬停行操作、12px 分隔、Pull 提示），提交使用产品默认消息（`buildDefaultCommitMessage`），去掉底部提交输入框与 Fetch/Refresh。证据：`empty_commits_take_the_product_default_message`
  - 实测（1280×800 深色，同一 fixture 仓库，区域一致率，容差 8）：节点菜单 98.2%、行 + 菜单 98.3%、New 菜单 98.3%、右键菜单 98.8%、项目菜单 98.1%、Changes 99.6%、Agent 右侧栏 97.7%
  - 复现：`dev-capture` 构建以 `PUPPYONE_SCREENSHOT=out.png PUPPYONE_CAPTURE_SCENARIO="select:src;node-menu:docs" ./target/debug/puppy-one-rust --workspace <repo>` 截图（步骤见 `src/shell/capture_scenario.rs`；窗口在后台、不抢焦点）

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
- 字体：`tools/import-editor-fonts.py` 生成 Geist 各字重静态实例与合成斜体；500 族的 Bold 槽放 Geist 600（Kit 粗体 = 产品 strong 600）；“PuppyOne Geist Mono Inline” 为 875 units/em，Kit 行内代码按 0.875 缩放后正好是产品的满字号 Geist Mono（只在编辑器构建段落时替换 Kit 主题等宽字体，不影响 Agent 等其他 Kit 文本）。
- 字体平滑：产品全局 `-webkit-font-smoothing: antialiased`；进程启动时把本应用的 `AppleFontSmoothing` 设为 0，GPUI 不再加粗浅色字形（`platform/text_rendering.rs`）。

### 7.2 验收（`tools/compare-native-geometry.py` + 截图像素对比）

- 产品参照：`electron tools/probe-editor.mjs artifacts/probe/sample*.json`（字符矩形、行盒、组件盒、截图）。
- 原生：`dev-capture` 构建，`PUPPYONE_EDITOR_GEOMETRY=out.json`（字符矩形，坐标同参照）；`PUPPYONE_EDITOR_SCROLL` 用于截取下半部分。
- 当前 `fixtures/editor/sample.md`（深色 / 中号）：
  - 所有块的位置和高度与参照完全一致（H1 48/71、H2 56.5、H3 47.5、代码块 114、表格 147、分隔线 37）。
  - 字符位置：标题 0.00–0.09px，列表 / 任务 / 引用 ≤0.13px（垂直 0.25px），表格单元格 ≤0.05px，代码块 ≤0.05px。
  - 像素一致率（逐像素差 ≤8）：首屏 99.0%，滚动后的下半部分 99.84%（代码块 100%、表格 99.98%）。

### 7.3 已知差异（GPUI Kit 公开接口做不到，按决定暂不处理）

- Kit 文本标记无法单独设颜色：粗体颜色（#fafafa vs 正文 #e8e8ea）、斜体灰色、删除线颜色、光标进入时显示的 `**` / `[` / `](url)` 灰色，均按正文色绘制。
- 链接：Kit 固定加 1px、40% 链接色的下划线。
- 行内代码：Kit 固定两侧各 4px 内边距（`INLINE_CODE_PADDING`），其后文字右移 8px；字体与字号已一致。
- GPUI 行高取整到整像素：多行换行段落第 2 行起每行有 ±0.25px 的行距差（块边界已精确）。

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
  - [ ] 宿主侧：工作区引用解析（产品用 Markdown 链接图）、窗格 ⋯ 菜单与查找栏接入（N10）
  - 截图核对暂停：当前机器处于锁屏，`screencapture -l` 只返回旧图；交互部分已用 GPUI 测试覆盖，解锁后补拍悬停 / 菜单 / 拖拽状态
- [~] N10 编辑器工作台原生
  - [x] 窗格外框（单窗格）：⋯ 手柄（窗格上三分之一悬停显示）、动作菜单（Markdown 实时 / 源码分段控件、查找、用默认应用打开、关闭；CSV 的表头 / 行号开关与列宽命令；开关不关菜单、命令关菜单；方向键 / Home / End / Enter / Esc）
  - [x] 查找栏（`EditorFindHost`）：⌘F / 菜单打开，Enter / ⇧Enter 上下，结果“n / 共 m”，Esc 关闭并回到编辑器；CSV 适配器与编辑视图适配器（CodeMirror 等价：不区分大小写的字面匹配、当前项选中并居中、匹配标记与当前项外框、编辑后保持）
  - [ ] 标签页（`EditorHeaderTabs`）、分屏与拖动窗格、每窗格独立文档会话、工作台布局持久化
  - 已知差异：当前匹配被选中时，选区由 Kit 绘制在匹配底色之上（产品为底色在选区之上），颜色叠加顺序略有不同
- [~] N11 路由：MD / CSV / 纯文本只走原生编辑器；WebView 编辑器、其产品代码打包（`editor/`）和 GUI 冒烟驱动已删除，不存在回退路径。缺：代码 / JSON 语法高亮，HTML / PDF / 媒体查看器；退役原型 `native_editor` 的富文本模型

## 8. 明确不在本轮范围

需要 Cloud 服务或平台服务、当前没有原生实现的功能保持如实提示，不伪造：Account 登录、Plan 计费、Host Server、自动更新下载、Feedback 上传、Share/Reach、子主题包安装、Windows XP 界面风格。
