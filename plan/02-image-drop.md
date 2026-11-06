# 02 · 拖拽图片入文（Markdown 图文混排）实施计划

> **面向执行者：** 用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 逐任务执行。步骤用 `- [ ]` 勾选跟踪。

**目标：** 从左侧文件树或系统访达（Finder）把图片拖到 Markdown 编辑区内部时，在落点处插入 `![alt](相对路径)`，图片立即可见；拖到面板边缘时仍是原有的分屏预览。

**架构：** 现有 `useExplorerFileDrop` 对任何落点都算一个「最近边缘」然后分屏。本计划在它前面插一层**落点区域判定**：只有指针落在边缘带才走分屏，落在中间区域且命中一个「文档投放目标」时，把载荷交给该目标自己处理。投放目标由 Markdown 编辑器通过一个 React 上下文注册，与现有 `useRegisterEditorFindAdapter` 的注册范式一致。图片落盘复用已有的 `useDocumentAssetImport().importImage()`，不新建文件写入链路。

**技术栈：** TypeScript、React 18、CodeMirror 6、Vitest、`@testing-library/react`。

**规格来源：** `plan/README.md` 第二、三节。

---

## 全局约束

- **不改变非图片文件的拖拽行为。** 拖 `.pdf`、`.csv`、`.md` 到编辑区中部，仍然是分屏打开。
- **不改变边缘分屏行为。** 边缘带的几何定义与阈值由 Task 1 固定，其他任务不得各自实现一套。
- 读取系统文件必须走已有的 `importImage` 端口，**禁止**在 renderer 里直接读 `file.path`、拼 `file://` 或调用 `fs`。
- 插入的 Markdown 必须是**文档相对路径**，不是工作区绝对路径，也不是 `puppyone-local://` URL。
- 所有用户可见文案走 `locales/renderer/<lang>/*.json`。
- 改动后必须通过：`npm run check:workbench-architecture`、`npm run check:editor-document-session`、`npm run check:markdown-architecture`、`npm run check:renderer-style-architecture`。
- 测试落在 `tests/unit/editor/formats/markdown/<capability>/` 或 `tests/component/editor/workbench/<capability>/`，由 `scripts/check-test-layout.mjs` 校验。

## 审查重点

下面几类输入最可能咬人，逐条在对应任务里补测试：

1. **文件名含空格或括号** —— `my photo (1).png` 插入后必须是 `![alt](<my photo (1).png>)` 形式，否则 Markdown 解析会断在空格或 `)` 上。
2. **文件名含 `#` 或 `?`** —— 在 Markdown 目标里会被当成 fragment/query，必须百分号编码。
3. **目标与文档在同一目录** —— 应插入 `image.png`，不是 `./image.png`，也不是空串。
4. **目标在文档的父目录** —— 应插入 `../assets/image.png`。
5. **落点在行内文字中间** —— 插入后不能把原行拆坏：图片语法插入在落点处，且前后不吞掉原有空格。
6. **只读文档或非 Markdown 文档** —— 不注册投放目标，拖拽回落到原有分屏行为。
7. **图片体积超过 20MB 或不是 PNG/JPEG/GIF/WebP** —— `importImage` 会抛错，界面必须给出可读提示且不插入任何文本。

---

### Task 1：落点区域几何（纯函数）

**Files:**
- Create: `src/features/editor-workbench/drag-and-drop/paneDropRegion.ts`
- Test: `tests/unit/workbench/editor/paneDrop/paneDropRegion.test.ts`

**Interfaces:**
- Produces:
  - `export const PANE_DROP_EDGE_RATIO = 0.3`
  - `export const PANE_DROP_EDGE_MIN_PX = 48`
  - `export const PANE_DROP_EDGE_MAX_PX = 120`
  - `export type PaneDropRegion = "edge" | "center"`
  - `export function resolvePaneDropRegion(rect: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">, x: number, y: number): PaneDropRegion`

判定规则（写死在函数里，测试锁定）：
- 边缘带宽 `band = clamp(min(width, height) * PANE_DROP_EDGE_RATIO, PANE_DROP_EDGE_MIN_PX, PANE_DROP_EDGE_MAX_PX)`。
- 指针到四边的最小距离 `< band` → `"edge"`，否则 `"center"`。

- [ ] **Step 1: 写失败的测试**

```ts
// tests/unit/workbench/editor/paneDrop/paneDropRegion.test.ts
import { describe, expect, it } from "vitest";
import { resolvePaneDropRegion } from "../../../../../src/features/editor-workbench/drag-and-drop/paneDropRegion";

const rect = { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 };

describe("resolvePaneDropRegion", () => {
  it("classifies the four borders as edge", () => {
    expect(resolvePaneDropRegion(rect, 10, 400)).toBe("edge");
    expect(resolvePaneDropRegion(rect, 990, 400)).toBe("edge");
    expect(resolvePaneDropRegion(rect, 500, 5)).toBe("edge");
    expect(resolvePaneDropRegion(rect, 500, 795)).toBe("edge");
  });

  it("classifies the middle as center", () => {
    expect(resolvePaneDropRegion(rect, 500, 400)).toBe("center");
    expect(resolvePaneDropRegion(rect, 200, 200)).toBe("center");
  });

  it("keeps a usable center in a narrow pane", () => {
    const narrow = { left: 0, top: 0, right: 240, bottom: 800, width: 240, height: 800 };
    expect(resolvePaneDropRegion(narrow, 120, 400)).toBe("center");
    expect(resolvePaneDropRegion(narrow, 10, 400)).toBe("edge");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/workbench/editor/paneDrop/paneDropRegion.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

三个常量 + 一个纯函数，实现要点：先算 `band`，再取 `Math.min(x - left, right - x, y - top, bottom - y)`，小于 `band` 即 `"edge"`。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/workbench/editor/paneDrop/paneDropRegion.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/features/editor-workbench/drag-and-drop/paneDropRegion.ts \
        tests/unit/workbench/editor/paneDrop/paneDropRegion.test.ts
git commit -m "feat(workbench): define the pane drop edge and center regions"
```

---

### Task 2：文档投放目标注册端口

**Files:**
- Create: `src/shared-ui/editor/resource/DocumentDropTarget.tsx`
- Export from `src/shared-ui/index.ts`
- Test: `tests/unit/editor/formats/markdown/drop/documentDropTarget.test.ts`

**Interfaces:**
- Produces:
  - `export type DocumentDropPayload = Readonly<{ kind: "workspace-entry"; path: string; name: string }> | Readonly<{ kind: "file"; file: File }>`
  - `export type DocumentDropTargetRegistration = Readonly<{ containsPoint(clientX: number, clientY: number): boolean; insert(payload: DocumentDropPayload): Promise<boolean>; }>`
  - `export function DocumentDropTargetProvider(props: { registry: DocumentDropRegistry; children: ReactNode }): JSX.Element`
  - `export function useRegisterDocumentDropTarget(registration: DocumentDropTargetRegistration | null): void`
  - `export type DocumentDropRegistry = Readonly<{ install(registration: DocumentDropTargetRegistration): () => void; find(clientX: number, clientY: number): DocumentDropTargetRegistration | null; }>`
  - `export function createDocumentDropRegistry(): DocumentDropRegistry`

`find` 的语义：按注册顺序**倒序**查找，第一个 `containsPoint` 返回 `true` 的即胜出。这样后挂载的（当前活动面板内的编辑器）优先。

- [ ] **Step 1: 写失败的测试**

```ts
// tests/unit/editor/formats/markdown/drop/documentDropTarget.test.ts
import { describe, expect, it, vi } from "vitest";
import { createDocumentDropRegistry } from "../../../../../../src/shared-ui/editor/resource/DocumentDropTarget";

const target = (accepts: boolean) => ({
  containsPoint: () => accepts,
  insert: vi.fn(async () => true),
});

describe("createDocumentDropRegistry", () => {
  it("returns null when nothing is registered", () => {
    expect(createDocumentDropRegistry().find(10, 10)).toBeNull();
  });

  it("prefers the most recently installed accepting target", () => {
    const registry = createDocumentDropRegistry();
    const first = target(true);
    const second = target(true);
    registry.install(first);
    registry.install(second);
    expect(registry.find(10, 10)).toBe(second);
  });

  it("skips a registered target that does not contain the point", () => {
    const registry = createDocumentDropRegistry();
    registry.install(target(false));
    expect(registry.find(10, 10)).toBeNull();
  });

  it("stops routing to a target after it uninstalls", () => {
    const registry = createDocumentDropRegistry();
    const dispose = registry.install(target(true));
    dispose();
    expect(registry.find(10, 10)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/editor/formats/markdown/drop/documentDropTarget.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`createDocumentDropRegistry` 内部用 `Map<symbol, DocumentDropTargetRegistration>` 保持插入序（Map 迭代序即插入序），`find` 时 `[...entries].reverse()` 遍历。`install` 返回的函数删除自己的 key（幂等）。

React 侧：`DocumentDropTargetProvider` 只管把 registry 放进 context；`useRegisterDocumentDropTarget` 在 `useEffect` 里 `install`，清理函数里 dispose，并把 `registration` 存进 ref 以免每次 render 重装。

**注意**：这个文件放在 `editor/resource/`，与已有的 `DocumentAssetImport.tsx` 同目录。`shared-ui/editor/` 不属于 markdown 子树的强约束范围，不受 `check-markdown-architecture` 的 core/features 规则限制，但仍需在 `src/shared-ui/index.ts` 里按现有分组位置导出。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/editor/formats/markdown/drop/documentDropTarget.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/shared-ui/editor/resource/DocumentDropTarget.tsx src/shared-ui/index.ts \
        tests/unit/editor/formats/markdown/drop/documentDropTarget.test.ts
git commit -m "feat(editor): add a document drop target registry"
```

---

### Task 3：Markdown 图片语法构造与相对路径

**Files:**
- Create: `src/shared-ui/editor/markdown/features/image/markdownImageDropSyntax.ts`
- Test: `tests/unit/editor/formats/markdown/drop/markdownImageDropSyntax.test.ts`

**Interfaces:**
- Consumes: 无外部依赖，纯字符串运算。
- Produces:
  - `export function relativeMarkdownDestination(documentPath: string, targetPath: string): string | null`
  - `export function escapeMarkdownDestination(destination: string): string`
  - `export function buildMarkdownImageSnippet(destination: string, alt: string): string`
  - `export function isDropImageName(name: string): boolean`

规则：
- `relativeMarkdownDestination("notes/a.md", "assets/p.png")` → `"../assets/p.png"`；同目录 → `"p.png"`。
- 返回 `null` 当两者不在同一工作区根（例如任一以 `/` 开头且另一不同源），调用方据此放弃插入。
- `escapeMarkdownDestination`：目标含空格或 `(` `)` 时整体用 `<...>` 包裹；含 `#` 或 `?` 时对这两个字符做 `%23` / `%3F`；`(` `)` 在尖括号内不需要转义。反斜杠统一转 `/`。
- `buildMarkdownImageSnippet("p.png", "p")` → `"![p](p.png)"`。
- `isDropImageName`：扩展名白名单 `png jpg jpeg gif webp svg avif bmp`，大小写不敏感。**注意** `svg` 只允许作为已有工作区文件引用（内部拖拽），不允许从系统导入——这一点由 Task 5 在调用 `importImage` 前拦截，因为 `importImage` 本身只认 PNG/JPEG/GIF/WebP。

- [ ] **Step 1: 写失败的测试**

```ts
// tests/unit/editor/formats/markdown/drop/markdownImageDropSyntax.test.ts
import { describe, expect, it } from "vitest";
import {
  buildMarkdownImageSnippet,
  escapeMarkdownDestination,
  isDropImageName,
  relativeMarkdownDestination,
} from "../../../../../../src/shared-ui/editor/markdown/features/image/markdownImageDropSyntax";

describe("relativeMarkdownDestination", () => {
  it("returns a bare name for a sibling file", () => {
    expect(relativeMarkdownDestination("notes/a.md", "notes/p.png")).toBe("p.png");
  });
  it("climbs to a parent directory", () => {
    expect(relativeMarkdownDestination("notes/a.md", "assets/p.png")).toBe("../assets/p.png");
  });
  it("descends into a subdirectory", () => {
    expect(relativeMarkdownDestination("a.md", "img/p.png")).toBe("img/p.png");
  });
  it("returns null for a path outside the root", () => {
    expect(relativeMarkdownDestination("a.md", "../escape.png")).toBeNull();
  });
});

describe("escapeMarkdownDestination", () => {
  it("wraps destinations with spaces in angle brackets", () => {
    expect(escapeMarkdownDestination("my photo.png")).toBe("<my photo.png>");
  });
  it("wraps destinations with parentheses in angle brackets", () => {
    expect(escapeMarkdownDestination("a (1).png")).toBe("<a (1).png>");
  });
  it("percent-encodes fragment and query characters", () => {
    expect(escapeMarkdownDestination("a#b.png")).toBe("a%23b.png");
    expect(escapeMarkdownDestination("a?b.png")).toBe("a%3Fb.png");
  });
});

describe("buildMarkdownImageSnippet", () => {
  it("builds a standard image snippet", () => {
    expect(buildMarkdownImageSnippet("p.png", "p")).toBe("![p](p.png)");
  });
  it("drops whitespace from alt text", () => {
    expect(buildMarkdownImageSnippet("p.png", "my  photo\n")).toBe("![my photo](p.png)");
  });
});

describe("isDropImageName", () => {
  it("accepts common image extensions case-insensitively", () => {
    expect(isDropImageName("a.PNG")).toBe(true);
    expect(isDropImageName("a.webp")).toBe(true);
  });
  it("rejects non-images", () => {
    expect(isDropImageName("a.md")).toBe(false);
    expect(isDropImageName("a.pdf")).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/editor/formats/markdown/drop/markdownImageDropSyntax.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

纯函数，不导入 `path`（renderer 里没有 Node 的 `path`）。按 `/` 切分、逐段比对。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/editor/formats/markdown/drop/markdownImageDropSyntax.test.ts`
Expected: PASS（4 组共 12 个断言）。

- [ ] **Step 5: 提交**

```bash
git add src/shared-ui/editor/markdown/features/image/markdownImageDropSyntax.ts \
        tests/unit/editor/formats/markdown/drop/markdownImageDropSyntax.test.ts
git commit -m "feat(markdown): build document-relative image snippets for drops"
```

---

### Task 4：在 Markdown 编辑器里注册投放目标并插入

**Files:**
- Modify: `src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor.tsx`
- Test: `tests/component/editor/formats/markdown/drop/markdownImageDropInsert.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `useRegisterDocumentDropTarget`、Task 3 的 `buildMarkdownImageSnippet` / `relativeMarkdownDestination` / `isDropImageName`，以及现有的 `useDocumentAssetImport()`。
- Produces:
  - `export function insertMarkdownImageAt(view: EditorView, position: number, snippet: string): void`（内部函数，供测试直接调用）

插入算法（写死在实现里）：
1. `position` 由 `view.posAtCoords({ x, y })` 给出；为 `null` 时退到当前选区 `view.state.selection.main.from`。
2. 判断插入点前后字符：若前一个字符不是换行且不是空格，前置一个空格；若后一个字符不是换行且不是空格，后置一个空格。这样不会把 `这是一句话` 从中间粘成 `这是一句![…](…)话`。
3. `view.dispatch({ changes: { from: position, insert: snippet }, selection: { anchor: position + snippet.length }, userEvent: "input.drop" })`。

注册时机：仅当 `!readOnly && documentPath` 时注册。`containsPoint` 用 `view.contentDOM.getBoundingClientRect()` 命中测试——注意是 `contentDOM` 而不是整个编辑器 DOM，这样落在工具栏或滚动条上不会误判为可插入。

`insert(payload)` 流程：
- `payload.kind === "workspace-entry"`：若 `!isDropImageName(name)` 返回 `false`（交回上层走分屏）；否则算相对路径，插入。
- `payload.kind === "file"`：若 `!isDropImageName(file.name)` 返回 `false`；否则 `await assets.importImage(documentPath, file)` 拿到 `{ path }`，再算相对路径并插入。`importImage` 抛错时向上抛，由调用方显示提示。
- `assets` 为 `null`（未挂 `DocumentAssetImportBoundary`）时，`file` 分支返回 `false`，让上层回落到分屏。

- [ ] **Step 1: 写失败的插入测试**

```tsx
// tests/component/editor/formats/markdown/drop/markdownImageDropInsert.test.tsx
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { insertMarkdownImageAt } from "../../../../../../src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor";

function viewOf(doc: string) {
  const parent = document.createElement("div");
  document.body.append(parent);
  return new EditorView({ state: EditorState.create({ doc }), parent });
}

describe("insertMarkdownImageAt", () => {
  it("inserts on an empty line without extra padding", () => {
    const view = viewOf("");
    insertMarkdownImageAt(view, 0, "![a](a.png)");
    expect(view.state.doc.toString()).toBe("![a](a.png)");
  });

  it("pads when inserted mid-word", () => {
    const view = viewOf("这是一句话");
    insertMarkdownImageAt(view, 4, "![a](a.png)");
    expect(view.state.doc.toString()).toBe("这是一句 ![a](a.png) 话");
  });

  it("does not add a leading space at the start of a line", () => {
    const view = viewOf("句子");
    insertMarkdownImageAt(view, 0, "![a](a.png)");
    expect(view.state.doc.toString()).toBe("![a](a.png)句子");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/component/editor/formats/markdown/drop/markdownImageDropInsert.test.tsx`
Expected: FAIL —— `insertMarkdownImageAt` 未导出。

- [ ] **Step 3: 实现插入函数**

按上述三步算法实现，导出该函数（导出仅为可测；它不接受任何外部状态）。

- [ ] **Step 4: 运行确认插入通过**

Run: `npx vitest run tests/component/editor/formats/markdown/drop/markdownImageDropInsert.test.tsx`
Expected: PASS。

- [ ] **Step 5: 实现注册**

在 `MarkdownCodeMirrorEditor` 里：

```tsx
const assets = useDocumentAssetImport();
const dropRegistration = useMemo<DocumentDropTargetRegistration | null>(() => {
  if (readOnly || !documentPath) return null;
  return {
    containsPoint(x, y) {
      const view = viewRef.current;
      if (!view) return false;
      const rect = view.contentDOM.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    },
    async insert(payload) {
      const view = viewRef.current;
      if (!view) return false;
      let targetPath: string;
      let name: string;
      if (payload.kind === "workspace-entry") {
        if (!isDropImageName(payload.name)) return false;
        targetPath = payload.path;
        name = payload.name;
      } else {
        if (!isDropImageName(payload.file.name) || !assets) return false;
        const imported = await assets.importImage(documentPath, payload.file);
        targetPath = imported.path;
        name = payload.file.name;
      }
      const destination = relativeMarkdownDestination(documentPath, targetPath);
      if (!destination) return false;
      const snippet = buildMarkdownImageSnippet(
        escapeMarkdownDestination(destination),
        name.replace(/\.[^.]+$/, ""),
      );
      const coords = lastDropPointRef.current;
      const position = coords ? view.posAtCoords(coords) : null;
      insertMarkdownImageAt(view, position ?? view.state.selection.main.from, snippet);
      return true;
    },
  };
}, [assets, documentPath, readOnly]);
useRegisterDocumentDropTarget(dropRegistration);
```

`lastDropPointRef` 由 `MarkdownCodeMirrorEditor` 通过 `EditorView.domEventHandlers({ dragover(event) { lastDropPointRef.current = { x: event.clientX, y: event.clientY }; return false; } })` 持续更新，**不拦截事件**（返回 `false`），只记坐标。这条 handler 加进 `markdownCodeMirrorUrgentExtensions` 之外的新 compartment，随编辑器一起创建。

- [ ] **Step 6: 运行确认整体通过**

Run: `npx vitest run tests/component/editor/formats/markdown/drop/`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor.tsx \
        tests/component/editor/formats/markdown/drop/markdownImageDropInsert.test.tsx
git commit -m "feat(markdown): accept image drops and insert image syntax"
```

---

### Task 5：让面板拖拽控制器先问投放目标

**Files:**
- Modify: `src/features/editor-workbench/drag-and-drop/useExplorerFileDrop.ts`
- Modify: `src/features/editor-workbench/layout/DesktopEditorSplitView.tsx`
- Modify: `src/features/editor-workbench/layout/EditorPaneShell.tsx`
- Modify: `src/features/editor-workbench/runtime/EditorPaneDocumentRuntime.tsx`（把 `DocumentDropTargetProvider` 放到 `FilePreview` 外层）
- Test: `tests/unit/workbench/editor/paneDrop/explorerFileDropRouting.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `resolvePaneDropRegion`，Task 2 的 `DocumentDropRegistry` / `DocumentDropPayload`。
- Produces:
  - `useExplorerFileDrop(workspaceId, onOpenAtPaneEdge, target, options: { registry?: DocumentDropRegistry | null })`
  - `export function shouldRouteToDocumentDrop(input: { region: PaneDropRegion; payloadName: string; hasTarget: boolean }): boolean`（纯函数，便于测）

`shouldRouteToDocumentDrop` 规则：`region === "center" && hasTarget && isDropImageName(payloadName)` 时为 `true`。

`over()` 改动：
- 先算 `region = resolvePaneDropRegion(event.currentTarget.getBoundingClientRect(), x, y)`。
- 若 `region === "center"` 且 `registry.find(x, y)` 命中且载荷是图片，则 `event.preventDefault(); event.dataTransfer.dropEffect = "copy";` **不** `setPreview`（不显示分屏预览），直接返回。
- 否则走原逻辑。

`drop()` 改动：
- 同样的判定，命中则 `event.preventDefault(); event.stopPropagation();` 构造 `DocumentDropPayload` 调 `target.insert(payload)`；`Promise` 失败时 `setDropFailed(true)`。
- 未命中则完全走原逻辑（边缘分屏）。

**载荷转换**：内部拖拽已有 `classifyReferenceDataTransfer(event.dataTransfer)` 得到 `{ entries: [{ path, name, entryType }] }`；取 `entries[0]`，`entryType === "file"` 才转成 `{ kind: "workspace-entry", path, name }`。系统拖拽用 `event.dataTransfer.files[0]` 转成 `{ kind: "file", file }`。

**Provider 位置**：`DocumentDropTargetProvider` 需要包住渲染 Markdown 编辑器的子树，同时 registry 实例要能被 `DesktopEditorSplitView` 里的 `useExplorerFileDrop` 拿到。做法：在 `DesktopEditorSplitView` 里 `const dropRegistry = useMemo(() => createDocumentDropRegistry(), [])`，一处传给 `useExplorerFileDrop`，一处包在 `<EditorLayoutNode>` 外层的 `DocumentDropTargetProvider` 上。

- [ ] **Step 1: 写失败的测试**

```ts
// tests/unit/workbench/editor/paneDrop/explorerFileDropRouting.test.ts
import { describe, expect, it } from "vitest";
import { shouldRouteToDocumentDrop } from "../../../../../src/features/editor-workbench/drag-and-drop/useExplorerFileDrop";

describe("shouldRouteToDocumentDrop", () => {
  it("routes an image dropped in the center onto a target", () => {
    expect(shouldRouteToDocumentDrop({ region: "center", payloadName: "a.png", hasTarget: true })).toBe(true);
  });
  it("keeps split behaviour for the edge", () => {
    expect(shouldRouteToDocumentDrop({ region: "edge", payloadName: "a.png", hasTarget: true })).toBe(false);
  });
  it("keeps split behaviour without a target", () => {
    expect(shouldRouteToDocumentDrop({ region: "center", payloadName: "a.png", hasTarget: false })).toBe(false);
  });
  it("keeps split behaviour for non-images", () => {
    expect(shouldRouteToDocumentDrop({ region: "center", payloadName: "a.pdf", hasTarget: true })).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/workbench/editor/paneDrop/explorerFileDropRouting.test.ts`
Expected: FAIL —— 函数未导出。

- [ ] **Step 3: 实现路由与接线**

按上述 `over()` / `drop()` 改动实现，`shouldRouteToDocumentDrop` 作为导出的纯函数被两处共用。注意 `drop()` 里原有的 `finishFileDrag("drop")` 仍要在两条分支上都调用，否则拖拽会话泄漏。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/workbench/editor/paneDrop/`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/features/editor-workbench/drag-and-drop/useExplorerFileDrop.ts \
        src/features/editor-workbench/layout/DesktopEditorSplitView.tsx \
        src/features/editor-workbench/layout/EditorPaneShell.tsx \
        src/features/editor-workbench/runtime/EditorPaneDocumentRuntime.tsx \
        tests/unit/workbench/editor/paneDrop/explorerFileDropRouting.test.ts
git commit -m "feat(workbench): route image drops into the active markdown editor"
```

---

### Task 6：插入态的视觉反馈

**Files:**
- Modify: `src/features/editor-workbench/layout/desktop-editor-split-view.css`
- Modify: `src/features/editor-workbench/layout/EditorPaneShell.tsx`（新增 `data-drop-kind="insert"` 分支）
- Modify: `src/features/editor-workbench/drag-and-drop/useExplorerFileDrop.ts`（暴露 `insertIntent: boolean`）
- Test: `tests/component/editor/workbench/paneDrop/dropAffordance.test.tsx`

**Interfaces:**
- `EditorFileDropController` 新增字段：`insertIntent: boolean` —— 当最近一次 `over()` 命中文档投放目标时为 `true`。

视觉约定：
- `insertIntent` 为 `true` 时，`.desktop-editor-pane-content` 内部出现一圈 2px 的 `--po-accent` 内描边（`box-shadow: inset 0 0 0 2px`），并且**不**渲染 `.desktop-editor-drop-preview`（那个是分屏预览用的半透明块）。
- 边缘态保持原样。

理由：用户必须能一眼看出「这次松手是插图，不是分屏」。没有这个反馈，两个行为并存会让人不敢拖。

- [ ] **Step 1: 写失败的测试**

断言：当控制器 `insertIntent` 为 `true` 时，面板根节点带 `data-drop-kind="insert"`，且容器里没有 `.desktop-editor-drop-preview`。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/component/editor/workbench/paneDrop/dropAffordance.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现**

`EditorPaneShell` 里把 `data-drop-kind` 的三态改为 `"file" | "pane" | "insert"`，`dropEdge && fileDropEdge` 时才渲染 drop preview。

- [ ] **Step 4: 运行确认通过并校验样式架构**

Run: `npx vitest run tests/component/editor/workbench/paneDrop/dropAffordance.test.tsx && npm run check:renderer-style-architecture`
Expected: 均通过。

- [ ] **Step 5: 提交**

```bash
git add src/features/editor-workbench/layout/desktop-editor-split-view.css \
        src/features/editor-workbench/layout/EditorPaneShell.tsx \
        src/features/editor-workbench/drag-and-drop/useExplorerFileDrop.ts \
        tests/component/editor/workbench/paneDrop/dropAffordance.test.tsx
git commit -m "feat(workbench): distinguish insert drops from split drops"
```

---

### Task 7：失败提示与整体验证

**Files:**
- Modify: `locales/renderer/*/workspace.json`（或现有 drop 文案所在命名空间）
- Modify: `src/features/editor-workbench/layout/DesktopEditorSplitView.tsx`
- Test: 无新增单测；以手工验收为主

**文案要求**：`fileDrop.dropFailed` 现有提示是通用的「导出失败」，图片导入失败需要更具体的措辞，例如「无法插入这张图片，支持 PNG、JPEG、GIF、WebP，单张不超过 20 MB」。全部语言目录同步。

- [ ] **Step 1: 区分两种失败**

`useExplorerFileDrop` 的 `dropFailed` 改为 `dropFailure: "export" | "image" | null`。`insert()` 抛错时置 `"image"`，原有 export 失败置 `"export"`。渲染处按值选文案。

- [ ] **Step 2: 跑检查**

```bash
npm run check:workbench-architecture
npm run check:editor-document-session
npm run check:markdown-architecture
npm run check:localization
```

Expected: 全绿。

- [ ] **Step 3: 手工验收**

`npm run dev`，准备一个含 `assets/` 子目录的工作区：

1. 打开 `notes/a.md`，从文件树拖 `assets/p.png` 到编辑区**正中** → 插入 `![p](../assets/p.png)`，图片立即渲染。
2. 同样拖到面板**左边缘**（距边 < 48px）→ 仍然是分屏打开图片预览。
3. 拖 `assets/photo (1).png` 到正中 → 插入 `![photo (1)](<../assets/photo (1).png>)`，图片可见。
4. 从 Finder 拖一张 PNG 进来 → 文件被导入到 `notes/` 并插入 `![xxx](image-<uuid>.png)`。
5. 拖一个 `data.pdf` 到正中 → 仍是分屏，不插入任何文本。
6. 把 `a.md` 切成只读预览（例如从 Cloud 只读工作区）再拖图片 → 仍是分屏，不报错。
7. 拖一张 30MB 的 PNG → 出现「无法插入」提示，文档内容未变。

- [ ] **Step 4: 提交**

```bash
git add locales/renderer src/features/editor-workbench/layout/DesktopEditorSplitView.tsx \
        src/features/editor-workbench/drag-and-drop/useExplorerFileDrop.ts
git commit -m "fix(workbench): report image drop failures precisely"
```
