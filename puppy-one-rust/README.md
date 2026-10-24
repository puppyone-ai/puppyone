# PuppyOne Rust — GPUI local workspace / Markdown integration

> **Rust 前端现统一依赖 GPUI Kit 0.8.0（其 GPUI 后端为 gpui-pre 0.3.9）。**
> 可以打开真实文件夹、编辑已有文本文件并保存；工作台现在并列提供 **Rust native 富文本编辑器** 和 Wry 中的现有 Markdown / CodeMirror 编辑器。
> 仍是实验版本：不是现有 Desktop 的完整替代品，未通过像素级验收。先用测试文件夹试用。
> 当前产品规范仍归 [puppy-issues / puppyone-desktop](https://github.com/puppyone-ai/puppy-issues/tree/main/document/puppyone-desktop)；本目录不改变现有 Electron 产品或发布入口。

## 启动

```bash
cd puppyone-rust-spike/puppy-one-rust
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

验证平台：**macOS 26.5 / Apple Silicon，Rust 1.97.1**。Windows WebView2 路径已有编译条件，但未构建、打包或实机验证；Linux WebView 嵌入尚未实现。需要 Rust 和系统原生构建工具；常规 Cargo 构建 / 运行不需要 Node 服务。GPUI Kit 固定为 crates.io `0.8.0`，使用其配套 GPUI/平台后端；macOS 使用 Metal。首次构建需下载 Cargo 依赖。

## GPUI Kit 复用范围

- `gpui_kit::application/open_window`：平台入口、窗口 Root、焦点和组件初始化；不维护 Kit fork。
- 共用 Button / IconButton、工作台 Tab、Checkbox、Dialog 直接使用 Kit；保留产品颜色、布局与业务命令。
- 普通表单、Agent composer、Git commit、模型配置及问答字段使用 Kit Input/Textarea。选择、文本编辑、IME 事务和撤销交给 Kit；薄适配器保留长度限制、Tab 焦点和 ⌘Enter。
- Agent Markdown 使用 Kit TextView，代码复制和受限链接保留；正文中的图片地址不会自动读取本地文件或请求网络。
- 连续原生编辑器通过 Kit 的公开 `text::editor_host` 复用段落、标题、列表、代码和表格排版，以及字节命中和选区装饰。宽表格的视口由应用持有，以支持光标跟随；仍只有一个整篇输入面。
- `native_editor/{core,markdown,features,host}` 继续拥有文档模型、无损编解码、编辑语义和统一文档撤销；`native_editor/gpui` 负责原生输入与 Kit 适配。Kit 不是完整的 Notion/Typora 编辑内核；文件树加载、分屏拓扑、Terminal/Agent 运行和文件保存同样保留各自 owner。

未采用 `gpui-kit-markdown-editor` 或其他独立编辑器库。GPUI Kit 上游在 2026-10-23 查询时为 18,506 stars；这是本次选型门槛，不是成熟度或无缺陷保证。此后新增直接依赖仍需按用户的项目规模限制评估。

## 这一版可以做什么

- 选择真实本地文件夹，展开目录，读取文件；目录扫描和读写在后台线程。
- 点击已有 UTF-8 文本文件，在真正的 **CodeMirror 6 Web 编辑器**里编辑。
- **Markdown 默认实时预览编辑**：复用原产品 `MarkdownCodeMirrorEditor`、模型、格式命令、表格/widget 和 CSS，不是只读 HTML；系统 View 菜单可切换 Live preview / Source。
- 默认的 Web 内核即产品编辑器窗格（见下文“编辑 Web 部分”），与产品逐元素对齐。系统菜单 **View → Native Editor / Web Editor** 切换编辑内核；原生内核仍是实验性实现，**未做像素对齐**。Rust 模式使用一个连续文档输入面，正文、选区、输入法与排版全部由 GPUI 绘制；段落不再是独立输入框，支持跨段落拖选、整篇全选、Enter 分段、Backspace 合段与统一撤销；支持标题/段落/引用、粗斜体、列表/任务项、代码块、表格增删行列/TSV 粘贴、撤销重做与 Markdown 源码模式。
- 切换传递未保存正文、磁盘基线与 revision；目标 ready 回执带切换代次，失败/超时返回原编辑器。不修改内容的往返保留原内核的撤销历史；在另一内核编辑后的交接重新建立该内核历史。切换源码/富文本显示本身不增加内容 revision。
- 原生模式的未改动块按原文保存；链接/图片/数学/MDX/嵌套复杂结构等未支持的富文本形式显示可编辑原文块，不静默丢弃。保留任意结构的跨应用富文本剪贴板、搜索、资源预览、语法高亮、大文档虚拟化和完整 Web 编辑器能力尚未对齐。
- 其他文本保留行号、撤销 / 重做、查找、基础 JS / TS / JSON 高亮。
- 编辑默认自动落盘；`⌘S` 仅用于 flush/retry；**File → Reload from Disk** 重读磁盘；`⌘W` / **File → Close File** 关闭当前文件。正文不再显示文件工具栏、格式工具栏和底部状态栏；格式操作移到系统 **Format** 菜单，源码切换位于 **View → Toggle Markdown Source**。
- 切换文件、文件夹和正常退出会取得冻结快照并等待自动写入完成；IME 结束后继续，不弹出普通文档保存确认。
- 磁盘轮询/条件写确认外部变化后采纳磁盘内容，推进 persistence epoch，忽略旧写回执；自身写回声不得覆盖新输入。真正 I/O 失败保留输入并显示可重试错误。
- 保留 UTF-8 BOM、LF / CRLF 和末尾换行；普通 POSIX 文件权限随保存保留。
- 外围 `⌘B` / `⌘J` 切换左右区域；Markdown 内容焦点内的 `⌘B` 由原产品格式命令处理。拖动分隔线调整宽度。
- Settings 按 Web 的 sidebar/main/components 分层；语言、深/浅色、三档文字尺度、Header Changes/Terminal 可见性、Project Rail 和创建菜单配置修改后自动持久化。不跟随系统主题；其他未接通设置明确只读/禁用。Feedback 已有原生表单，但附件和发送禁用，**不会上传任何内容**。

**Markdown 已接真实产品格式组件，但还不是完整多格式 Editor workbench/L3。** Header 的 Git 现在显示实际变更和同步计数，打开右侧 Changes；Terminal 图标打开原生工作台。两者切换保留 Agent/Terminal 实例。

可用 `PUPPYONE_EDITOR=native cargo run --release --locked -- --workspace /path/to/project --file README.md` 直接进入原生模式。`src/native_editor/` 按下列职责维护；两种内核共用 `documents.rs` / `workspace.rs` 保存权威。独立 `native-editor-probe/` 继续作为历史内存验证程序，不是此产品入口。

```text
native_editor/
  core/       文档、字级标记、全局投影、选区、类型化命令、有界快照历史
  markdown/   pulldown-cmark 解析、无损序列化、原文回退
  features/   段落、标题、列表、代码、格式与跨节点编辑规则
    table/    commands / navigation / clipboard / projection / tests
  host/       会话、统一提交与 IME 分组、open/snapshot/saved 协议
  gpui/       连续页面、事件桥、Kit 排版、命中、外观与平台输入
    input/   键盘导航、指针、剪贴板、IME、绘制及输入回归
```

简单功能使用单文件；表格这类同时拥有命令、导航、粘贴和投影的功能才使用目录。它们共用文档、选区和历史，不各自创建编辑器 entity。新增节点与命令的维护规则以[原生编辑器模块边界](https://github.com/puppyone-ai/puppy-issues/blob/main/document/puppyone-desktop/platform/rust-native-frontend/architecture.md#native-markdown-module-boundaries)为准；`tools/check-ui-boundaries.py` 检查分层依赖，`tools/verify.py` 运行主程序和历史 probe 回归。

原生编辑快捷键：`⌘A` 全文选区，`⌘B/I` 粗斜体，`⌘Z/⇧⌘Z` 撤销/重做，`⌘←/→` 行首尾，`⌥←/→` 按词移动；加 Shift 扩选，`⌘↑/↓` 文档首尾。Enter 分段，Shift+Enter 软换行，空列表项 Enter 退出；`⌘Enter` 在当前结构后插入正文。`# ` / `## ` / `> ` / `- ` / `[ ] `、配对粗斜体标记和代码围栏输入可转换为格式。表格支持单元导航和跨单元选区清除；边界不会像普通段落一样合并。

## Native Git and Agent workbench

- `src/features/source_control.rs`：Changes 分组、虚拟文件列表、Diff、最近 100 条提交历史、暂存/取消暂存、提交、Fetch/Pull/Push。Git CLI 后台执行，使用 literal pathspec、NUL 状态解析、超时和 workspace epoch；只在已打开的仓库根目录执行。状态在窗口激活时每 3 秒刷新，也支持手动刷新。Discard、Pull、Push 有明确的操作确认。
- `src/features/workbench/`：中立的项目级标签/分组/分屏模型；每次 `+` 产生独立 New tab；拖动重排/跨组/边缘分屏、调整分屏、溢出列表、Header 左右/Home/End 导航。隐藏或切换项目保留实例；关闭最后标签显示 launcher；运行中的标签及应用退出先确认停止。
- `src/features/desktop_agent/`：沿原产品的 domain / application / infrastructure / ui 分层；原生虚拟转录、Markdown/表格/代码复制、工具折叠、图片附件预览、拖入/选择引用、命令建议、逐会话草稿、失败草稿显式恢复、模型/模式/思考强度、历史过滤及审批/问题/MCP 表单。
- `src/agent/`：独立 native runtime port、composition root、Codex/Claude adapters、共享 ACP 与 Pi RPC、不可变引用、会话 catalog、有界 JSONL transport。Codex 支持 fork/steer/rename/compact/archive；其他运行时按实际协商能力显示控件。每项目最多 8 个、应用最多 32 个 Agent owner，隐藏不释放租约。
- `src/model_connections/` 与 `src/features/model_connections/`：独立的 Rust 模型配置服务和 GPUI 设置；新增/刷新/删除确认、配置代次检查、删除后防复活与 Keychain 引用；成功写入后清理无引用旧密钥。Settings 和 Agent 页面共用服务。Local Agents 设置显示实际安装位置与缺失状态。
- `src/agent/runtimes/puppyone_agent/`：产品内置的 Rust HTTP/tool loop；从 **Settings → Model Connections** 或 Agent 页的 **Model connections…** 配置 OpenAI-compatible endpoint/model。支持本地兼容服务；远端使用 HTTPS、禁止自动重定向，密钥仅进入 macOS Keychain；JSON 只存版本化 credential reference，密钥值不进入 JSON/argv/env。具备 read/ls/find/grep/write/edit/bash、显式写入/命令审批、Plan 模式、停止、持久历史、分叉、重命名、上下文压缩和模型绑定代次检查。没有自动导入 Electron 凭证，也没有把外部 Pi CLI 改名冒充内置运行时。
- `src/features/terminal.rs` + `src/platform/terminal.rs`：原生 GPUI 终端、PTY、VT100/ANSI、颜色、光标、滚屏、IME、粘贴、终端查询响应和窗口尺寸同步；视口拖选/双击选词/复制、Cmd 点击 HTTP(S) 链接、X10/UTF-8/SGR 鼠标（Shift 绕过）、功能键/导航修饰键。输出、滚动及 resize 会清除选区，尚无跨滚屏持久选区/OSC 8/像素鼠标；本机发现的 Claude Code、Cursor、Hermes、OpenCode、Pi、WorkBuddy 等 CLI 可从终端启动。
- `src/platform/` 与 `src/agent/transports/`：独立 worker 管理 Git/JSONL/PTY；有界管道与 Wake，前台不执行阻塞式等待。关闭发送进程组信号并由 worker 回收 child；PTY 真实退出有集成验证。

原生 Chat 入口覆盖 PuppyOne Agent、Codex、Claude、Cursor、Hermes、OpenCode、Pi、WorkBuddy；安装发现、协议握手与真实推理是不同层级的验证。Workbench 将布局和 native session identity 原子保存为项目元数据；重启后显式 Resume，不重放之前的命令。CLI 自己拥有登录，Rust 不复制其认证文件。

当前验证以 `artifacts/gpui-verification/result.json` 及独立 probe 收据为准，包含连续文档交互和真实临时文件保存检查；新连续编辑版本的 OS 视觉/真实中文候选窗尚未验收。Codex 的真实推理/上下文/工具写入/Stop/恢复/fork/rename/文本引用，Cursor 的回复/第二轮上下文/跨进程会话恢复，PTY 与内置 Rust Agent 的 HTTP SSE/审批/拒绝/恢复/分叉/停止/绑定隔离集成通过。内置运行时使用本机回环模型夹具，**不等于已用用户真实模型完成推理**。Pi 回复及第二轮上下文通过，但当前 `pi-with-claude/opus` 配置在重启后丢失模型上下文；原生 CLI 对照也复现，不能声明其恢复验收通过。Pi 适配器已修正现代 `agent_settled`/重试边界、最终模型错误和历史加载竞态。Claude 原生握手通过，但当前配置的 `api.omnimaas.com` 返回 HTTP 522，真实推理失败。OpenCode 使用隔离配置握手通过，用户配置中的 `oh-my-openagent` 下载/启动失败没有被修改。Hermes/WorkBuddy 未安装，未做实机验证。

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

尚不能称为 Electron Agent 的全量对等：Mermaid 图形、全部活动 renderer/内联资源/高级 mention、完整安装/账户/托管 compute、持久 feed/request ledger、崩溃级 supervisor、终端鼠标/选区、完整辅助技术和视觉对齐仍有缺项。高级 Git hunk/分支/图历史也未迁入。Editor 正文继续并列保留 Web 与 Rust 内核。

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

**Native/Web 共用 `editor/document_session` 的自动保存队列与磁盘 epoch。** `documents.rs` 只适配导航、快照和 I/O 完成；完整 L3 Working Copy/Root registry 与多 pane 寿命仍未迁入。当前 Home 仍临时切换 Explorer，centered Header 也不是正式默认布局；已登记为迁移缺口。

`src/ui/` 提供 GPUI 按钮、图标与原生文本输入；Shell、Settings、Feedback、项目菜单、分隔线、文件树和确认框已迁移。文件树使用 GPUI 虚拟列表；目录选择与编辑激活分离，祖先线绘制有预算。后台完成通过有界唤醒通道回到 GPUI entity，无持续空闲绘制；Git 在已打开项目且窗口激活时按 3 秒周期刷新。完整 UI kit、同源 token 编译和产品样式弹层尚未完成。

## 架构仍是“Rust 外围 + 必要的 Web 内容”

```text
Rust / GPUI Kit 0.8.0 / gpui-pre 0.3.9 / Metal (macOS)
├─ 标题栏、项目入口、Explorer、系统菜单、分隔线和弹窗
├─ 原生 Changes、Workbench tabs/groups、多运行时 Agent Chat、PTY Terminal
├─ Workspace capability、后台读写、文档身份、保存与关闭协调
└─ 单个 Wry child WebView（编辑器窗格）
   ├─ 原产品窗格外框：⋯ 手柄、窗格菜单、查找（EditorPaneShell / EditorPaneChrome / EditorPaneActionsMenu）
   └─ 原产品 Viewer：Markdown（实时预览 / Source）、CSV 表格、JSON、文本 / 代码，按产品注册表路由
```

- 窗口外围不是 HTML/CSS；没有 Tauri 全页面外壳，也没有 Electron 运行时。
- Web 编辑器没有文件系统 API；只能上报已打开文档的 token、revision 和受限快照。保存路径由 Rust 持有。
- `cap-std` 将目录访问约束在原生打开的 capability 内。拒绝绝对 / `..` 路径、外部符号链接和特殊文件；文档还绑定 workspace grant。
- Web 页面只加载内嵌本地代码/CSS/字体，CSP 禁止网络、子 frame、图片和表单提交；仅放行字体 data URL，阻止导航和新窗口。
- 切换 / 关闭不单靠异步 dirty 标记：先冻结 Web 编辑器并索取快照，确认收到后才决策。5 秒内无确认则取消操作，不静默关掉文件。
- 保存使用同目录独占临时文件 → 写入 / sync → 再检查磁盘版本 → rename → 回读确认。失败不把缓冲区标成已保存。
- macOS 已改为实时叠层：WKWebView 位于透明 GPUI/Metal view 下方，原生 popup/modal 正常覆盖，**不隐藏、不截图替代、不重建编辑器**。hitTest 路由真实输入；模态期间页面 inert、异步 loaded 不抢后台焦点。仍须验证真实 IME/焦点/全屏/DPI/辅助技术；Windows 尚保留旧 occlusion。
- 项目 popup 支持重复触发、外侧点击、Escape、本地项关闭和 trigger focus。Feedback backdrop 不关闭；显式关闭清空未发送字段，与原产品对齐。
- macOS 原生 Edit 菜单提供 WKWebView 所需的剪贴板 / 撤销快捷键；Quit 经过同一自动保存 drain。

应用不导入已安装 Desktop 的配置或更新源。Codex 运行与原生历史由本机 CLI 使用其现有登录；Agent 在用户发起任务后可操作所选项目。文档编辑器与设置偏好修改后自动写入，Git 变更由对应操作触发；没有应用遥测。

## 当前限制：务必先看

- **单窗口、一个当前根目录、Editor 单文档**；Editor 尚无多标签、删除 / 重命名、Save As、正式资源监听 journal、最近项目或会话持久化；已有单文档磁盘轮询与 Folder/Markdown/text/JSON/CSV/HTML 新建。辅助工作台已有独立多标签和项目内保留。
- 文本文件上限 **4 MiB**；单目录最多 **2,000 项**。二进制、非 UTF-8、混合换行 / CR-only 明确拒绝；不是所有格式都能编辑。
- 保存只读文件、符号链接文件本身和硬链接会拒绝；不自动重建已被外部删除的文件。
- 保存会保留基本权限，**不保证保留 ACL、扩展属性、原 owner 等全部元数据**。
- 版本检查与 rename 之间仍存在普通文件系统的竞争窗口，**不是针对不协作写入者的原子 compare-and-swap**。不要把 M1 用于有持续并发写入的重要文件。
- 没有崩溃恢复或磁盘草稿；强制退出 / 系统崩溃可能丢未保存内容。窗口正常关闭等待写入完成，不等于崩溃恢复已实现。
- 中文正文已参与真实保存测试；macOS 文件名使用可用的系统 Unicode 字体 fallback。完整中文 IME、RTL、辅助技术、拖放和各平台剪贴板矩阵尚未验收。
- 尚无完整 Git / Cloud / 设置服务、Feedback 发送、全部 Agent 能力、PDF / Office；Markdown 图片资源、链接导航、Mermaid/Worker 执行服务也未接通。**不是“所有外围与业务都迁完了”。**
- 像素精度仍未达标，菜单 / 窗口按钮 / 字体光栅 / 截断仍需收敛；之前纯 Rust 空壳的体积和内存数字不能代表现在带 WebView 的版本。

## 验证

可运行 `python3 tools/verify.py --gui` 一次验证两套 GPUI 程序并生成带源文件摘要的收据；省略 `--gui` 则不启动窗口。

```bash
cargo fmt --check
python3 tools/check-ui-boundaries.py
python3 tools/import-localization.py --check
python3 tools/generate-assets-rs.py --check
python3 tools/import-agent-marks.py --check
python3 tools/audit-ui-migration.py --check
cargo test --locked
cargo clippy --all-targets --features webview-smoke --locked -- -D warnings
cargo build --release --locked
python3 tools/smoke-editor.py --capture
```

前一阶段的 GUI 收据：**45 项主程序测试、23-check native-window / Wry / CodeMirror smoke 与 Release 构建通过。** 当前 Agent/Workbench 的测试与限制见上文，不能把旧 GUI 收据当作新增能力的验收。

| 层级 | 验证内容 |
| --- | --- |
| Workspace | 真文件读取 / 保存 / 重读、UTF-8 中文、BOM / CRLF、删除 / 外部写冲突、只读 / 硬链接、路径和符号链接越界、workspace grant、体积 / 编码限制、临时文件清理 |
| 文档状态机 | 迟到 dirty、过期 token/request/epoch、单写合并、IME Deferred、旧写回执/自身回声、外部采纳、切换失败回退、自动 drain |
| Rust UI | 点击、树展开、布局、10 万行仅绘制可见行、空闲不持续 repaint；任务快捷键不误关文档、Feedback 草稿/backdrop/Escape、Settings 响应式几何 |
| 真实 GUI | 20 项 checks：含富标题/表格、checkbox→Markdown→undo、模式/主题/8 locale 保留模型；实时叠层/native 命中、模态禁止 DOM focus、popup 外侧关闭、right toggle 保留 revision；自动落盘、外部采纳、无保存提示切换和退出；OS 截图检查实际可见文字 |

`tools/smoke-editor.py` 只使用自己创建、带标记的临时目录；特殊驱动仅在 `webview-smoke` feature 构建里存在。需要可用的桌面会话。结果在 `artifacts/editor-smoke/`；不操作真实用户项目。原生文件选择器本身、真实键盘 / IME 和所有平台输入设备并未由这套脚本完全覆盖。

上游 `block 0.1.6` 和 `proc-macro-error2 2.0.1` 有 future-incompatibility 警告；当前构建通过，但工具链升级前需处理。

### 编辑 Web 部分

编辑器窗格按产品的挂载路径运行产品代码：`EditorPaneShell` → `EditorPaneRuntime` 的贡献 Provider → `EditorFindHost` → `PresetViewerRenderer` → Viewer（`editor/src/pane.tsx`）。唯一的替换是持久化：`EditableDocumentSource` 桥接到 Rust 文档会话（快照 / dirty / saved / freeze 协议），不运行产品的 Working Copy 和自动保存队列。样式是产品完整的 `cascade.css` + `styles.css`，依赖解析到产品已安装的依赖图（含 CodeMirror 调度补丁），因此 token 划分和排版与 Electron 渲染器相同。`editor/src/webkit-parity.css` 只修正一个引擎差异：WebKit 会把小数行高向下取整。

`editor/bundle/` 是已提供、应与源码一起提交的可重建资源，不需要运行本地 HTTP 服务器。修改 `editor/src/` 后：

```bash
cd editor
npm ci
npm run build
cd ..
cargo run --release --locked
```

构建通过 `product-source.json` / `PUPPYONE_PRODUCT_ROOT` 指向真正的 Web checkout，导入共享 Markdown 组件、完整 editor CSS 入口和产品字体尺度逻辑，不拷贝另建内核；`editor/bundle/sources.json` 记录来源 commit 与输入摘要。JS/CSS 普通 Cargo 构建直接内嵌，因此不需要 Node server。依赖锁定在独立的 `editor/package-lock.json`，强制使用一份 React/CodeMirror，不修改原 Electron 项目的包依赖。许可证见 [THIRD_PARTY.md](THIRD_PARTY.md)、`editor/bundle/THIRD_PARTY.txt`、`assets/` 和仓库根许可证；未来分发包也必须携带这些 notices。

### 编辑器像素门禁

```bash
# Chromium 参考：真实产品窗格 + 产品注册表路由，fixtures/editor/* × 深浅色 × 菜单/源码
/path/to/original-repo/node_modules/.bin/electron tools/reference-editor.mjs
# 岛（WebKit，与 wry 同一引擎）对比：viewer 路由一致、块级几何 0 偏差、像素匹配率 ≥ 98.5%
python3 tools/compare-editor.py --check
# 单独调试岛：WebKit / Chromium
python3 tools/island-webkit.py fixtures/editor/sample.csv out.png --menu
electron tools/island-debug.mjs fixtures/editor/sample.md out.png
```

报告在 `artifacts/editor-parity/report.json`。剩余像素差是两个引擎的字形光栅化；WebKit 折行段落的视觉行距为整数（26px 对 26.25px），单行块已由 `webkit-parity.css` 补齐，折行段落内仍有每行 0.25px 的差异，报告中单列为 engineSubpixel。`python3 tools/verify.py --gui` 会运行该门禁。

### 真实产品组件参考

```bash
PUPPYONE_NODE_MODULES=/path/to/original-repo/node_modules \
  /path/to/original-repo/node_modules/.bin/electron tools/reference-primitives.mjs
```

探针导入真实 `SidebarRow` / `SidebarList` / `SidebarIconButton`，保留生产 CSS layer，检查 Default-neutral/Medium 的 light/dark 几何和状态。输出在 `artifacts/primitives-reference/`，带 component/CSS/font hashes、commit、engine 和 DPR。只代表这些真实组件；尚未接完整 App/Appearance runtime，也尚无对应 native gallery 的逐像素通过证据。

任务表面直接运行 `tools/reference-shell.mjs`（同样的 Electron/依赖环境），产生 Settings/project/Feedback/离线 Agent launcher × light/dark × en/zh-Hans 共 16 组 `artifacts/shell-reference/` PNG/JSON。使用真实组件、CSS layers、编译后的主题和 catalog；不代表全 App 或 Agent/Cloud 服务已接入。

真实组件区域可严格比较（当前 **exit 1 / pixelIdentical: false**，没有降低阈值）：

```bash
python3 tools/compare.py artifacts/shell-reference/settings-dark-en.png \
  artifacts/editor-smoke/settings-over-editor.png --surface settings --check
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

Python 比图依赖 Pillow / numpy。截图模式显式使用合成树、关闭 WebView，只测外围，不会自动保存真实文档。原 CSS 静态参考不等于完整 React 产品验收；评分排除空白 Editor / Agent 区域并单列文字 / 图标前景误差。历史调研和像素结果见 [RESEARCH.md](RESEARCH.md)。

## 可选：独立原生编辑器小验证

用户后续授权的实验位于 [`native-editor-probe/`](native-editor-probe/README.md)：原生段落粗体/斜体、可编辑表格、统一撤销和 IME 事件回归。它是独立 Cargo 程序，**不替换这里的 Web 编辑器**；只在内存中运行，没有文件打开/保存或正式偏好服务。

```bash
cd native-editor-probe
CARGO_TARGET_DIR=../target cargo run --release --locked
```

这是一个有明确限额的小验证，不是已经完成原生富文本重写。当前实现、许可说明和验收边界见其 README；真实系统 IME 仍须手动验证。

## 源码入口与下一步

- `src/main.rs` / `shell.rs` / `theme.rs`：GPUI Application、entity、事件与布局。
- `src/native_editor/`：文档核心、Markdown 编解码、功能模块、会话与 GPUI 适配；`src/ui/input.rs` 仅保留共享输入类型/动作的兼容导出，实际输入实现位于 `native_editor/gpui/input*`。
- `src/wake.rs`：后台 I/O 的有界唤醒；`src/capture.rs`：显式启用的 macOS 合成截图。
- `src/task_ui.rs`：首批原生 Settings / Feedback；尚未通过完整像素验收。
- `src/workspace.rs`：受限文件访问、编码和保存。
- `src/documents.rs`：单文档状态机和关闭检查。
- `src/web_editor.rs` / `web_composition_macos.rs`：本地 WebView、IPC、实时合成 / 命中；明确转换 GPUI 顶部原点与 AppKit 底部原点。
- `src/localization.rs` / `tools/import-localization.py`：同源 locale 投影，不持久化用户偏好。
- `src/project_ui.rs`：锚定 Header 的原生项目位置 popup。
- `editor/src/markdown.tsx`：真实产品 Markdown 组件到 M1 协议的 adapter；不拥有磁盘路径或保存权威。
- `tools/smoke-editor.py` / `src/smoke.rs`：明确隔离的真实 GUI 验证。

下一批按架构门槛推进：**字体/像素/叠层适配性 → 同源外观与原生组件 → 正式 Workspace 导航 → 保留现有 Editor 内核并适配 Rust 端口 → Right Sidebar/执行宿主**。文件操作随所属领域补齐，不顺手新增产品未接受的草稿历史或并发多视图语义。

当前目录留在 `codex/rust-shell-spike` worktree，原 `main` 未改，尚未提交 / 合并。最终仍按同仓库独立目录评审和逐步迁移，不需要另开产品仓库。
