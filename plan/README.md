# Markdown 工作区三项能力：规划索引

> 面向执行者：这三份文档是可落地实施计划，不是概念提案。每份都给出确切文件路径、函数签名、测试位置和任务顺序。按任务顺序执行，每一步都有可验证的产出。

**日期**：2026-11-05
**适用版本**：Desktop v0.4.1（`main` @ `c09df1602`）
**来源需求**：工作区 HTML 看板跳转 Markdown、Markdown 文内目录、拖拽图片入文

---

## 一、三份计划

| 文档 | 功能 | 工作量 | 风险 | 建议顺序 |
|---|---|---|---|---|
| [`01-outline.md`](./01-outline.md) | Markdown 文内目录（大纲） | 小 | 低 | **第 1 做** |
| [`02-image-drop.md`](./02-image-drop.md) | 文件树拖图片入文 | 中 | 中 | **第 2 做** |
| [`03-html-deeplink.md`](./03-html-deeplink.md) | HTML 看板 → Markdown 跳转 | 中 | 中高 | **第 3 做** |

排序理由：大纲改动完全在渲染层，零交互约定变更，能最快让用户看到效果；图片拖入改变了现有「拖文件 = 分屏」的判定，需要先建立新约定再改行为；HTML 深链需要在沙箱 iframe 与宿主之间开一条受控通道，安全面最大，放在最后做完整体验证。

---

## 二、调研结论：现状比预期更成熟

这一点直接影响三份计划的工作量估计，请先读完再排期。

### 1. 大纲功能已经存在，只是被关在实验开关后面

`src/shared-ui/editor/markdown/core/interaction/markdownHeadingOutline.ts`（502 行）已经实现了：

- 右侧刻度轨（`cm-md-heading-outline-rail` / `-ticks`）——就是需求截图里图 3 的形态；
- 悬停/聚焦弹出层（`cm-md-heading-outline-popover`）——就是图 4 的形态，且已按标题层级缩进（`--cm-md-heading-indent`，第 271 行）；
- 滚动联动当前标题（`is-active` / `aria-current="location"`）；
- 键盘导航（上下左右、Home、End、Escape）；
- 折叠代码围栏内的 `#` 不被误判为标题（`collectMarkdownHeadingOutlineEntries`）；
- 无障碍属性（`role="navigation"`、`aria-expanded`、`aria-controls`）。

限制条件只有四条：

1. 默认关闭 —— `src/preferences.ts:202` 的 `enableMarkdownHeadingOutline: false`，且在「实验性设置」里（`ExperimentalSettingsView.tsx:40`）；
2. 仅实时预览模式生效 —— `MarkdownCodeMirrorEditor.tsx:229` 切到源码模式时把该 compartment 清空；
3. 标题少于 3 个或文档不可滚动时不显示（`MIN_HEADING_COUNT = 3`）；
4. 只有一个右侧刻度轨，**没有常驻的侧边目录面板**。

所以 `01-outline.md` 的目标是「转正 + 补常驻面板」，不是从零实现。

### 2. 图片拖入的现有行为已经定位到确切代码

拖拽入口有两层：

- **文件树侧**：`src/shared-ui/data/ExplorerTree.tsx:398` `beginNodeDrag` 写入三种 payload，其中 `EXPLORER_REFERENCE_DRAG_TYPE`（`application/x-puppyone-workspace-entries+json`）是应用内结构化载荷，定义在 `src/shared-ui/data/explorer/explorerReferenceDrag.ts:4`。
- **编辑器面板侧**：`src/features/editor-workbench/layout/EditorPaneShell.tsx:108-111`，用 capture 阶段的 `onDragEnterCapture` / `onDragOverCapture` / `onDropCapture` 全部交给 `fileDrop` 控制器；该控制器定义在 `src/features/editor-workbench/drag-and-drop/useExplorerFileDrop.ts`。

「拖文件就分屏」的真正原因在 `useExplorerFileDrop.ts:184-200` 的 `drop`：它无条件调用 `closestPaneDropEdge(...)` 取最近的边缘，再用 `paneSplitDefinition(edge)` 得到分割方向，然后 `openRef.current(node, paneId, direction, placement)` 打开新面板。**它根本不看落点是否是编辑区内部**——只要落在面板任意位置，就会算出一个边缘然后分屏。

另有一个关键能力已经存在：`src/shared-ui/editor/resource/DocumentAssetImport.tsx` 提供 `importImage(documentPath, file)`，会校验文件头（PNG/JPEG/GIF/WebP）、限制 20MB、生成 `image-<uuid>.<ext>` 并导入到文档同目录，返回工作区路径。**图片落盘能力不需要新建**，缺的是「拖放时选择走这条路」。

### 3. HTML 预览已有完整的消息桥，深链可以复用

- HTML 页面跑在 `iframe` 里：`src/shared-ui/editor/viewers/html/HtmlPreviewFrame.tsx:69-79`。
- 默认 `htmlTrustMode="safe"`（`EditorPaneDocumentRuntime.tsx:153`、`DesktopDataWorkspaceSurface.tsx:373`、`FileModeApp.tsx:288` 三处都是 `safe`），对应 sandbox 为 `"allow-popups allow-popups-to-escape-sandbox"`，`script-src 'none'`，**页面里的 JS 根本不执行**。
- 但已经有一条**受控的 postMessage 通道**在跑：`htmlPageViewportScript`（`htmlPageViewport.ts`）注入一段固定脚本，向 `parent` 发 `{type:'puppyone-html-viewport', channel, x, y}`，宿主用 `event.source !== frame.contentWindow` 加 `channel` 随机 UUID 双重校验后才接收（`htmlPageViewport.ts:12-22`）。**这就是现成的范式**——只不过它只绑定了滚动位置。
- 「打开某个工作区文件」的能力也已存在：`src/shared-ui/editor/navigation/documentNavigation.ts` 的 `DocumentNavigationPort.openReference()`，宿主侧实现见 `src/shared-ui/data/DataWorkspace.tsx:987` 的 `createDocumentNavigationPort({ openWorkspaceCandidates, ... })`。

所以 `03-html-deeplink.md` 不是「发明一个协议」，而是**把视口通道的范式扩展成一条受白名单约束的导航通道**。

---

## 三、跨计划共享的约束（三份计划都必须遵守）

### 3.1 仓库架构门禁

改动完成后必须能过这些检查，它们是 CI 阻断项：

- `npm run check:markdown-architecture` —— 规则读自 `scripts/check-markdown-architecture.mjs` 与 `src/shared-ui/editor/markdown/README.md`。要点：`core/` 不得导入具体 feature；`shared/` 不得导入 `core/`、`features/`、`composition/`、`platform/`；`platform/` 不得导入具体 feature；旧扁平目录名（`adapters`、`decorations`、`state` 等）禁止出现。
- `npm run check:renderer-style-architecture` —— 样式文件的放置与命名规则。
- `npm run check:data-ui-boundaries` —— Shared UI 与 renderer 的边界。
- `npm run check:viewer-contract` —— viewer 注册契约。
- `npm run check:editor-document-session` —— 文档会话只能在宿主侧持久化，Markdown 代码不得直接调文件系统或 IPC。
- `npm run check:localization` —— 所有用户可见文案必须走 `locales/renderer/<lang>/*.json`，不得硬编码。
- `npm run check:boundaries` —— 上述全部的总和。

### 3.2 文案与词汇

用户可见文案以 `puppy-issues/document/product-philosophy.md` 的 Vocabulary 表为准，`npm run check:boundaries` 里的 `check-user-vocabulary.mjs` 会校验 `locales/renderer/**`。新增文案要同步全部语言目录（`en`、`zh-Hans`、`ja`、`ko`、`fr`、`de`、`es`、`pt-BR` 等，以 `locales/renderer/` 下实际存在的目录为准）。

### 3.3 测试放置

`tests/<layer>/<domain>/<capability>/` 结构，由 `scripts/check-test-layout.mjs` 强制。Markdown 相关单测放在 `tests/unit/editor/formats/markdown/<capability>/`，架构测试放在 `tests/architecture/editor/` 或 `tests/architecture/workbench/`。

### 3.4 Git 流程

遵循 `AGENTS.md`：从当前 `qubits` 拉 `codex/<task-name>` 短分支，只 `git add` 明确路径，不推送、不合并远程，除非用户明确授权。

---

## 四、执行顺序与依赖关系

```
01-outline (独立)
      │
      ▼
02-image-drop (独立，但与 01 共用 MarkdownCodeMirrorEditor 的 compartment 机制)
      │
      ▼
03-html-deeplink (依赖 01 的定位能力：跳转后需要能滚到标题)
```

三份计划之间只有一处硬依赖：`03` 的「跳转到指定标题」如果要做，最好复用 `01` 里抽出的滚动定位函数。其余互不影响，可以并行开发，但建议按 01 → 02 → 03 依次集成，每次集成后跑一遍 `npm run check:shared-ui`。

---

## 五、验收口径

三个功能都做完后，下面这些必须同时成立：

1. 打开一个含 5 个以上标题的 Markdown，右侧出现常驻目录面板，点击条目能精确滚动到标题，滚动时当前条目高亮跟随。
2. 从左侧文件树把一张 PNG 拖到 Markdown 编辑区**中部**，插入 `![](image-<uuid>.png)` 且图片立即可见；拖到面板**边缘**仍然是分屏预览（原行为保留）。
3. 打开一个工作区里的 HTML 看板，点击卡片上的「打开」按钮，应用切换到对应 `.md` 文件；HTML 里的任意其他跳转（外链、`file://`、`javascript:`）一律被拒绝。

---

## 六、追加计划：块级图片的拖拽手柄对齐

[`05-image-block-handle.md`](./05-image-block-handle.md) —— 实时预览里「整行只有一张图片」时，6 点拖拽手柄悬在图片上方一行，看起来像一条空文本行的项目符号。实测根因：块级图片控件在 CodeMirror 的 `.cm-line` 里用了 `display: flex`，浏览器把这一行拆成「空首行 + 图片 + 空尾行」，手柄锚定的正是那条空首行。改成 `inline-flex` 后上下各多出的约 26px 空行消失。

与上面三份计划互不依赖，可独立执行。工作量小，风险低。

## 七、追加计划：滚到文末图片时向上反弹

[`06-scroll-bounce.md`](./06-scroll-bounce.md) —— 阅读以连续大图结尾的笔记（如 `[H LNote]/[随笔]/20230506 观《这么多年》.md`）时，快滚到最后一张图片会向上弹一下。实测根因：图片是行内 widget 且未声明 `estimatedHeight`，离开视口后高度从约 1090px 退回一行（30px）或占位高度（100px），文档总高度单帧缩水 990px，实测最大回退 184px。对照实验证明高度稳定后反弹完全消失。

与 `05` 是同一族问题的两面（行盒几何 / 视口外几何），建议一并排期。工作量中等，风险中低。
