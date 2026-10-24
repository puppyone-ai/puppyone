# PuppyOne Rust — GPUI local workspace / Markdown integration

> **Rust 前端现统一依赖 GPUI Kit 0.8.0（其 GPUI 后端为 gpui-pre 0.3.9）。**
> 可以打开真实文件夹、编辑已有文本文件并保存；文档编辑器全部是 **Rust 原生实现**（Markdown 实时预览、CSV 表格、纯文本），不再内嵌 WebView。
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

验证平台：**macOS 26.5 / Apple Silicon，Rust 1.97.1**。Windows / Linux 未构建、打包或实机验证。需要 Rust 和系统原生构建工具；构建 / 运行不需要 Node。GPUI Kit 固定为 crates.io `0.8.0`，使用其配套 GPUI/平台后端；macOS 使用 Metal。首次构建需下载 Cargo 依赖。

## GPUI Kit 复用范围

- `gpui_kit::application/open_window`：平台入口、窗口 Root、焦点和组件初始化；不维护 Kit fork。
- 共用 Button / IconButton、工作台 Tab、Checkbox、Dialog 直接使用 Kit；保留产品颜色、布局与业务命令。
- 普通表单、Agent composer、Git commit、模型配置及问答字段使用 Kit Input/Textarea。选择、文本编辑、IME 事务和撤销交给 Kit；薄适配器保留长度限制、Tab 焦点和 ⌘Enter。
- Agent Markdown 使用 Kit TextView，代码复制和受限链接保留；正文中的图片地址不会自动读取本地文件或请求网络。
- 原生文档编辑器（`src/editor/`）由 Kit 公开的 `text::editor_host` 排版和绘制正文；文档、装饰、块几何、选区、光标、输入法和指针由应用持有（见 [`src/editor/ARCHITECTURE.md`](src/editor/ARCHITECTURE.md)）。Kit 不是完整的编辑内核；文件树加载、分屏拓扑、Terminal/Agent 运行和文件保存同样保留各自 owner。
- `src/native_editor/` 是早期原型，仍提供少量共享输入类型与动作，计划退役（PARITY_TODO N11）。

未采用 `gpui-kit-markdown-editor` 或其他独立编辑器库。GPUI Kit 上游在 2026-10-23 查询时为 18,506 stars；这是本次选型门槛，不是成熟度或无缺陷保证。此后新增直接依赖仍需按用户的项目规模限制评估。

## 这一版可以做什么

- 选择真实本地文件夹，展开目录，读取文件；目录扫描和读写在后台线程。
- 点击已有 UTF-8 文本文件，在原生编辑器里编辑：Markdown（`.md` / `.mdx` / `.markdown`）实时预览与源码模式，CSV / TSV 表格与源码模式，其他文本为纯文本编辑。系统 **View → Toggle Markdown Source** 切换实时预览 / 源码。
- **Markdown 源码是唯一真相**：实时预览不改写原文。原生支持标题、强调、链接 / 维基链接、列表、任务、引用、分隔线、带高亮的代码块和可编辑表格；数学公式、Mermaid、图片、HTML / MDX 块尚未原生实现，按原文显示，不会被静默丢弃。几何与产品逐块对齐的验收见 PARITY_TODO §7。
- 输入法：所有原生编辑器共用一套组字适配（中文 / 日文 / 韩文 / 死键 / 长按重音），整段组字一步撤销；过滤部分输入法（如搜狗）把方向键当文字插入的功能键字符。
- 其他文本文件：撤销 / 重做、查找、输入法；暂无行号和语法高亮。
- 编辑默认自动落盘；`⌘S` 仅用于 flush/retry；**File → Reload from Disk** 重读磁盘；`⌘W` / **File → Close File** 关闭当前文件。正文不再显示文件工具栏、格式工具栏和底部状态栏；格式操作移到系统 **Format** 菜单，源码切换位于 **View → Toggle Markdown Source**。
- 切换文件、文件夹和正常退出会取得冻结快照并等待自动写入完成；IME 结束后继续，不弹出普通文档保存确认。
- 磁盘轮询/条件写确认外部变化后采纳磁盘内容，推进 persistence epoch，忽略旧写回执；自身写回声不得覆盖新输入。真正 I/O 失败保留输入并显示可重试错误。
- 保留 UTF-8 BOM、LF / CRLF 和末尾换行；普通 POSIX 文件权限随保存保留。
- 外围 `⌘B` / `⌘J` 切换左右区域；Markdown 内容焦点内的 `⌘B` 由原生 Markdown 格式命令处理。拖动分隔线调整宽度。
- Settings 按 Web 的 sidebar/main/components 分层；语言、深/浅色、三档文字尺度、Header Changes/Terminal 可见性、Project Rail 和创建菜单配置修改后自动持久化。不跟随系统主题；其他未接通设置明确只读/禁用。Feedback 已有原生表单，但附件和发送禁用，**不会上传任何内容**。

**编辑器仍是单窗格、单文档，不是完整多格式 Editor workbench/L3。** Header 的 Git 现在显示实际变更和同步计数，打开右侧 Changes；Terminal 图标打开原生工作台。两者切换保留 Agent/Terminal 实例。

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

可运行 `python3 tools/verify.py` 一次验证主程序和历史 probe 并生成带源文件摘要的收据；不启动窗口。

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
```

`dev-capture` feature 只打开开发用截图、编辑器几何导出和视觉 fixture，不进入正常构建。

| 层级 | 验证内容 |
| --- | --- |
| Workspace | 真文件读取 / 保存 / 重读、UTF-8 中文、BOM / CRLF、删除 / 外部写冲突、只读 / 硬链接、路径和符号链接越界、workspace grant、体积 / 编码限制、临时文件清理 |
| 文档状态机 | 迟到 dirty、过期 token/request/epoch、单写合并、IME Deferred、旧写回执/自身回声、外部采纳、自动 drain |
| Rust UI | 点击、树展开、布局、10 万行仅绘制可见行、空闲不持续 repaint；任务快捷键不误关文档、Feedback 草稿/backdrop/Escape、Settings 响应式几何 |
| 原生编辑器 | GPUI 测试平台上的输入、撤销、Markdown 装饰与命令、表格操作、CSV 视图、查找、宿主协议；输入法场景矩阵见 `src/editor/view/ime_tests.rs` |

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

当前结果（块位置、字符偏移、像素一致率）见 PARITY_TODO §7.2。

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

## 可选：独立原生编辑器小验证

用户后续授权的实验位于 [`native-editor-probe/`](native-editor-probe/README.md)：原生段落粗体/斜体、可编辑表格、统一撤销和 IME 事件回归。它是独立 Cargo 程序，**不是这里的产品编辑器**（产品编辑器在 `src/editor/`）；只在内存中运行，没有文件打开/保存或正式偏好服务。

```bash
cd native-editor-probe
CARGO_TARGET_DIR=../target cargo run --release --locked
```

这是一个有明确限额的小验证，不是已经完成原生富文本重写。当前实现、许可说明和验收边界见其 README；真实系统 IME 仍须手动验证。

## 源码入口与下一步

- `src/main.rs` / `shell.rs` / `theme.rs`：GPUI Application、entity、事件与布局。
- `src/editor/`：原生文档编辑器（文本内核、视图、Markdown、CSV、表格、宿主协议），见其 `ARCHITECTURE.md`。
- `src/native_editor/`：早期原型；`src/ui/input.rs` 仍从这里导出共享输入类型/动作，计划退役。
- `src/platform/ime.rs`：系统输入法补充（丢弃组字、过滤功能键字符）。
- `src/wake.rs`：后台 I/O 的有界唤醒；`src/capture.rs`：显式启用的 macOS 合成截图。
- `src/shell/tasks.rs`：首批原生 Settings / Feedback；尚未通过完整像素验收。
- `src/workspace.rs`：受限文件访问、编码和保存。
- `src/documents.rs`：单文档状态机和关闭检查。
- `src/localization.rs` / `tools/import-localization.py`：同源 locale 投影，不持久化用户偏好。
- `src/shell/project_menu.rs`：锚定 Header 的原生项目位置 popup。

下一批按架构门槛推进：**字体/像素/叠层适配性 → 同源外观与原生组件 → 正式 Workspace 导航 → 保留现有 Editor 内核并适配 Rust 端口 → Right Sidebar/执行宿主**。文件操作随所属领域补齐，不顺手新增产品未接受的草稿历史或并发多视图语义。

当前目录留在 `codex/rust-shell-spike` worktree，原 `main` 未改，尚未提交 / 合并。最终仍按同仓库独立目录评审和逐步迁移，不需要另开产品仓库。
