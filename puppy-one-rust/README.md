# PuppyOne Rust — GPUI local workspace / Markdown integration

> **Rust 前端现统一依赖 GPUI Kit 0.8.0（其 GPUI 后端为 gpui-pre 0.3.9）。**
> 可以打开真实文件夹、编辑已有文本文件并保存；文档编辑器全部是 **Rust 原生实现**（Markdown 实时预览、CSV 表格、纯文本），不再内嵌 WebView。
> 仍是实验版本：不是现有 Desktop 的完整替代品，未通过像素级验收。先用测试文件夹试用。
> 当前产品规范仍归 [puppy-issues / puppyone-desktop](https://github.com/puppyone-ai/puppy-issues/tree/main/document/puppyone-desktop)；本目录不改变现有 Electron 产品或发布入口。

## 启动

```bash
cd puppy-one-rust   # 仓库根目录下
export PATH="$HOME/.cargo/bin:$PATH"
cargo run --release --locked
```

启动后点击 **Open folder…**，也可以通过 `⌘O` 选目录。Header 项目菜单目前只有 local/cloud 位置入口，不是完整项目管理器。

直接打开一个文件夹 / 文件：

```bash
cargo run --release --locked -- --workspace /path/to/project
cargo run --release --locked -- --workspace /path/to/project --file README.md
```

`--file` 必须是所选目录内的相对路径。默认不再展示虚构文件树；旧视觉 fixture 需显式设置 `PUPPYONE_FIXTURE=1`，或进入截图模式。

验证平台：**macOS 26.5 / Apple Silicon，Rust 1.97.1**。Windows / Linux 未构建、打包或实机验证。需要 Rust 和系统原生构建工具；构建 / 运行不需要 Node。GPUI Kit 固定为 crates.io `0.8.0`，使用其配套 GPUI/平台后端；macOS 使用 Metal。首次构建需下载 Cargo 依赖。

## GPUI Kit 复用范围

- `gpui_kit::application/open_window`：平台入口、窗口 Root、焦点和组件初始化；不维护 Kit fork。
- 界面控件来自产品组件库 `src/ui/components/`（见下节）：外观是 PuppyOne 的，行为——焦点、键盘、弹层定位与关闭、对话框焦点陷阱——来自 Kit 的无样式层 `gpui-base`。Kit 不 fork、不改源码，也不使用 `gpui-component` 的默认外观组件（如 `PopupMenu`）。
- 普通表单、Agent composer、Git commit、模型配置及问答字段使用 Kit Input/Textarea。选择、文本编辑、IME 事务和撤销交给 Kit；薄适配器保留长度限制、Tab 焦点和 ⌘Enter。
- Agent Markdown 使用 Kit TextView，代码复制和受限链接保留；正文中的图片地址不会自动读取本地文件或请求网络。
- 原生文档编辑器（`src/editor/`）由 Kit 公开的 `text::editor_host` 排版和绘制正文；文档、装饰、块几何、选区、光标、输入法和指针由应用持有（见 [`src/editor/ARCHITECTURE.md`](src/editor/ARCHITECTURE.md)）。Kit 不是完整的编辑内核；文件树加载、分屏拓扑、Terminal/Agent 运行和文件保存同样保留各自 owner。

未采用 `gpui-kit-markdown-editor` 或其他独立编辑器库。GPUI Kit 上游在 2026-10-23 查询时为 18,506 stars；这是本次选型门槛，不是成熟度或无缺陷保证。此后新增直接依赖仍需按用户的项目规模限制评估。

## 组件库（`src/ui/components/`）

产品界面只用这里的组件，功能代码不自己画控件：

- 写法与 Kit 一致：每个组件是 `#[derive(IntoElement)]` + `RenderOnce` 的结构体，用链式方法配置（`Button::new(id).variant(..).icon(..).label(..)`），状态走 Kit 的 `Selectable`（选中 / 展开）、`Disableable`、`Sizable` trait，需要微调布局时实现 `Styled`。
- 颜色从全局外观读取（`cx.palette()` / `cx.is_dark()`，见 `ui/appearance.rs`），不再由调用方传 `Theme` 或 `dark` 参数。
- 现有组件：`Button`（Outline / Filled / Ghost / Titlebar / 对话框等变体）、`IconButton`、`Icon` / `FileIcon`、`Switch`、`SegmentedControl`、`Select`、`Menu` / `MenuItem`、`PopoverMenu`（挂在触发按钮上）、`AnchoredMenu`（右键菜单）、`Dialog`、`SidebarRow` / `SectionHeader` / `SidebarGroup` / `RowActionButton`、`ResizeHandle`（面板边缘与工作台分屏共用的拖拽手柄：8px 命中带 + 1px 描边，悬停 / 拖动色来自 `--po-pane-resizer-*` token）、设置页的 `SettingsSection` / `SettingRow` / `ValueRow` 等，以及 `Spinner`、`tooltip`。
- 弹层统一交给 Kit 的 `Popover` / `Positioner`：位置、贴边、点外部和 Esc 关闭、焦点恢复都不手写。
- 有限动画统一用 `ui/motion.rs` 的 `Timeline`（面板开合、Explorer 展开）；持续 Loading 由 `ui/loading/` 的共享调度器管理，不能每个页面再造一套计时器。
- 样例页：`PUPPYONE_LAB=gallery-dark`（或 `gallery-light`、`gallery-dialog-dark`）配合 `dev-capture` 构建打开，展示所有组件和状态。
- `tools/check-ui-boundaries.py` 会拦截：功能 / Shell 代码里使用 Kit 默认外观组件（`gpui_kit::component::{button,menu,…}`、`PopupMenu` 等）、自建配色（`Theme::new`），以及已退役的旧辅助文件（`ui/primitives.rs`、`ui/menu.rs` 等）重新出现。

## 文件与产品图标注册表

- `formats/` 是文件分类的唯一 owner；`file_kind.rs` 的主题注册表必须完整覆盖其 22 种语义类型，未知文件才走 `file`，不能用通用图标掩盖缺失的已知类型。
- `FileIcon` 消费名称、可选类型/MIME、主题和尺寸。生成物保存参数化 SVG、线宽策略与语义颜色绑定；渲染时读取当前 palette 和所在行的文字颜色，按实际 DPR 栅格化。14px 与 18px 图标都保持产品规定的 1px 主线宽。JSON 的 `{}` 使用产品 Geist 600 轮廓，不依赖系统 SVG 字体替代。
- `Icon::product(ProductIcon::Cloud)` 等通过 `asset_catalog.rs` 的七种产品语义统一选图；Sidebar、Header 和菜单不再直接挑同义 Lucide 图形。`tools/check-ui-boundaries.py` 守护这一边界。
- 当前 TS 只注册 `default` 文件图标主题；旧主题偏好按导入的迁移表归并，单主题时不显示无意义的设置选择器。
- `ui/loading/` 提供 rounded / dither mark 与 placeholder，保留真实 TS 中仍使用环形 Spinner 的特例；macOS reduced motion 在启动和窗口重新激活时读取。

```bash
node tools/import-file-icons.mjs --check  # 注册表、852 个分类样本、308 个尺寸/线宽样本
node tools/import-ui-assets.mjs --check   # 产品语义图标与 Loading，不导入 SaaS Logo
python3 tools/generate-assets-rs.py --check
# dev-capture binary；实际 TS 组件 vs native，原图/分项收据留在 artifacts/ui-assets/
python3 tools/verify-ui-assets.py --binary /path/to/dev-capture/puppy-one-rust --strict
```

严格逐像素比对仍有光栅、色阶等差异，不能把登记覆盖或含背景的高分当作像素验收。当前范围是紧凑文件 glyph、产品语义图标与 Loading；大型 `FilePreviewIcon` 卡片预览不是已完成项。权威契约见 [Native Appearance and Components](https://github.com/puppyone-ai/puppy-issues/blob/main/document/puppyone-desktop/platform/rust-native-frontend/appearance-and-components.md)。

## Shell 结构（`src/shell/`）

`Shell` 是窗口的组合根：持有文档会话（`Documents`）、偏好、Git / 工作台等实体，把命令分发给各部分，并按帧布局。界面各部分有自己的 owner，Shell 不替它们保存状态：

- `panes/`：左右侧栏。`Panes` 持有两侧的开合与宽度（`SidePane`）、右侧显示什么（`RightContent`：工作台 / Changes）、边缘拖拽和开合动画，每帧交出 `PaneFrame`；`layout` 是 `desktopPaneLayout.ts` 的宽度策略与窗口矩形，`gesture` 是拖拽状态机，`motion` 是开合动画。
- `explorer/`：独立的 `Entity<Explorer>`，持有文件树、选择、剪贴板、菜单、文件操作和展开动画。Shell 每帧推送 `Host`（所在矩形、当前文档、忙碌状态），并转交目录列表；Explorer 通过 `ExplorerEvent` 请求打开文件、读取目录、先关闭文档、新建 / 重命名对话框和错误提示。
- `modals.rs`：窗口级弹层栈（Settings / Help 共用一个槽位、新建条目、新建项目、重命名、退出确认、错误）。Esc 回答最上层；Documents 的保存错误是动态状态，显示在栈之上。
- `header.rs`、`footer.rs`：Header（`TitleBar`、`ChangesButton` 等）和侧栏底部栏是只负责展示的组件，由 `Shell::header` / `Shell::footer` 按状态组装。
- 缓存的面板：Explorer、右侧工作台与 Changes 以 GPUI 缓存视图（`Entity::cached`）嵌入，只在自身被 notify 时重新渲染；编辑器滚动、输入只重绘编辑器与 Shell 本身。Shell 推送给 Explorer 的 `Host` 变化或展开动画进行中时由 `Explorer::sync` notify；外观、字号与语言是进程级状态，`apply_preferences` 以 `window.refresh()` 让整个窗口重新渲染。

## Workspace Provider 底座（Cloud 接入第一步）

`src/workspace.rs` 现在是持有稳定资源身份与可撤销租约的统一入口，不是具体文件系统。`workspace/contracts.rs` 定义身份、能力和类型化结果；`workspace/ports.rs` 分开目录操作、文档持久化、预览与监听。原有 capability 文件系统收进私有 `workspace/local.rs`，由 `workspace/local/adapter.rs` 实现这些端口。

现有 Documents、Explorer 文件操作、新建和图片预览已消费统一入口。文档有稳定的 `ResourceId`，一次打开的编辑 ID / 访问租约与它分开；同路径重开不能复用旧保存许可。非文件系统测试 Provider 无本地根目录，也能走真实文档打开、保存及字节预览链路。现有文件系统回归全部通过统一入口运行。

监听由 Provider 持有：本地仍为 500ms 有界文本观察，合并为重读通知；关闭文档或撤销租约停止观察。它不是递归目录 watcher 或持久 journal。本地条件写仍保留 BOM/换行/权限与磁盘优先规则，未增加 Cloud 冲突策略。资源型预览支持本地文件或不可变字节，租约撤销后不再交付；原有本地路径型预览的 OS 打开行为不宣称变成原子文件快照。

**Provider 底座不是 Cloud 已接通**：原生登录由独立认证服务承接；HTTP/SSE 文件 Provider 的协议切片见第三步；Cloud 导航与保活、云端草稿处理仍未启用；本地多文档工作台已接入，范围与缺口见下一节。TS 参考输入的 HEAD 与脏工作树哈希见 `fixtures/workspace/provider-reference.json`。完整契约归 [Native Host and Lifecycle](https://github.com/puppyone-ai/puppy-issues/blob/main/document/puppyone-desktop/platform/rust-native-frontend/host-and-lifecycle.md#native-workspace-provider-foundation)。

Cloud 显式打开的协议切片位于 `workspace/cloud/opening.rs`：Checking → Connecting → Files，已运行工作区复用，显式打开最多发送一次 wake POST，后续只 GET 观察；核对项目/generation、服务期限、取消和根目录读取后才交付一次性 Prepared。认证请求携带 repository contract 2；workbench 长轮询允许 25 秒、显式启动允许 120 秒，普通 API 仍为 15 秒。此切片仅经回环服务验证，尚未接入菜单/主页，错误分类、并发打开合并、Cloud 草稿与未知结果恢复仍需补齐，不能视为 Cloud 完整 1:1 流程完成。

## 运行底座与多窗口（2026-10-29）

- **多窗口**：`shell::windows` 管理所有窗口。File/Dock → New Window（⌘N）；已在某窗口打开的项目会切到那个窗口；菜单动作跟随当前窗口；Quit 让每个窗口各自走关闭屏障；偏好由所有窗口共享；无参数启动和 Dock 重新打开时恢复上次项目；Finder "Open With" 交给 `on_open_urls`。
- **一个窗口不能拖死全部**：GPUI 所有窗口共用一个前台线程。`platform::tasks` 按 TS `EDITOR_TASK_POLICY` v1 准入编辑器任务（窗口关闭时停止准入并等待退出）；`platform::host_budget` 按 `itemHostBudgetDefaults` 监督终端和 Agent CLI 进程（数量、内存、持续 CPU）；File → Manage Running Sessions 不依赖标签页；`platform::watchdog` 记录前台超过 250 ms 的卡顿、worker panic 和崩溃到 `diagnostics/main-thread-stalls.jsonl`。
- **查看器准入**：内容型查看器按各自 `maxSourceBytes`（Markdown/文本 16 MiB、CSV/JSON 8 MiB、HTML 4 MiB）。
- **PDF**：`platform::pdf` + `editor::viewers::pdf`，引擎为 PDFium（`python3 tools/fetch-pdfium.py` 安装到 `vendor/pdfium`，打包时进入 `Frameworks`）。没有引擎时显示资源不可用。
- **Cloud 模型**：`workspace::cloud::{failure, locator, catalog, recovery, publish}` 已移植并测试，界面仍禁用。

## Retained Editor workbench（迁移进行中，不是全量完成）

`editor/workbench/{catalog,layout,runtime}.rs` 分别持有打开文档目录/MRU、递归 Pane 树和保活工作区；Shell 使用这些实际运行时，不是另一个演示页。每份 Working Copy 继续使用现有 `Documents` / `DocumentEditingSession` 保存队列，按稳定资源身份去重；标签和 Pane 焦点切换不读文件、不执行保存屏障。

- 本地文件标签、切换/重排/关闭、空分屏、四向拆分、Pane 移动与比例调整；关闭 Pane 保留打开引用。复用原有原生编辑器 Entity，保留撤销、选区和滚动；隐藏宿主撤去输入与导航路由。
- 本地项目切换保留各自文档和布局；准备失败保留当前工作区。后台文档继续保存/观察，显式关闭按所属文档 drain；窗口关闭等待所有保活文档，其他参与者失败时恢复原会话。
- 原生 profile 的 `editor-workbench/` 只写非正文元数据：200ms 合并、后台原子写入、关闭时等待已接收写入。恢复逐条经过 Provider 文件准入，晚到恢复不能覆盖交互；不信任文件夹、越界路径、外部资源 ID。恢复限 128 文档/12 层树，当前不恢复非 UTF-8 路径；不持久化草稿或凭据。
- 文件重命名/移动经过工作台保存屏障，成功后给原 Working Copy、标签/MRU、Pane 和观察订阅重新绑定路径，保留原生 Entity 与 Undo；目录操作包含隐藏的子文档，复制先保存源文档，跨目录多选副本逐项处理。保存失败取消文件修改；丢失回执保留屏障，Retry 只核对状态与已保存正文，不重放未知操作。
- Explorer 按项目保留树展开、选择、滚动与剪贴板，返回时异步重核已加载目录；移动目录保留已加载子树。同工作区单文件拖入 Pane：已显示文档聚焦原 Pane，空 Pane 直接接收，其余在最近边缘分屏；半区预览与目标生命周期检查阻止迟到读取附着到已关闭/重建的 Pane。
- TS HEAD 与 **63 个实际输入哈希**见 `fixtures/editor/workbench-reference.json`；`node tools/reference-editor-workbench.mjs --check` 执行真实 TS，600 个含递归结构的 Pane 状态转换由 Rust 对照。GPUI 集成测试实际验证跨标签、分屏、本地项目切换及重命名后，同一原生 Entity 的 Undo 仍可恢复并落盘。

代码与 JSON 使用 `editor/viewers/code` 的 GPUI Kit 原生 Editor：正文、撤销、多光标和折叠由同一编辑状态持有；产品语言规则与 Markdown 代码块共享。平台 IME 代理保留 Kit 的几何和编辑语义，额外报告组字结束，保证冻结快照不会保存 preedit 或在取消后悬挂。语言重绑保留实例、选区和历史。查找按 TS 从选区起点选择最近匹配，并按 NFKD/Unicode 小写比较；编辑后更新计数。参考与回归入口为 `tools/reference-code.mjs --check`、`tools/verify-native-editor.py`。

**仍未完成用户要求的全部 TS 功能**：Cloud 项目选择/显式启动准备与两种导航、Cloud→Editor 来源/权限/viewer budget、既有 Cloud 草稿与未知保存结果语义、目录订阅和执行隔离；改变扩展名后的 viewer 转换、按资源范围并发的操作队列、完整每 Pane 视图状态与跨 Root composition、跨应用原生资源拖放、完整快捷键/可访问性和拖放实机/视觉验收。元数据恢复不是崩溃草稿恢复。Cloud UI 仍禁用；五个复刻领域的剩余验收项见 `PARITY_TODO.md` §0.3。

## 工作区文档引用（迁移切片）

`editor/navigation/index.rs` 复刻 TS `markdownLinkGraph.ts` 的元数据解析：当前目录相对路径、根路径、省略扩展名、大小写、同名就近选择、缺失候选顺序，以及 Markdown href 的查询/fragment/编码处理。Explorer 提供已加载节点，包含折叠目录中缓存的子节点；不递归读取整个工作区。每个文档持有所属工作区与完整相对路径的上下文，目录加载、重命名/移动、返回项目后的异步重核会更新缓存。

CSV 的引用标签/按钮和 ⌘ 点击已经接入实际宿主。Markdown 的渲染标签支持普通点击，源码编辑与拖选不打开；按下/抬起要求同一目标、同一正文 revision、空选区及最多 4px 移动。当前文档标题支持 ATX/Setext、重复 slug、Unicode 和百分号解码；跳转只改变选区/滚动，不生成内容 revision、保存或撤销条目。外链先按 Markdown URL 策略规范化并校验，才交给系统打开。

`node tools/reference-navigation.mjs --check` 执行实际 TS，收据记录 HEAD、11 个输入 SHA-256 和 en-US/ICU 版本；Rust 对照 1,200 个解析结果、4 个标题索引和 18 个 URL 策略。**这不是完整链接图验收**：backlinks、资源预览、跨文档 heading/HTML id、引用 hover/可访问性、跨 Root URI 与不同系统 locale 排序仍待迁移；现阶段 URI 不降级为本地路径。真实 OS/严格像素测试未补齐。

## Live Cloud file Provider（第三步协议切片）

`src/workspace/cloud/` 实现现有四个 Provider 端口，不增加第二套文件 UI 或保存队列。`prepare_running` 通过账号/环境绑定的 Broker 校验项目根 context、固定 workbench ID/generation，并实际读取根目录；返回 5 秒、一次性消费的准备收据。**仅接入已运行的 workbench**；创建/唤醒、opening/polling/recovery 状态机仍归后续显式导航准备，不在读文件或断线重连时偷偷 POST 启动计算。

- live list/read、条件写、新建（不覆盖）、目录创建、重命名/移动/删除；读写受服务端逐次授权与 generation 约束。Scope、复制/导入、本地路径与执行能力不开放，无本地镜像或已发布 Git 回退。
- 不可变字节预览验证名称、类型、长度、base64 与 SHA-256；本地仍为 4 MiB/2,000 条目，Cloud 为 8 MiB/10,000 条目。文本保留 BOM/CRLF；revision 同时绑定存储、workbench、generation 和路径。并发读/list 合并，失效代次拦截旧读取。
- 凭据和 HTTP/SSE 均归原生认证 Broker，Provider 不拿 token。单个 Provider 共享一条有界 reset 流；验证媒体类型、分片 UTF-8/CRLF、32 KiB 帧与 generation。断线最多重连三次，每次重新失效；正常 token 续期不消耗断线重连预算。不使用 Agent cursor 或文件轮询。
- 撤销/最后一个订阅 Drop 取消相应 I/O；观测到权限撤销或账号/环境/运行代次变化后，旧预览访问失败。已交付的字节/已派发的解码无法追回；共享账号刷新可自行收尾，但取消后不再派发文件请求。流终止/重试耗尽后须重新授权准备，不静默换 generation。
- 不确定写入返回 `OutcomeUnknown`，不重放；CAS 冲突提供外部快照。**Documents 的既有 TS Cloud dirty-draft/未知结果行为须随工作台接入一起迁移，不能据此启用 Cloud 编辑 UI。** 账号/仓库两种导航、保活与执行隔离也仍未接通；启用 Cloud host 前还须遵守所选 viewer 更小的 source budget，不能把 8 MiB 传输上限当作全体编辑器准入。

20 项新增本地协议测试使用真实 loopback HTTP/SSE、合成认证与内存 vault，覆盖完整 8 MiB 收发、故障与取消；两配置各 412 passed / 9 ignored。不是后端实际部署、真实账号/Keychain/浏览器验收或大文件编辑器延迟证明。参考 TS/后端 HEAD 与 12 个实际输入哈希见 `fixtures/cloud/provider-reference.json`，由 `tools/check-cloud-reference.py` 校验。规范归 [Cloud Workspace State](https://github.com/puppyone-ai/puppy-issues/blob/main/document/puppyone-desktop/cloud/workspace-state.md)。

## Native Cloud authentication（第二步）

`src/cloud_auth/` 是唯一原生账号权威：复用现有 Web `/login`、PKCE S256 和 IP-loopback 回调，以及邮箱登录的顶层表单 POST。HTTP 禁止重定向并限制响应大小；本地认证请求不经过代理。`features/cloud_account.rs` 仅把无凭证快照交给 Settings，系统浏览器只有在用户发起且请求仍有效时才打开。Cloud 工作区、计费/订阅和文件服务没有随登录一起启用。

正常构建必须显式设置 **`PUPPYONE_CLOUD_API_URL`**（以 `/api/v1` 结束）和 **`PUPPYONE_CLOUD_WEB_URL`**（origin）。允许官方 `puppyone.ai` 域族 HTTPS，或显式 loopback HTTP 开发环境；无生产默认值，不读取 TS 的 `.env`、登录文件或凭证。缺配置或平台不支持时登录不可用。截图/lab 不启动认证服务。

macOS 使用独立的 `Puppyone Native Cloud Auth` Keychain service，按原生数据目录区分 profile；只持久化 refresh credential，access token 留在服务内存。恢复与按需刷新 singleflight；账号/环境/退出/取消的代次撤销阻断旧请求和迟到写入。退出先尝试清理本地凭据，再以 `scope=local` 尝试远端撤销；远端未确认与 Keychain 删除失败分别明确显示，不能假装完全退出。正常关闭接入 Shell 的现有退出屏障，等待凭据修改与回滚；失败时阻止关闭并恢复文档输入和监听，不依赖 GPUI 的 200ms 最后清理钩子。普通关闭保留已确认登录，不等于退出账号；强制终止/崩溃不在清理保证内。不确定的业务写入不自动重放。

本地验收使用内存凭据存储、真实 loopback TCP/HTTP、合成 Supabase 与 GPUI 公开状态投影；覆盖 20 路刷新/401、重放/期限/取消、错误 Host/Origin/PKCE、存储失败、退出竞争和恢复。**不等于真实 Keychain、系统浏览器/社会化登录或托管环境验收**；Windows/Linux 的安全存储未接入，同 profile 多进程并发未资格化。回调结果页目前为无脚本纯文本，错误诊断为原生英文；不宣称与 Web 结果页像素或完整本地化一致。

```bash
cargo test --locked cloud_auth::
cargo test --locked public_account_projection
python3 tools/check-auth-reference.py
```

参考 HEAD 与八份脏输入哈希在 `fixtures/cloud/auth-reference.json`；新增直接依赖只提升已有 lockfile 中的 `getrandom`、`sha2`、`httparse`、`zeroize`，未升级/替换 Kit。协议权威归 [Unified Authentication and Sessions](https://github.com/puppyone-ai/puppy-issues/blob/main/document/puppyone/architecture/control-plane/authentication-and-sessions.md#rust-native-client)。

## 这一版可以做什么

- 选择真实本地文件夹，展开目录，读取文件；目录扫描和读写在后台线程。
- 点击已有 UTF-8 文本文件，在原生编辑器里编辑：Markdown（`.md` / `.mdx` / `.markdown`）实时预览与源码模式，CSV / TSV 表格与源码模式，其他文本为纯文本编辑。系统 **View → Toggle Markdown Source** 切换实时预览 / 源码。
- **Markdown 源码是唯一真相**：实时预览不改写原文。原生支持标题、强调、链接 / 维基链接、列表、任务、引用、分隔线、带高亮的代码块和可编辑表格；数学公式、Mermaid、图片、HTML / MDX 块尚未原生实现，按原文显示，不会被静默丢弃。几何与产品逐块对齐的验收见 PARITY_TODO §7。
- 输入法：所有原生编辑器共用一套组字适配（中文 / 日文 / 韩文 / 死键 / 长按重音），整段组字一步撤销；过滤部分输入法（如搜狗）把方向键当文字插入的功能键字符。
- 其他文本文件：撤销 / 重做、查找、输入法；暂无行号和语法高亮。
- 编辑默认自动落盘；`⌘S` 仅用于 flush/retry；**File → Reload from Disk** 重读磁盘；`⌘W` / **File → Close File** 关闭当前文件。正文不再显示文件工具栏、格式工具栏和底部状态栏；格式操作移到系统 **Format** 菜单，源码切换位于 **View → Toggle Markdown Source**。
- 显式关闭文档、资源修改和正常退出会取得冻结快照并等待自动写入完成；IME 结束后继续，不弹出普通文档保存确认。标签、Pane 和本地项目切换保留文档，不以关闭/重开实现保活。
- 磁盘轮询/条件写确认外部变化后采纳磁盘内容，推进 persistence epoch，忽略旧写回执；自身写回声不得覆盖新输入。真正 I/O 失败保留输入并显示可重试错误。
- 保留 UTF-8 BOM、LF / CRLF 和末尾换行；普通 POSIX 文件权限随保存保留。
- 外围 `⌘B` / `⌘J` 切换左右区域；Markdown 内容焦点内的 `⌘B` 由原生 Markdown 格式命令处理。拖动分隔线调整宽度。
- Settings 按 Web 的 sidebar/main/components 分层；语言、深/浅色、三档文字尺度、Header Changes/Terminal 可见性、Project Rail 和创建菜单配置修改后自动持久化。不跟随系统主题；其他未接通设置明确只读/禁用。Feedback 已有原生表单，但附件和发送禁用，**不会上传任何内容**。

**已有本地多文档和分屏，仍不是完整多格式 Editor workbench/L3。** Header 的 Git 显示实际变更和同步计数，打开右侧 Changes；Terminal 图标打开原生工作台。两者切换保留 Agent/Terminal 实例。

原生编辑器的分层、功能契约和样式约定见 [`src/editor/ARCHITECTURE.md`](src/editor/ARCHITECTURE.md)：

```text
src/editor/
  text/        文本内核：缓冲区、变更、选区、事务、撤销历史（含组字分组）
  view/        编辑器视图（基于 Kit editor_host）：布局、命中、键位、指针、输入法组字
  markdown/    Markdown：语法、计划、装饰、命令，以及代码块 / 表格 / 分隔线 / 任务等功能切片
  table/       CSV 与 Markdown 表格共用的可编辑表格基础件
  csv/         CSV / TSV：文档、模型、操作、表格视图与源码模式
  host/        文档宿主协议（open / snapshot / saved / history）、窗格菜单与查找
```

## Native Git and Agent workbench

- `src/features/source_control/`：Changes 分组、虚拟文件列表、Diff、最近 100 条提交历史、暂存/取消暂存、提交、Fetch/Pull/Push。Git CLI 后台执行，使用 literal pathspec、NUL 状态解析、超时和 workspace epoch；只在已打开的仓库根目录执行。状态在窗口激活时每 3 秒刷新，也支持手动刷新。Discard、Pull、Push 有明确的操作确认。
- `src/features/workbench/`：中立的项目级标签/分组/分屏模型；每次 `+` 产生独立 New tab；拖动重排/跨组/边缘分屏、调整分屏、溢出列表、Header 左右/Home/End 导航。隐藏或切换项目保留实例；关闭最后标签显示 launcher；运行中的标签及应用退出先确认停止。
- `src/features/desktop_agent/`：沿原产品的 domain / application / infrastructure / ui 分层；原生虚拟转录、Markdown/表格/代码复制、工具折叠、图片附件预览、拖入/选择引用、命令建议、逐会话草稿、失败草稿显式恢复、模型/模式/思考强度、历史过滤及审批/问题/MCP 表单。
- `src/agent/`：独立 native runtime port、composition root、Codex/Claude adapters、共享 ACP 与 Pi RPC、不可变引用、会话 catalog、有界 JSONL transport。Codex 支持 fork/steer/rename/compact/archive；其他运行时按实际协商能力显示控件。每项目最多 8 个、应用最多 32 个 Agent owner，隐藏不释放租约。
- `src/model_connections/` 与 `src/features/model_connections/`：独立的 Rust 模型配置服务和 GPUI 设置；新增/刷新/删除确认、配置代次检查、删除后防复活与 Keychain 引用；成功写入后清理无引用旧密钥。Settings 和 Agent 页面共用服务。Local Agents 设置显示实际安装位置与缺失状态。
- `src/agent/runtimes/puppyone_agent/`：产品内置的 Rust HTTP/tool loop；从 **Settings → Model Connections** 或 Agent 页的 **Model connections…** 配置 OpenAI-compatible endpoint/model。支持本地兼容服务；远端使用 HTTPS、禁止自动重定向，密钥仅进入 macOS Keychain；JSON 只存版本化 credential reference，密钥值不进入 JSON/argv/env。具备 read/ls/find/grep/write/edit/bash、显式写入/命令审批、Plan 模式、停止、持久历史、分叉、重命名、上下文压缩和模型绑定代次检查。没有自动导入 Electron 凭证，也没有把外部 Pi CLI 改名冒充内置运行时。
- `src/features/terminal.rs` + `src/platform/terminal.rs`：原生 GPUI 终端、PTY、VT100/ANSI、颜色、光标、滚屏、IME、粘贴、终端查询响应和窗口尺寸同步；视口拖选/双击选词/复制、Cmd 点击 HTTP(S) 链接、X10/UTF-8/SGR 鼠标（Shift 绕过）、功能键/导航修饰键。输出、滚动及 resize 会清除选区，尚无跨滚屏持久选区/OSC 8/像素鼠标；本机发现的 Claude Code、Cursor、Hermes、OpenCode、Pi、WorkBuddy 等 CLI 可从终端启动。
- `src/platform/` 与 `src/agent/transports/`：独立 worker 管理 Git/JSONL/PTY；有界管道与 Wake，前台不执行阻塞式等待。关闭发送进程组信号并由 worker 回收 child；PTY 真实退出有集成验证。

原生 Chat 入口覆盖 PuppyOne Agent、Codex、Claude、Cursor、Hermes、OpenCode、Pi、WorkBuddy；安装发现、协议握手与真实推理是不同层级的验证。Workbench 将布局和 native session identity 原子保存为项目元数据；重启后显式 Resume，不重放之前的命令。CLI 自己拥有登录，Rust 不复制其认证文件。

当前验证以 `artifacts/gpui-verification/result.json` 及 `artifacts/native-editor-verification/result.json` 为准，包含连续文档交互和真实临时文件保存检查；新连续编辑版本的 OS 视觉/真实中文候选窗尚未验收。Codex 的真实推理/上下文/工具写入/Stop/恢复/fork/rename/文本引用，Cursor 的回复/第二轮上下文/跨进程会话恢复，PTY 与内置 Rust Agent 的 HTTP SSE/审批/拒绝/恢复/分叉/停止/绑定隔离集成通过。内置运行时使用本机回环模型夹具，**不等于已用用户真实模型完成推理**。Pi 回复及第二轮上下文通过，但当前 `pi-with-claude/opus` 配置在重启后丢失模型上下文；原生 CLI 对照也复现，不能声明其恢复验收通过。Pi 适配器已修正现代 `agent_settled`/重试边界、最终模型错误和历史加载竞态。Claude 原生握手通过，但当前配置的 `api.omnimaas.com` 返回 HTTP 522，真实推理失败。OpenCode 使用隔离配置握手通过，用户配置中的 `oh-my-openagent` 下载/启动失败没有被修改。Hermes/WorkBuddy 未安装，未做实机验证。

```bash
python3 tools/verify.py
# 显式运行 native CLI/PTY/回环测试，不启动图形应用：
python3 tools/verify-agent-runtimes.py
# 另做少量 Codex/Claude/Cursor/Pi 真实推理，使用其现有 CLI 登录：
python3 tools/verify-agent-runtimes.py --live
# 可用 --only 显式选择子集；故障 Provider 的失败收据仍须保留。
# 按当前源文件哈希核对验证收据，然后打包本地应用（不会启动）：
python3 tools/package-workbench.py
```

收据在 `artifacts/gpui-verification/`、`artifacts/agent-runtime-verification/`。本轮电脑控制接口返回 native pipe startup failed；Kit 版本已有独立窗口的编辑器 smoke 和 Agent 静态 port 截图；系统 IME、全部工作台交互与像素一致性仍未验收，GPUI test context 不等同 OS 实机验收。

尚不能称为 Electron Agent 的全量对等：Mermaid 图形、全部活动 renderer/内联资源/高级 mention、完整安装/账户/托管 compute、持久 feed/request ledger、崩溃级 supervisor、终端鼠标/选区、完整辅助技术和视觉对齐仍有缺项。高级 Git hunk/分支/图历史也未迁入。

## Web → Rust 产品分层

- `editor/document_session`：纯保存状态机；provider 视图只通知修改并提供快照。
- `features/settings/{sidebar,main,components}`：同一设置实例；`preferences_store` → `platform/preference_storage` 负责自动持久化。
- `features/create_new`：纯注册表和命名规则、表单、native creation port；Settings 与 Explorer 菜单消费同一配置。
- `features/desktop_agent/ui`：Header、Transcript、Composer、History、审批/问答分别维护；应用层 draft store 持有逐会话草稿，runtime 仍通过端口注入。
- `features/workbench/auxiliary_workbench_launcher.rs`：只装配安装入口；Chat、Terminal 和公共布局各有 owner。

`python3 tools/audit-product-layers.py` 记录实际 Web/本地 Rust 文件摘要与剩余边界，输出 `artifacts/product-layer-audit.json`。未将 TS 文件逐个改名，也不把目录相似视作行为通过。完整设置服务、专用格式创建、所有 Agent display renderer 与像素验收仍有缺项。

## Shell / Settings / 工作台源码对应关系

对齐工作的方法、样式体系与逐项 TODO 见 [`PARITY_TODO.md`](PARITY_TODO.md)。`tools/ui-migration-map.json` 按组件边界登记左侧栏、Header、Settings、右侧工作台以及样式与本地化的 Web 源文件和对应 Rust 文件；`tools/audit-ui-migration.py` 枚举这些源目录的全部文件，未登记的记为 pending。`ported` 必须引用存在的 Rust 测试或 `artifacts/` 文件，`partial` 必须写明缺项，`excluded` 必须写明原因；目标文件被删、源文件改名或同一文件被两组认领都会失败。

```bash
python3 tools/audit-ui-migration.py          # 输出 artifacts/ui-migration-audit.json
python3 tools/audit-ui-migration.py --check  # 只校验映射
```

颜色只能来自 `src/theme.rs`（由主题包和 `tokens.css` 投射），`tools/check-ui-boundaries.py` 拒绝其他文件里的颜色字面量。

## Agent 源码对应关系

保留原业务层次、职责和接口语义；Rust 模块使用 snake_case，React hooks / Electron IPC / DOM 分别改为 controller / 原生端口 / GPUI。没有全量复制 TS，也没有把文件改名当作完成迁移。

- `src/features/desktop_agent/{domain,application,infrastructure/native,ui}` 对应原 `src/features/desktop-agent/` 的展示与应用分层。
- `src/agent/{connections,domain,runtime,runtimes,protocols,persistence,transports}` 对应原 `electron/main/agent/` 的宿主职责；运行时契约仍是原 shared contract 的部分实现。
- `tools/agent-migration-map.json` 记录已识别的源模块、Rust 目标和逐组缺项；`tools/audit-agent-migration.py` 枚举所有源文件，未映射项自动记为 pending，不会默默排除。

```bash
python3 tools/audit-agent-migration.py --source-root ../../puppyone-qubits
```

报告输出到 `artifacts/agent-migration/inventory.json`，同时记录源 HEAD、未提交修改和逐文件哈希。当前三个 Agent 目录的 360 个文件中，89 个标为 partial、271 个 pending，**没有文件被宣称全量对等**；这是可追溯清单，不是按文件数计算的功能完成率。完整迁移仍须逐项对齐原契约和测试，不能只依靠目录结构验收。

## 架构调研与差异（R0）

细化草案已归到 `puppy-issues/document/puppyone-desktop/platform/rust-native-frontend/README.md`，分为依赖/身份、Appearance/组件、Web 宿主/生命周期、像素与迁移验收四个专题；全部明确为 Proposed。

**原生编辑器使用 `editor/document_session` 的自动保存队列与磁盘 epoch。** `documents.rs` 只适配导航、快照和 I/O 完成；完整 L3 Working Copy/Root registry 与多 pane 寿命仍未迁入。当前 Home 仍临时切换 Explorer，centered Header 也不是正式默认布局；已登记为迁移缺口。

`src/ui/` 提供 GPUI 按钮、图标与原生文本输入；Shell、Settings、Feedback、项目菜单、分隔线、文件树和确认框已迁移。文件树使用 GPUI 虚拟列表；目录选择与编辑激活分离，祖先线绘制有预算。后台完成通过有界唤醒通道回到 GPUI entity，无持续空闲绘制；Git 在已打开项目且窗口激活时按 3 秒周期刷新。完整 UI kit、同源 token 编译和产品样式弹层尚未完成。

## 架构：全部 Rust / GPUI，无 WebView

```text
Rust / GPUI Kit 0.8.0 / gpui-pre 0.3.9 / Metal (macOS)
├─ 标题栏、项目入口、Explorer、系统菜单、分隔线和弹窗
├─ 原生 Changes、Workbench tabs/groups、多运行时 Agent Chat、PTY Terminal
├─ Workspace capability、后台读写、文档身份、保存与关闭协调
└─ 原生文档编辑器（src/editor）
   ├─ 窗格外框：⋯ 手柄、窗格菜单、查找
   └─ Markdown（实时预览 / 源码）、CSV / TSV 表格、纯文本，按扩展名路由
```

- 没有 HTML/CSS 外壳、WebView、Tauri 或 Electron 运行时；编辑器与外壳在同一 Metal 帧内绘制。
- 编辑器没有文件系统 API；只上报已打开文档的 revision 和快照。保存路径由 Rust 文档会话持有。
- `cap-std` 将目录访问约束在原生打开的 capability 内。拒绝绝对 / `..` 路径、外部符号链接和特殊文件；文档还绑定 workspace grant。
- 切换 / 关闭不单靠异步 dirty 标记：先冻结编辑器并索取快照，确认收到后才决策（组字中会等组字结束）。5 秒内无确认则取消操作，不静默关掉文件。
- 保存使用同目录独占临时文件 → 写入 / sync → 再检查磁盘版本 → rename → 回读确认。失败不把缓冲区标成已保存。
- 项目 popup 支持重复触发、外侧点击、Escape、本地项关闭和 trigger focus。Feedback backdrop 不关闭；显式关闭清空未发送字段，与原产品对齐。
- macOS 原生 Edit 菜单提供剪贴板 / 撤销快捷键；Quit 经过同一自动保存 drain。

应用不导入已安装 Desktop 的配置或更新源。Codex 运行与原生历史由本机 CLI 使用其现有登录；Agent 在用户发起任务后可操作所选项目。文档编辑器与设置偏好修改后自动写入，Git 变更由对应操作触发；没有应用遥测。

## 当前限制：务必先看

- **单窗口、一个当前根目录、Editor 单文档**；Editor 尚无多标签、删除 / 重命名、Save As、正式资源监听 journal、最近项目或会话持久化；已有单文档磁盘轮询与 Folder/Markdown/text/JSON/CSV/HTML 新建。辅助工作台已有独立多标签和项目内保留。
- 文本文件上限 **4 MiB**；单目录最多 **2,000 项**。二进制、非 UTF-8、混合换行 / CR-only 明确拒绝；不是所有格式都能编辑。
- 保存只读文件、符号链接文件本身和硬链接会拒绝；不自动重建已被外部删除的文件。
- 保存会保留基本权限，**不保证保留 ACL、扩展属性、原 owner 等全部元数据**。
- 版本检查与 rename 之间仍存在普通文件系统的竞争窗口，**不是针对不协作写入者的原子 compare-and-swap**。不要把 M1 用于有持续并发写入的重要文件。
- 没有崩溃恢复或磁盘草稿；强制退出 / 系统崩溃可能丢未保存内容。窗口正常关闭等待写入完成，不等于崩溃恢复已实现。
- 中文正文已参与真实保存测试；macOS 文件名使用可用的系统 Unicode 字体 fallback。完整中文 IME、RTL、辅助技术、拖放和各平台剪贴板矩阵尚未验收。
- 尚无完整 Git / Cloud / 设置服务、Feedback 发送、全部 Agent 能力、HTML / PDF / Office / 媒体查看器、代码语法高亮；Markdown 数学公式、Mermaid、图片资源、链接导航也未接通。**不是“所有外围与业务都迁完了”。**
- 像素精度仍未达标，菜单 / 窗口按钮 / 字体光栅 / 截断仍需收敛。

## 验证

可运行 `python3 tools/verify.py` 验证主程序和现行原生编辑器契约，并生成带源文件摘要的收据；不启动 OS 窗口。文件图标投影校验的 Python 环境需要 `fonttools[woff]`；可在独立 venv 中安装并将该 venv 的 `bin` 放到 `PATH` 首位。

```bash
cargo fmt --check
python3 tools/check-ui-boundaries.py
python3 tools/import-localization.py --check
python3 tools/generate-assets-rs.py --check
python3 tools/import-agent-marks.py --check
python3 tools/audit-ui-migration.py --check
cargo test --locked
cargo clippy --all-targets --features dev-capture --locked -- -D warnings
cargo build --release --locked
# 帧耗时预算（Core Text 真实排版，release；仅 macOS）：
python3 tools/bench-editor.py --check
```

`dev-capture` feature 只打开开发用截图、编辑器几何导出和视觉 fixture，不进入正常构建。

| 层级 | 验证内容 |
| --- | --- |
| Workspace | 真文件读取 / 保存 / 重读、UTF-8 中文、BOM / CRLF、删除 / 外部写冲突、只读 / 硬链接、路径和符号链接越界、workspace grant、体积 / 编码限制、临时文件清理 |
| 文档状态机 | 迟到 dirty、过期 token/request/epoch、单写合并、IME Deferred、旧写回执/自身回声、外部采纳、自动 drain |
| Rust UI | 点击、树展开、布局、10 万行仅绘制可见行、空闲不持续 repaint；任务快捷键不误关文档、Feedback 草稿/backdrop/Escape、Settings 响应式几何 |
| 原生编辑器 | GPUI 测试平台上的输入、撤销、Markdown 装饰与命令、表格操作、CSV 视图、查找、宿主协议；输入法场景矩阵见 `src/editor/view/ime_tests.rs` |
| 帧耗时 | `tools/bench-editor.py`：编辑器与整窗在 245–3845 行 Markdown 上滚动 / 缩放的每帧 CPU 耗时（Core Text 真实排版，每个规模独立进程），按 `tools/editor-frame-budgets.json` 检查绝对预算，以及每帧耗时不随文档长度增长 |

GUI 冒烟脚本随 WebView 一起移除。真实系统输入法、焦点、全屏、DPI、辅助技术和原生文件选择器仍需手动验证。

上游 `block 0.1.6` 和 `proc-macro-error2 2.0.1` 有 future-incompatibility 警告；当前构建通过，但工具链升级前需处理。

### 编辑器几何门禁

```bash
# Chromium 参考：真实产品编辑器窗格，fixtures/editor/* × 深浅色
/path/to/original-repo/node_modules/.bin/electron tools/probe-editor.mjs artifacts/probe/sample.json
/path/to/original-repo/node_modules/.bin/electron tools/reference-editor.mjs
# 原生几何：dev-capture 构建在打开同一 fixture 时按 PUPPYONE_EDITOR_GEOMETRY=native.json 导出，
# 再与参考逐块 / 逐字比较
python3 tools/compare-native-geometry.py native.json artifacts/probe/sample-dark.json
```

当前结果（块位置、字符偏移、像素一致率）见 PARITY_TODO §7.2。最新 Web 样式可复现比较：

```bash
cargo build --locked --features dev-capture
python3 tools/verify-editor-style.py --binary target/debug/puppy-one-rust
# 严格验收：任何像素不同都返回非零；当前仍未通过，不是容差放宽后的“通过”
python3 tools/verify-editor-style.py --binary target/debug/puppy-one-rust --check
# Markdown 自动列宽的真实 TypeScript oracle（84 个案例）
node tools/reference-markdown-layout.mjs --check
```

`artifacts/style-sync/` 保存原图、ICC 归一化 sRGB 比较图、差分、几何和源码哈希；包括深浅色、三档字号、宽窄表格、段落/代码选区。非选区场景不聚焦，选区场景验证参考确有焦点；不会把未绘制的选区当成通过。macOS 左下角 footer 已跟随 Web 移除，Settings 保留在应用菜单 / `⌘,`；其他平台保留原 footer。

### 真实产品组件参考

```bash
PUPPYONE_NODE_MODULES=/path/to/original-repo/node_modules \
  /path/to/original-repo/node_modules/.bin/electron tools/reference-primitives.mjs
```

探针导入真实 `SidebarRow` / `SidebarList` / `SidebarIconButton`，保留生产 CSS layer，检查 Default-neutral/Medium 的 light/dark 几何和状态。输出在 `artifacts/primitives-reference/`，带 component/CSS/font hashes、commit、engine 和 DPR。只代表这些真实组件；尚未接完整 App/Appearance runtime，也尚无对应 native gallery 的逐像素通过证据。

任务表面直接运行 `tools/reference-shell.mjs`（同样的 Electron/依赖环境），产生 Settings/project/Feedback/离线 Agent launcher × light/dark × en/zh-Hans 共 16 组 `artifacts/shell-reference/` PNG/JSON。使用真实组件、CSS layers、编译后的主题和 catalog；不代表全 App 或 Agent/Cloud 服务已接入。

真实组件区域可严格比较（当前 **exit 1 / pixelIdentical: false**，没有降低阈值）：

```bash
PUPPYONE_SCREENSHOT=artifacts/native-settings-dark.png PUPPYONE_CAPTURE_SURFACE=settings \
  cargo run --release --locked --features dev-capture
python3 tools/compare.py artifacts/shell-reference/settings-dark-en.png \
  artifacts/native-settings-dark.png --surface settings --check
```

### 外围视觉回归

```bash
PUPPYONE_SCREENSHOT=artifacts/native-dark.png cargo run --release --locked
/path/to/original-repo/node_modules/.bin/electron tools/reference.mjs
python3 tools/compare.py artifacts/reference-dark.png artifacts/native-dark.png
# 严格逐像素检查仍预期失败，不能说已经像素一致：
python3 tools/compare.py artifacts/reference-dark.png artifacts/native-dark.png --check
```

新增任务表面诊断可加 `PUPPYONE_CAPTURE_SURFACE=settings` 或 `feedback`，配合 `PUPPYONE_SCREENSHOT=...` 捕获；这只是 native 截图，不是逐像素通过结论。系统差距矩阵、真实组件基准和当前收据见 `puppy-issues/document/puppyone-desktop/platform/rust-native-frontend/shell-parity-audit.md`；早期收据仍保留在 `markdown-and-task-surfaces.md`。

Python 比图依赖 Pillow / numpy。截图模式显式使用合成树，只测外围，不会自动保存真实文档。原 CSS 静态参考不等于完整 React 产品验收；评分排除空白 Editor / Agent 区域并单列文字 / 图标前景误差。历史调研和像素结果见 [RESEARCH.md](RESEARCH.md)。

## 原生编辑器契约验证

`python3 tools/verify-native-editor.py` 直接运行 `src/editor/` 的产品测试，覆盖 IME 提交/取消、UTF-16、候选窗锚点、CSV 共享撤销、源码切换、列宽和宿主快照屏障。脚本要求具体契约用例通过，过滤器匹配零用例不会生成成功收据。真实系统 IME 和严格视觉仍需单独验收。

[`native-editor-probe/`](native-editor-probe/README.md) 是已退役的内存实验，依赖的旧输入框已删除；其源文件保留作历史记录，不再参与产品构建门禁。原 `native-editor-probe/tools/verify.py` 命令转到上述产品验证。

## 源码入口与下一步

- `src/main.rs` / `shell.rs` / `theme.rs`：GPUI Application、entity、事件与布局。
- `src/editor/`：原生文档编辑器（文本内核、视图、Markdown、CSV、表格、宿主协议），见其 `ARCHITECTURE.md`。
- `src/ui/components/`：产品组件库；`src/ui/form_input.rs`：表单输入（Kit Input / Textarea 的薄适配）；`src/ui/input.rs`：共享的编辑动作与 Edit 菜单；`src/ui/appearance.rs`：当前外观（深浅色、主题包、字号）的全局状态。
- `src/ui/ime.rs`：系统输入法补充（丢弃组字、过滤功能键字符），所有文本输入共用。
- `src/wake.rs`：后台 I/O 的有界唤醒；`src/capture.rs`：显式启用的 macOS 合成截图。
- `src/shell/tasks.rs`：首批原生 Settings / Feedback；尚未通过完整像素验收。
- `src/workspace.rs` / `src/workspace/{contracts,ports}.rs`：统一资源、Provider 端口、能力与租约；私有 `src/workspace/local.rs` / `local/adapter.rs` 保留本地受限访问、编码和条件写；`src/workspace/cloud/` 是尚未接导航的 live HTTP/SSE 适配器。
- `src/documents.rs`：单文档状态机和关闭检查。
- `src/localization.rs` / `tools/import-localization.py`：同源 locale 投影，不持久化用户偏好。
- `src/shell/project_menu.rs`：锚定 Header 的原生项目位置 popup。

下一批按架构门槛推进：**字体/像素/叠层适配性 → 同源外观与原生组件 → 正式 Workspace 导航 → 保留现有 Editor 内核并适配 Rust 端口 → Right Sidebar/执行宿主**。文件操作随所属领域补齐，不顺手新增产品未接受的草稿历史或并发多视图语义。

代码位于 `puppyone-ai/puppyone` 的 `puppyone-rust` 分支、`puppy-one-rust/` 目录；现有 Electron 产品、`main` 和发布入口未改。最终仍按同仓库独立目录评审和逐步迁移，不需要另开产品仓库。
