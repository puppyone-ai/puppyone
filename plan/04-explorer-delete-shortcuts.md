# 04 · 左侧文件树删除快捷键实施计划

> **面向执行者：** 后续使用 `executing-plans` 技能逐任务实施；先读仓库 `AGENTS.md` 及 `src/shared-ui/AGENTS.md`。本文是待评审方案，当前仅新增此计划，未实现功能。

**目标：** 用户在左侧文件树选中文件或文件夹后，使用 `Delete`，或在 macOS 上使用 `Command + Backspace`，进入与右键删除相同的确认与删除流程。

**架构：** `ExplorerTree` 负责局部键盘事件、选中项和行焦点；Desktop 宿主负责平台配置、权限、确认、删除与错误反馈。把现有 `useDataNodeActions` 的删除流程抽成可供右键和快捷键共同调用的操作，继续使用 `DataPort.deleteNode`，不增加原生全局快捷键或新的文件系统通道。

**技术栈：** TypeScript、React 18、现有 DataPort/文档操作包装、Vitest、happy-dom、Electron 手工验收。组件测试沿用仓库的 React `createRoot` / `act` 与 `renderWithTestLocalization`，不新增测试库。

**日期：** 2026-11-05。

**调研基线：** 当前工作树 `codex/markdown-workspace-capabilities`，HEAD `e0c8e7105`；本地 `origin/qubits` 为 `c09df16024221884e5792034a15abf3f9172b324`。这是本地引用的状态，不代表已检查远端最新提交。上述两个版本中删除入口和文件树快捷键的相关实现一致；`DataWorkspace.tsx` 在当前任务上另有 6 行图片拖放相关差异，执行时必须保留并重新核对。

---

## 1. 直接回答：现在有这个快捷键吗？

**检查到的源码尚未为左侧文件树绑定删除快捷键。** 用户在编辑器里按删除键删除文字、图片等内容，是编辑器自己的键位，不能据此认为支持删除左侧文件。

现有实现：

| 位置 | 已有行为 | 对本需求的影响 |
|---|---|---|
| `src/shared-ui/data/ExplorerTree.tsx` → `handleClipboardShortcut` | 主修饰键 + C/X/V/D；另有方向键导航 | 可沿用文件树局部 `onKeyDown`，但没有 Delete / Backspace 分支 |
| 同文件 → `ExplorerTreeProps` | 有 `onCopyNodes`、`onCutNodes`、`onPasteNodes`、`onDuplicateNodes` | 缺少删除回调 |
| `src/features/data-workspace/nodeActions.tsx` → `DesktopNodeActionPopover` | 删除菜单项调用 `onDelete`，未显示快捷键 | 需要补可发现的键位提示 |
| `src/features/data-workspace/useDataNodeActions.ts` → `deleteNodeFromMenu` | `window.confirm`、批量删除、刷新、关闭相关资源、错误汇总 | 复用这条流程，不能另写快捷键专用删除逻辑 |
| `src/features/data-workspace/workbenchDataPort.ts` → `deleteNode` | 按 Resource URI 路由到 provider，拒绝删除项目根目录 | 保留多项目路由和根目录保护 |
| `electron/local-api/workspace.mjs` → `deleteWorkspaceEntry` | `fs.rm(targetPath, { recursive: true, force: false })` | 当前本地删除不是移到系统废纸篓，不能承诺可从废纸篓恢复 |

这份结论针对检查到的源码；未检查用户电脑中正在运行的安装包版本，也未通过真实按键验证该安装包。

## 2. 推荐交互

### 2.1 键位约定

| 场景 | 快捷键 | 行为 |
|---|---|---|
| macOS，文件树行有焦点且有有效选中项 | `⌘ + Backspace` | 出现现有删除确认提示 |
| macOS，外接键盘或其他方式产生 `event.key === "Delete"` | 无修饰键 `Delete` | 同上 |
| Windows / Linux，文件树行有焦点且有有效选中项 | 无修饰键 `Delete` | 同上 |
| 任意平台，无修饰键 `Backspace` | 不绑定文件删除 | 保留文字编辑及其他现有行为 |
| 任意平台，`Shift+Delete`、`Ctrl+Backspace`、`Alt+Delete` 等其他组合 | 不绑定文件删除 | 不引入第二套“强制删除”语义 |

键位判断依据 DOM `event.key`。macOS 上键帽写着 Delete 的退格键通常对应 `Backspace`，所以方案明确使用 `⌘ + Backspace`，不把键帽文字等同于 DOM 的 `Delete`。

删除仍需确认：单个项目显示名称，多选显示去重后的数量；取消不做任何写操作。删除文件夹沿用当前递归删除语义。本期不增加永久删除专用键、无确认删除、撤销、废纸篓或自定义键位设置。

### 2.2 焦点与选择规则

1. 必须由当前可见文件树中的数据行接收按键；不能通过 `window` / `document` 全局监听对左侧高亮项执行删除。
2. 选中内容来自受控 `selectedPaths` 和完整节点索引，不从当前虚拟窗口中的 DOM 行收集，不退回“当前编辑器文件”或仅 `activePath`。
3. 焦点所在数据行必须属于当前选中集合；焦点和选择尚未同步时忽略本次按键，不能删除上一轮选择。`DataWorkspace.activateNode` 中选择更新发生在异步导航被接受之后，这是必须覆盖的竞态。
4. 在本树行内点击后，应建立行焦点；方向键选择后也保留行焦点。输入框、重命名框、搜索、聊天输入、终端、编辑器正文、菜单按钮及尾部创建按钮均不触发文件删除。
5. Ctrl/Command 多选和 Shift 范围选择沿用现有模型；父文件夹及其后代同时选中时只提交父文件夹。
6. 项目根节点 `workspaceFolderRoot`、工作区根行和不存在的节点不能作为删除目标。如果选中集合包含受保护根节点，整次快捷键请求不执行，不悄悄只删除剩余子项；引导用户重新选择可删除的项目。
7. `defaultPrevented`、按键自动重复 `repeat`、输入法组合输入 `isComposing`、操作进行中、创建/重命名/菜单占用时均不启动新的删除。
8. 文件树被隐藏、侧栏折叠、项目切换或模态层打开后，旧选择不得响应按键；不能只依赖组件卸载，因为现有侧栏会保活挂载。

### 2.3 发现入口与操作结束

- macOS 右键删除菜单项右侧显示 `⌘⌫`；其他平台显示 `Delete`。菜单只显示平台主键位，macOS 的无修饰键 Delete 仍可用。
- 快捷键触发后直接进入确认，不先弹右键菜单，也不要求用户再次点菜单里的 Delete。
- 取消后尽量返回原行；成功后，在树刷新完成时将焦点放到原位置的下一条存活行，否则上一条。空树使用文件树容器作为可聚焦的回退目标。
- 焦点恢复只在本次操作仍属于同一工作区且焦点未被用户主动移到其他区域时进行；错误菜单或模态层已经取得焦点时不抢回。
- 快捷键失败时，复用现有节点操作菜单的错误展示，以触发时的行矩形为锚点。菜单只在失败时出现，允许重试；部分失败时重试集合仅包含真正删除失败的节点。

## 3. 方案比较

| 方案 | 优点 | 代价 | 结论 |
|---|---|---|---|
| **文件树局部按键 + 共享删除操作** | 和已有复制/剪切的作用范围一致；可复用确认、错误与 provider 边界 | 需补回调透传、焦点及无菜单入口 | **推荐** |
| 全局监听 Delete，再删除左侧高亮项 | 接线少 | 编辑器、输入框、终端和保活的隐藏树易相互干扰 | 不采用 |
| 快捷键先打开右键菜单，再触发现有菜单回调 | 改动表面较少 | React 状态未提交时读到旧菜单；界面闪现；依赖菜单状态 | 不采用 |

推荐方案不引入全应用命令注册中心，也不修改 Electron 的 Edit 菜单 accelerator。作用范围保持在文件树，避免扩大本次需求。

## 4. 接口与数据流

### 4.1 Shared UI 契约

在 `ExplorerTreeProps` 和 `DataWorkspaceProps` 中增加以下可选属性；宿主决定是否启用 macOS 组合键，Shared UI 不读取系统平台：

```ts
onDeleteNodes?: (nodes: DataNode[], anchorRect: DOMRect) => void | Promise<void>;
deleteWithMetaBackspace?: boolean; // 默认 false；Desktop macOS 传 true
```

`DataWorkspace` 仅在 `resolvedCapabilities.delete && dataPort.deleteNode` 且宿主提供回调时将其传给树。Desktop 再根据当前视图、可写状态、操作占用状态决定是否提供回调。`DataPort` 的方法存在性不是逐节点授权证明；底层 provider 的权限和根节点检查仍是最终边界。

在 `src/shared-ui/data/explorer/explorerDeleteShortcut.ts` 放纯键位判定，示意实现如下，可直接按此契约写测试：

```ts
type DeleteKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
};

export function isExplorerDeleteShortcut(
  event: DeleteKeyEvent,
  deleteWithMetaBackspace: boolean,
): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing) return false;
  if (event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (event.key === "Delete") return !event.metaKey;
  return deleteWithMetaBackspace && event.key === "Backspace" && event.metaKey;
}
```

React 调用侧显式从 `event.nativeEvent.isComposing` 构造输入。树内处理顺序为：确认事件来自当前可见的实际 `treeitem` → 排除编辑及按钮目标 → 判定键位 → 验证焦点行和选择 → 验证回调 → `preventDefault` / `stopPropagation` → 传入选中快照与行锚点。

事件目标检查需覆盖 `closest('input, textarea, select, [contenteditable], [role="textbox"]')` 的祖先语义，并拒绝行内交互控件。不要把现有仅检查直接 target 的 `isEditableEventTarget` 当作完整防护，也不要因此顺便改写所有现有快捷键逻辑。

### 4.2 宿主删除操作

`useDataNodeActions` 增加：

```ts
requestDeleteNodes: (nodes: readonly DataNode[], anchorRect: DOMRect) => Promise<void>;
isDeletingNodes: boolean;
```

保留 `deleteNodeFromMenu()` 对外签名，它从菜单取快照并委托共享执行函数。禁止使用以下方式复用：

```ts
// 错误：setState 后读取的仍可能是上一轮菜单。
setNodeActionMenu(newDraft);
await deleteNodeFromMenu();
```

共享执行函数接收明确的删除快照及来源，快照至少含工作区身份、DataPort、去重节点、锚点、必要的错误菜单草稿。构建草稿时复用当前 `getDesktopRenameDraft` / `rectToCreateEntryAnchor`，不要把“菜单必须已打开”变成前置条件。

执行顺序固定：

1. 校验 workspace、删除方法、根节点保护和菜单/创建状态，使用 `collapseNestedNodes` 固定本轮节点。
2. 获取同步 `useRef` 互斥锁，再设置 `isDeletingNodes`；锁必须早于确认提示和第一个 `await`。右键和快捷键共用此锁。
3. 使用现有 `workspace.node.confirmDeleteOne` / `confirmDeleteMany` 文案调用确认；取消后释放锁，不写文件。
4. 对快照中的路径逐一调用当前包装过的 `dataPort.deleteNode`，记录每个节点的实际删除结果。
5. 对成功删除的资源调用 `onResourceDeleted`，按现有契约关闭文档、清理选择并刷新工作区/Git 状态；使用现有 Resource URI 工具处理后代关系。
6. 删除失败汇总为现有 `delete-partial` / `operation-failed` 错误；快捷键来源只在失败时建立错误菜单，右键来源更新原菜单。
7. 在 `finally` 中释放锁；状态更新、错误展示及焦点恢复校验工作区代次及操作身份，不能覆盖用户后来打开的新菜单或新工作区。

**明确区分两类失败：** `deleteNode` 失败才属于可重试删除失败；文件已删除但 `onResourceDeleted` / 刷新失败属于后处理失败，不能把该文件重新放进删除重试集合。这一点应在抽取现有流程时修正并测试，避免再次删除一个已经不存在的路径。

共享 hook 的 `dataPort` 来自 `withEditorDocumentOperations(rawDataPort)`，继续保留文档会话操作边界。切换工作区时，已发出的旧 provider 请求不承诺可取消；新界面不能被它完成后的菜单、选择和焦点结果污染。

数据流：

```text
ExplorerTree 的行内 keydown
  → 键位 / 焦点 / 选择 / 可用性校验
  → DataWorkspace.onDeleteNodes
  → DesktopDataWorkspaceSurface.onDeleteNodes
  → useDataNodeActions.requestDeleteNodes(本轮快照)
  → 现有确认提示
  → 包装过的 DataPort.deleteNode
  → provider 删除 + 文档关闭 / 刷新 / 错误菜单
```

## 5. 实施任务

### Task 1：锁定键位与作用范围

**文件：**

- 新增：`src/shared-ui/data/explorer/explorerDeleteShortcut.ts`
- 新增：`tests/unit/workspace/explorer/explorerDeleteShortcut.test.ts`
- 新增：`tests/component/workspace/explorer/explorerDeleteShortcuts.test.tsx`
- 修改：`src/shared-ui/data/ExplorerTree.tsx`

步骤：

- [ ] 写纯函数测试：无修饰键 Delete；macOS Meta+Backspace；非 macOS Meta+Backspace 不命中；普通 Backspace、所有非约定修饰键、重复键、输入法及已处理事件不命中。
- [ ] 写真实 DOM 冒泡的组件测试：`row.focus()` 后派发可取消的 `KeyboardEvent`；断言回调节点及事件是否被消费。测试开始时运行应因缺少回调或功能失败。
- [ ] 按 4.1 增加纯函数、可选 props 和局部 handler，接入 `handleTreeKeyDown`，不注册全局监听。
- [ ] 增加行点击的确定性焦点处理，排除行内按钮；覆盖点击后立即按键、异步选择尚未提交、已拒绝的导航、多选行及受保护根节点。
- [ ] 验证 `renderListEnd` 创建按钮、输入框/可编辑后代、非选中行、空选中集合、无回调、隐藏树均不触发。
- [ ] 在现有虚拟树模型上处理删除后的焦点回退，不遍历/挂载完整树；删除导致行 index 改变时按资源身份定位，不能信任旧 DOM id。

运行：

```bash
npx vitest run tests/unit/workspace/explorer/explorerDeleteShortcut.test.ts tests/component/workspace/explorer/explorerDeleteShortcuts.test.tsx tests/component/workspace/explorer/explorerTreeSemantics.test.tsx
```

预期：新增目标用例先失败，实施后与已有树语义用例一起通过。

### Task 2：抽取共享删除操作

**文件：**

- 修改：`src/features/data-workspace/useDataNodeActions.ts`
- 新增：`tests/component/workspace/explorer/dataNodeDeletion.test.tsx`
- 复用：`src/features/data-workspace/fileClipboard.ts` 的 `collapseNestedNodes`

步骤：

- [ ] 用 React hook harness 和模拟 DataPort 写测试：直接删除入口无需先打开菜单；确认取消零写入；右键仍走相同逻辑。
- [ ] 覆盖父子选中去重、同名不同 URI、空选择、根节点、缺少 provider 能力、两次同帧触发和删除期间重复触发。
- [ ] 按 4.2 抽出快照驱动的共享执行函数，新增 `requestDeleteNodes` 与 `isDeletingNodes`；保留现有菜单回调签名。
- [ ] 用延迟 Promise 模拟部分成功、权限失败、资源已不存在和后处理失败；断言刷新、资源关闭、失败菜单及重试集合。
- [ ] 模拟删除期间切换 workspace / reset actions / 卸载；验证旧结果不覆盖新界面，互斥锁不会永久占用。

运行：

```bash
npx vitest run tests/component/workspace/explorer/dataNodeDeletion.test.tsx tests/unit/platform/clipboard/fileClipboard.test.ts
```

预期：右键与快捷键使用相同确认文案和实际删除通道；每个顶层路径每轮至多删除一次，只有实际删除失败的路径可重试。

### Task 3：贯通本地与 Cloud 文件树

**文件：**

- 修改：`src/shared-ui/data/DataWorkspace.tsx`（props、解构、能力门禁、树回调透传）
- 修改：`src/features/app-shell/DesktopDataWorkspaceSurface.tsx`（平台配置、视图/权限/忙碌门禁）
- 修改：`src/features/app-shell/DesktopWorkspaceContent.tsx`（props 及本地 surface 透传）
- 修改：`src/App.tsx`（接入 hook 输出并传入内容层）
- 修改：`src/features/cloud/workbench/DesktopCloudFileWorkspace.tsx`（接入同一 hook 输出）
- 按新增属性是否必填更新：`src/app/smoke/NativeCloudWorkbenchSmokeHarness.tsx` 及相关测试 fixture
- 新增：`tests/component/workspace/explorer/explorerDeleteBindings.test.tsx`
- 回归：`tests/component/workspace/explorer/multiRootExplorer.test.tsx`
- 回归：`tests/unit/workspace/files/multiRootResourceRouting.test.ts`

步骤：

- [ ] 为 `DataWorkspace` 添加能力允许/禁止且有/无 `deleteNode` 的绑定测试。
- [ ] Desktop 使用现有 `useDesktopPlatformCapabilities()` 的 `platform === "macos"` 配置 Meta+Backspace；平台未加载时不猜测 macOS，Delete 仍按规则可用。
- [ ] 新增宿主回调属性建议保持可选，使只读预览和 smoke fixture 默认不启用删除；可写产品路径必须显式接线并有测试，不能因可选属性而遗漏。
- [ ] `App → DesktopWorkspaceContent → DesktopDataWorkspaceSurface → DataWorkspace → ExplorerTree` 逐层接通；Cloud 通过 `actions.requestDeleteNodes` 接同一条 surface 路径。
- [ ] 根据 `isDeletingNodes`、创建/重命名/菜单状态、当前活动视图及隐藏/折叠状态禁用快捷键入口。provider 的可写策略沿用当前服务，不用笼统“Cloud 都可写”假设。
- [ ] 测试本地、可写 Cloud、只读 Cloud、无 delete capability、多根项目及后台保活树；不为 `ExplorerPinnedFiles` 单独扩展删除快捷键。

运行：

```bash
npx vitest run tests/component/workspace/explorer/explorerDeleteBindings.test.tsx tests/component/workspace/explorer/multiRootExplorer.test.tsx tests/unit/workspace/files/multiRootResourceRouting.test.ts
npx tsc --noEmit
npm run test:typecheck
```

预期：可写文件树能到达正确 provider；只读/隐藏路径无删除调用；类型检查不遗漏新增接口。

### Task 4：显示键位并完成交互回归

**文件：**

- 修改：`src/features/data-workspace/nodeActions.tsx`（实际动作列表 `DesktopNodeActionPopover` 内删除菜单项的 `shortcut`）
- 修改或扩展：`tests/component/workspace/explorer/explorerDeleteBindings.test.tsx`
- 回归：`tests/component/workspace/explorer/createEntryMenu.test.tsx`
- 回归：`tests/component/workspace/explorer/sidebarMenuHandoff.test.tsx`
- 回归：`tests/component/workspace/explorer/explorerPerformance.test.tsx`

步骤：

- [ ] 为 macOS 与 Windows/Linux 平台能力 mock 写菜单提示测试，再补 `shortcut`。显示值和 handler 使用同一平台语义，不能展示尚未启用的组合键。
- [ ] 复用现有 `workspace.node.*` 的确认、删除中与错误文案；只有确需新增用户文案才改 `locales/renderer/<实际语言>/*.json`，同步全部现有语言。
- [ ] 检查键盘导航、复制/剪切/粘贴/复制副本和菜单焦点交接没有回归；保留 100 行虚拟 DOM 上限。
- [ ] 使用临时测试项目执行下一节的真实 Electron 验收，测试数据不可选用用户实际工作文件。

运行：

```bash
npx vitest run tests/component/workspace/explorer
npm run check:shared-ui
npm run check:boundaries
npm run lint
```

预期：相关测试与架构、文案、lint 检查通过。若基线已有失败，记录实际命令和失败位置，区分是否由本任务引入；未解决前不得声称可发布。

### Task 5：同步权威文档并交付

**目标文档：** `puppy-issues/document/puppyone-desktop/workspace/explorer-tree-lifecycle.md`，在同一交付窗口补充键盘删除的作用域、键位、确认、根节点和失败处理契约。

- [ ] 先核对 canonical 仓库当前分支与 `AGENTS.md`；其本地工作副本也有未跟踪内容，不混入其他工作。
- [ ] 核对 `puppy-issues/document/product-philosophy.md` 的 Vocabulary 表。本次本地文档副本中未找到该文件，实施时须读取权威版本；不能靠改生成规则或 baseline 放行新词。
- [ ] 不沿用 canonical 文档里已过时的 `packages/shared-ui/...` 路径推断代码位置；本计划已按实际 `src/shared-ui/...` 定位。
- [ ] 计划文件是实施输入；正式行为契约在 canonical 文档更新，不新增仓库 `docs/`，不改冻结的 `archive/legacy-desktop-docs/`。
- [ ] 实施提交确定后，为 canonical 更新加 `puppyone-ai/puppyone@<完整提交>:src/shared-ui/data/ExplorerTree.tsx` 等实际来源链接；不得使用还不存在的提交号。
- [ ] 复核完整 diff、检查结果和 Git 状态，再按仓库约定集成；没有明确授权不推送、不改远端分支或发布版本。

## 6. 人工验收矩阵

以下是实施后的验收要求，当前均未执行：

| 操作 | 应看到的结果 |
|---|---|
| macOS 点击选中图片，按 `⌘+Backspace` | 一次确认提示；确认后从树移除且相应预览关闭 |
| 使用方向键选中文件夹，按 Delete，再取消 | 不发生删除，树与文件保持原状，行焦点可继续导航 |
| 单击文件后立刻按删除键，导航/读取故意延迟 | 只可删除已确认选中的目标；绝不删除先前高亮项 |
| 多选若干图片再删除 | 一次批量确认；数量正确；删除后焦点可继续操作 |
| 同时选择父文件夹和子文件 | 仅一次父目录删除，不重复提交后代 |
| 多根项目中选择内容相同但 URI 不同的两个文件 | 各自路由到对应项目，不因名称相同互相覆盖 |
| 选择项目根节点或根节点与子项的混合集合 | 不执行快捷键删除，不转成删除整个项目 |
| 左侧有高亮，实际焦点在 Markdown、聊天框、搜索框或终端 | 原区域处理键盘，不出现文件删除确认 |
| 重命名框内按 Backspace / `⌘+Backspace` | 只编辑名称，不删文件 |
| 长按 Delete，或删除耗时期间再次触发 | 只出现本轮确认/删除，不创建重复请求 |
| 一项成功、一项权限失败 | 成功项消失，展示失败信息，重试只包含失败项 |
| 文件已删除，但文档关闭/刷新回调报错 | 不把已删除路径再次送去删除；保留可见反馈 |
| 删除后切换项目或进入其他侧栏 | 旧操作不在新工作区弹菜单、清选择或抢焦点 |
| Windows/Linux 文件树按 Delete | 与 macOS 删除流程一致；普通 Backspace 无文件删除功能 |
| 删除最后一项，或删除虚拟窗口边缘的项 | 焦点有可用回退；不跳入编辑器触发下一次误操作 |

## 7. 实施顺序与范围

建议依次完成键位/焦点、共享删除、宿主接线、菜单提示及回归、canonical 文档更新。按职责保留少量可审查提交，例如 `feat(explorer): add scoped deletion shortcuts`、`refactor(workspace): share node deletion actions`；每次仅暂存明确路径。

正式实施是独立任务：从执行当时已核对的当前 `qubits` 建短分支，例如 `codex/explorer-delete-shortcuts`，需要时使用隔离 worktree；本次只向既有工作区能力计划集合新增本文，不切换或清理现有分支。不得在当前脏工作树上直接开始实现。

预估约 1–2 个开发日，主要不确定性是点击后的真实焦点行为、异步选择、文档删除后处理和保活 Cloud 视图，不是键位匹配本身。此估计用于排期，不能替代实际验证。

**完成标准：** 两个入口共用一套删除流程；约定键位在实际文件树焦点内可用；输入/编辑区域不会删文件；根节点受保护；取消、并发、部分失败与工作区切换有测试；相关检查通过且 canonical 文档已同步。

**本次计划交付状态：** 仅完成源码与现有文档调研、方案编写；未修改产品源码、未执行产品测试、未验证安装包按键、未提交/推送/合并，也未改 canonical 文档。
