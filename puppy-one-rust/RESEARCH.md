# Rust 原生外围：调研记录与迁移建议

> 历史调研：下文记录 egui 初版及当时的候选比较。2026-10-22 已将主程序与独立原生编辑器迁到 GPUI 0.2.2；当前实现与运行方式以 [README](README.md) 为准，本文性能/像素数据不代表 GPUI。
> 状态：首轮 Experiment 调研快照 / 未采纳为正式架构。2026-10-03。
> M1 当前实现与限制以 [README](README.md) 为准；本记录中的纯外围性能数据属于上一阶段。
> 代码基线：`puppyone@0e88a283ae12571671fed0da24b6463f74578d73`（创建 worktree 时的本地 `qubits`）。
> 工作分支：`codex/rust-shell-spike`。本目录没有改变现有产品实现或发布契约。

## 1. 结论

**可以做，而且应以同仓库独立目录、分阶段替换，而不是全量重写开始。** 但用户要求的“外围必须由 Rust 绘制”，与常规 Tauri + React 的迁移不是一回事。

> 历史调研记录。Rust 版此后已移除 Wry / WebView 编辑器，文档全部由原生编辑器打开（见 README 与 PARITY_TODO N11）。

首轮原型证明了独立 Rust GPU 窗口、既有视觉几何映射、原生交互和可重复差异测试可以落地。随后 M1 已接入一个真实 Wry / CodeMirror 编辑区域，跑通本地文件读取、编辑、保存、外部冲突和关闭检查，并通过真实 native GUI 集成测试。

**这仍未证明完整产品像素一致、两个 Web island 的完整宿主契约、所有输入法 / 平台组合或迁移后的整体性能更好。** 右侧 Agent / Terminal 尚未接入；CodeMirror 基础文本适配器也不等于现有完整多格式 Editor。

建议暂不直接合入集成分支、不替换现有入口、不改稳定版升级源。后续达到实验验收门槛后，先把整个 `puppy-one-rust/` 以实验目录合入 `qubits`；产品入口切换是另一次独立决策。不要维护两个长期产品分支。

## 2. 现有实现和可保留的资产

基线源码统计（仅 `.ts/.tsx/.mjs/.cjs`，包含声明及生成文件，不代表工期）：

| 范围 | 文件 | 行 |
| --- | ---: | ---: |
| `src/` | 729 | 92,036 |
| `electron/` | 480 | 58,254 |
| `local-api/` | 21 | 7,486 |
| `shared/` | 61 | 5,706 |

`electron/preload.cjs` 中 `invoke/send/on` 的不重复字面量 IPC 通道共 **249**；不是 249 个独立功能，也不覆盖动态通道。

| 领域 | 现状 / 入口 | 第一阶段建议 |
| --- | --- | --- |
| 窗口外框、标题栏 | `src/components/DesktopWindowChrome.tsx`、`src/styles/titlebar.css`、`electron/main/window-layout-contract.mjs` | Rust 重绘与窗口平台适配 |
| Explorer / Project Rail | `packages/shared-ui/src/data/ExplorerTree.tsx`、`src/features/app-shell/ProjectSwitcherRail.tsx` | Rust 状态投影和虚拟列表；保持现有交互契约 |
| Editor | `packages/shared-ui/src/editor/`、`src/features/editor-workbench/`；CodeMirror 和多格式 Provider | 不改业务内核，抽离宿主和存储桥接 |
| Terminal | `src/features/desktop-terminal/runtime/terminalSessionBridge.ts`、`electron/utility/terminal/`；xterm、node-pty、headless 屏幕 | 保留 xterm 和会话内核；优先适配传输而非重写 PTY |
| Chat / Agent | `src/features/desktop-agent/`、`electron/main/agent/`、`electron/utility/agent/` | 保留 React 内容、Provider、Actor、审批和消息语义 |
| 执行隔离 | `electron/main/item-hosts/utility-host.mjs`、`electron/utility/item-host-runtime.mjs` | 重新实现宿主能力，不可把所有会话塞进 Rust UI 线程 |
| 文件 / Git / Watch | `electron/main/ipc/workspace-*.mjs`、`local-api/` | 逐个迁移窄接口，建立旧新实现契约测试 |
| 凭证 / 登录 / 更新 | `safeStorage`、native protocols、Electron updater / release tooling | 后期专项迁移，不能以通用插件替代产品安全与发布契约 |

**“UI 不用 Rust 重写”不等于“现有 React 组件在新宿主中零改动就能运行”。** 当前 `window.puppyoneDesktop`、Electron MessagePort 转移、`utilityProcess`、`process.parentPort`、本地协议、SDK 的 Node / native 依赖都需要适配。

## 3. 技术选项

| 路线 | 是否满足 Rust 外围 | 评价 |
| --- | --- | --- |
| Tauri 2 + 原 React 全页面 | 否，外围依然是 DOM | 更低迁移成本，但不符合本次约束；不作为当前实现 |
| egui / eframe + wgpu | 是，Rust GPU 绘制 | 本次原型；可快速控制几何、缓存、渲染预算。文本、无障碍和混合 WebView 需要认真验证，不能因为原型能跑就锁定最终框架 |
| GPUI | 是，Rust GPU UI | 值得下一轮比较字体、列表、IME、原生窗口集成；本次未构建，不能宣称优于 egui 或能直接嵌 WebView |
| Slint / Iced | 是 | 可比较保留式 UI / 布局能力；相同的 WebView 叠层和平台约束仍需实证 |
| 各平台原生控件 | 是，但大量平台特定代码 | 系统集成好；自定义产品样式与跨平台像素一致成本高，不建议现在分成多套外围 |

选 egui 是为了做**可运行和可测的原生实验**，不是已经做出长期 UI 框架决策。若绝对像素一致性需要不同的文本 shaping / rasterization 或更强的系统控件接入，应在迁移业务前重新选择，而不是靠截图背景比例证明成功。

## 4. 目标边界（M1 只完成基础 Editor 垂直切片）

```text
Rust 主窗口 / 原生事件循环
├─ Rust 外围：Header、Project Rail、Explorer、菜单、设置、分隔线
├─ Editor Web island：现有 Editor workbench / CodeMirror / previews
└─ Right Sidebar Web island：公共工作台 + Agent / Terminal 内容
          │ 窄接口、版本化 DTO、明确授权、请求 / 会话代次
Rust 本地服务 / 会话监督
├─ Workspace / 文件 / Watch / Git / 偏好 / 系统集成
└─ 每运行会话独立 execution host
   ├─ 过渡期 Node sidecar：现有 Agent SDK、PTY / headless 内核
   └─ 后续有独立收益证据才把某服务换成 Rust
```

- 初期只考虑 Editor 和整个 Right Sidebar 两个内容区域，**不要每个 Tab 创建一个原生 WebView**。
- 公共 Right Sidebar 标签、分组、Portal 和会话生命周期已有成熟 DOM 契约，先保留在同一个右侧内容区域。原生外围只控制这个区域的外边界，不复制其内部布局状态。
- Rust 拥有外围矩形 / DPI；Web 只收到自身视口。不能双向每帧同步一套 DOM 与原生布局权威。
- macOS 可探索 Wry / WKWebView；Windows 为 WebView2；Linux Wayland 需要额外 GTK 集成。Wry 的 child WebView 支持不等于可以无改动嵌进 eframe。
- 必须先验证：raw window handle、主线程 / run loop、GPU surface 与子视图叠层、resize 裁切、滚轮穿透、IME、拖放、键盘焦点、辅助技术，以及 Rust 菜单覆盖 WebView 的行为。不能拿原型纯 Rust 的弹窗效果代表混合宿主效果。
- 系统 WebView 不再是固定版本 Chromium。需验证 CodeMirror 布局 / 中文输入 / Selection、xterm WebGL / 字符宽度、PDF / DOCX / Mermaid / CSP / Worker / 自定义协议。

现行权威文档明确 Chat / Terminal **同 DOM 展示、逐会话 utility 隔离执行**。不要把之前被删除的逐 item `WebContentsView` 架构换个名字恢复：
[Right Sidebar 内容宿主与隔离](https://github.com/puppyone-ai/puppy-issues/blob/main/document/puppyone-desktop/right-sidebar/architecture/item-host-and-isolation.md)。

## 5. 最容易低估的迁移成本

1. **传输和流控**：保留 sessionId、instanceId、generation、sequence、ACK、重连、缓冲上限和错误语义。Tauri/Wry 的普通事件回调不是 Electron MessagePort 的替身。高吞吐 PTY 不能每字符 JSON 往返；需要有界帧 / 通道，测试背压与退出。
2. **进程生命周期**：`utilityProcess.fork` 不能直接用普通 Node 启动替代；移除 `process.parentPort` 假设，保留心跳、预算、准入、取消、进程树退出核实和未确认资源的租约。窗口消失不等于 PTY / Agent 已退出。
3. **文件权威**：后续 Web 请求必须绑定窗口、项目打开代次和已授予 root；防 traversal / symlink race、过期请求、跨项目引用。当前只读 Rust 文件列表不是这套安全边界的完成证明。
4. **写入可靠性**：既有 Working Copy、冲突检测、保存 / flush / 关闭屏障不能退化为裸 `write`。
5. **Git 语义**：第一阶段可以让 Rust 调受控 Git CLI。不要仅因 Rust 可用 git2/gix 就同时换 Git 引擎；worktree、凭证、锁、日志 / journal、失败回滚和 Cloud 发布语义要独立验证。
6. **平台数据与发行**：新的凭证存储不能直接读取旧 safeStorage 密文；偏好和会话迁移要有可回滚格式。新 App ID / 数据目录、签名、macOS notarization、更新签名和 Stable feed 都是独立工程，不碰现有已发布更新契约。
7. **功能 / 性能分开验收**：Rust 不会自动优化仍保留的 CodeMirror、React transcript、PDF 或 Agent 内核。Rust 本身也没有防止 UI 线程阻塞的魔法。

## 6. 首轮纯外围像素与性能证据（历史阶段）

采用当前源码与运行界面的几何，不采用 README 中较旧的宣传截图。参考配置：Neutral、medium、居中项目名、文件侧栏、底部操作；原生截图用合成文件树，不保存用户真实文档。

本次已实现：标题栏和文件树的 Rust 绘制、原生点击 / 展开 / 收起、窗口拖动、侧栏开关 / 宽度调整、原生文件对话框和后台目录扫描、浅 / 深色、实验 Project Rail。

本次尚未通过：完整外围像素一致性、所有主题与布局配置、产品菜单 / 设置外观、原生窗口按钮、中文 / RTL / 输入法、拖放、无障碍、完整 Git / Cloud 视图。原型的设置 / 项目弹窗不是产品同款实现。

首轮 1280×800 深色基线，通道差值 >8 的像素占比：Header 0.839%、Explorer 4.217%、footer 2.670%；文字 / 图标前景差异约 52.1%、61.4%、44.9%。这些数据不是 M1 完整窗口的新验收结果。可重复比图方法见 [README](README.md#外围视觉回归)。尤其注意：

- 对比的是原 CSS 驱动的**静态合成 fixture**，不是完整 Electron React 产品运行态；fixture 标记本身仍需审查。
- 原子几何可以一致，文本抗锯齿 / 栅格化、字体 metric、裁切和 SVG 边缘仍可不同；前景误差不可用背景面积稀释。
- 8.9 MiB 二进制 / 约 105 MiB 空闲 RSS 只是纯外围实验；没有 Electron 同工作负载 A/B，也没有 p95 输入延迟和 GPU 帧时间结果。
- 验证 10 万行的仅可见行绘制、后台 I/O、空闲不持续 repaint，是性能纪律，不是完整产品性能承诺。

## 7. 下一阶段的顺序与退出条件

| 阶段 | 工作 | 进入下一阶段的条件 |
| --- | --- | --- |
| P0a 原生视觉 | 逐元素测量字体 / 图标 / 光栅，补菜单、设置、轨道和状态矩阵 | 固定截图基线，列出允许的跨引擎差异；由产品确认像素验收标准，不能默认为 98% 背景匹配 |
| P0b 混合宿主 | M1 已验证基础 Editor 单个 Web island；Right Sidebar 仍待接入 | IME、焦点、裁切、弹层、拖放、60/120Hz resize、中文 / Retina 通过；失败则改宿主 / UI 框架，不先大迁移 |
| P1 外围垂直切片 | 实际工作区 → Explorer → Editor 打开；窄 host port；保留 Electron adapter 对照 | 多根 / 多窗口 / 保存关闭 / 权限语义一致，可切回原入口 |
| P2 会话宿主 | Node sidecar 适配既有 Agent / PTY 内核，Rust 监督 | ACK / 输出压力 / 取消 / 崩溃 / 重连 / 进程退出、后台项目切换通过 |
| P3 系统与发布 | 账号、凭证、更新、数据迁移、所有平台 | 签名安装包、更新回滚和发布契约测试通过，独立 Internal 验证 |
| P4 逐步切换 | 同仓库共存，按已验收领域替换 | 产品等价且相同工作负载性能优于或不劣于 Electron，才考虑停旧入口 |

先安排一轮短期 P0 验证再估全量工期；未解决混合宿主、字体和完整菜单前，不建议给“几周完成重写”的承诺。性能基准必须包含空闲、10 万项目录、连续缩放、PTY 输出洪峰、流式 Chat、多项目后台会话和大型文档；统计启动、进程树 RSS、CPU、GPU、p95/p99 输入到呈现延迟。

## 来源

本地现行产品文档还核对了 `puppy-issues/document/puppyone-desktop/README.md`、`platform/cross-platform-runtime-and-delivery.md` 和上述 Right Sidebar 契约；未使用 `archive/legacy-desktop-docs/` 决定方向。

- 源码 provenance：`puppyone@0e88a283ae12571671fed0da24b6463f74578d73:electron/preload.cjs`、`electron/main/item-hosts/utility-host.mjs`、`src/features/desktop-terminal/runtime/terminalSessionBridge.ts`、`src/styles/tokens.css`、`src/styles/titlebar.css`、`src/features/data-workspace/browser.css`、`packages/shared-ui/src/styles/data-workspace.css`、`sub-themes/default-neutral/theme.css`。
- [eframe 官方说明](https://github.com/emilk/egui/tree/main/crates/eframe)：native / wgpu / winit。
- [Wry 官方说明及 child WebView 限制](https://github.com/tauri-apps/wry#child-webviews)：macOS / Windows / X11，Wayland 的 GTK 路径。
- [Tauri 概览](https://v2.tauri.app/start/)和 [sidecar](https://v2.tauri.app/develop/sidecar/)：说明 Rust 后端 + Web 前端与本次纯原生外围的差别，不是本原型依赖。
