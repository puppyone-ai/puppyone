# 01 · Markdown 文内目录（大纲）实施计划

> **面向执行者：** 用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 逐任务执行。步骤用 `- [ ]` 勾选跟踪。

**目标：** 让每个 Markdown 文档都有一个常驻的右侧目录面板，点击条目精确滚动到标题、滚动时当前条目跟随高亮；并把现有的刻度轨从实验开关里转正。

**架构：** 现有 `markdownHeadingOutline.ts` 已经实现了刻度轨 + 悬停弹出层 + 滚动联动 + 键盘导航。本计划把它拆成两层：`core/` 保留纯模型（`collectMarkdownHeadingOutlineEntries`）和滚动定位函数，新增一个 React 侧的 `MarkdownOutlinePanel` 常驻面板组件，由它订阅编辑器状态并渲染可点击的树形目录。刻度轨保留为「面板收起时的降级形态」。

**技术栈：** TypeScript、React 18、CodeMirror 6（`@codemirror/view`、`@codemirror/state`）、Vitest。

**规格来源：** `plan/README.md` 第二、三节。

---

## 全局约束

- 不新增第三方依赖。目录树的绘制用现有 DOM + CSS 完成。
- 所有用户可见文案走 `locales/renderer/<lang>/editor.json`（或既有 markdown 相关命名空间），不在 TSX 里硬编码中文或英文。
- 遵守 `src/shared-ui/editor/markdown/README.md` 的依赖规则：`core/` 不得导入具体 feature，`shared/` 不得导入 `core/`/`features/`/`composition/`/`platform/`。
- 样式写在 `src/shared-ui/styles/editor/markdown-editor.css`，类名前缀 `cm-md-heading-outline-` 或 `po-markdown-outline-`，颜色只用 `--po-*` 变量。
- 每个任务结束必须能通过 `npm run check:markdown-architecture` 与 `npm run check:renderer-style-architecture`。
- 测试文件必须落在 `tests/unit/editor/formats/markdown/<capability>/` 下，由 `scripts/check-test-layout.mjs` 校验。

## 审查重点

写每个任务的测试时，下面这几类输入是最可能咬人的，逐条在对应任务里补测试：

1. **标题文本里含内联 Markdown** —— `## 用 **粗体** 和 \`代码\`` 在面板里应显示为纯文本「用 粗体 和 代码」，而不是显示星号反引号。
2. **重复标题** —— 两个 `## 背景`，点击第二条必须滚到第二条，不能都滚到第一条。
3. **代码围栏里的井号** —— ```` ```bash\n# 这是注释\n``` ```` 不能被当成 H1。
4. **Setext 标题** —— `标题\n====` 是 H1，`标题\n----` 是 H2，不能被漏掉。
5. **超长标题** —— 300 字符的标题不能撑破面板宽度，必须单行省略。

---

### Task 1：把大纲数据模型抽成可测试的纯函数并补齐解析边界

**Files:**
- Modify: `src/shared-ui/editor/markdown/core/interaction/markdownHeadingOutline.ts:436-490`（`collectMarkdownHeadingOutlineEntries`）
- Create: `tests/unit/editor/formats/markdown/outline/markdownHeadingOutlineModel.test.ts`

**Interfaces:**
- Consumes: `EditorState` from `@codemirror/state`。
- Produces:
  - `export type MarkdownOutlineHeading = Readonly<{ from: number; level: number; title: string; plainTitle: string; }>`
  - `export function collectMarkdownHeadingOutlineEntries(state: EditorState): MarkdownOutlineHeading[]`
  - `export type MarkdownOutlineNode = Readonly<{ heading: MarkdownOutlineHeading; index: number; children: MarkdownOutlineNode[]; }>`
  - `export function buildMarkdownOutlineTree(headings: readonly MarkdownOutlineHeading[]): MarkdownOutlineNode[]`

注意：现有的 `HeadingEntry` 类型是模块私有的，`from`/`level`/`title` 三个字段被 `MarkdownHeadingOutlineController` 直接使用。新增 `plainTitle` 而不改名 `title`，避免动到 502 行控制器里的 12 处引用。

- [ ] **Step 1: 写失败的测试**

```ts
// tests/unit/editor/formats/markdown/outline/markdownHeadingOutlineModel.test.ts
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  buildMarkdownOutlineTree,
  collectMarkdownHeadingOutlineEntries,
} from "../../../../../../src/shared-ui/editor/markdown/core/interaction/markdownHeadingOutline";

const stateOf = (doc: string) => EditorState.create({ doc });

describe("collectMarkdownHeadingOutlineEntries", () => {
  it("strips inline markdown from plainTitle but keeps raw title", () => {
    const [heading] = collectMarkdownHeadingOutlineEntries(stateOf("## 用 **粗体** 和 `代码`\n"));
    expect(heading.plainTitle).toBe("用 粗体 和 代码");
    expect(heading.title).toBe("用 **粗体** 和 `代码`");
  });

  it("ignores # inside fenced code blocks", () => {
    const headings = collectMarkdownHeadingOutlineEntries(
      stateOf("```bash\n# 注释\n```\n## 真标题\n"),
    );
    expect(headings.map((h) => h.title)).toEqual(["真标题"]);
  });

  it("recognizes setext headings", () => {
    const headings = collectMarkdownHeadingOutlineEntries(stateOf("标题一\n=====\n\n标题二\n-----\n"));
    expect(headings).toEqual([
      expect.objectContaining({ level: 1, title: "标题一" }),
      expect.objectContaining({ level: 2, title: "标题二" }),
    ]);
  });

  it("keeps every duplicate heading as a distinct entry", () => {
    const headings = collectMarkdownHeadingOutlineEntries(stateOf("## 背景\n\n## 背景\n"));
    expect(headings).toHaveLength(2);
    expect(headings[0].from).not.toBe(headings[1].from);
  });
});

describe("buildMarkdownOutlineTree", () => {
  it("nests headings by level and tolerates skipped levels", () => {
    const headings = collectMarkdownHeadingOutlineEntries(
      stateOf("# A\n## B\n#### D\n## C\n# E\n"),
    );
    const tree = buildMarkdownOutlineTree(headings);
    expect(tree.map((node) => node.heading.title)).toEqual(["A", "E"]);
    expect(tree[0].children.map((node) => node.heading.title)).toEqual(["B", "C"]);
    expect(tree[0].children[0].children.map((node) => node.heading.title)).toEqual(["D"]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/editor/formats/markdown/outline/markdownHeadingOutlineModel.test.ts`
Expected: FAIL —— `plainTitle` 与 `buildMarkdownOutlineTree` 不存在；setext 用例断言为空数组。

- [ ] **Step 3: 实现**

在 `markdownHeadingOutline.ts` 里：

1. 把 `type HeadingEntry` 改为导出的 `MarkdownOutlineHeading`，增加 `plainTitle: string`。
2. `plainTitle` 的算法：用同一个 `state` 已有的 Markdown 解析结果取标题节点的文本子节点拼接，而不是自己对字符串做正则替换。若现有解析入口不易复用，退化为去除 `**`、`*`、`` ` ``、`~~`、`[text](url)` 的 `[text]` 形式，并 `trim()`。
3. 在已有的 ATX 分支之外增加 setext 分支：当当前行非空、下一行匹配 `/^ {0,3}(=+|-+)\s*$/` 时，把当前行作为标题，level 由分隔符字符决定（`=` → 1，`-` → 2），`from` 取当前行行首。注意 setext 的 `-` 分隔行与无序列表歧义：仅当上一行是普通段落行（非空、非列表项、非围栏）时才成立。
4. 新增 `buildMarkdownOutlineTree`：用栈按 `level` 归并，遇到更深的层级压栈，遇到同级或更浅的层级弹栈到合适父节点。跳级（`##` 直接到 `####`）时让 `####` 成为 `##` 的子节点。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/editor/formats/markdown/outline/markdownHeadingOutlineModel.test.ts`
Expected: PASS（6 个断言组全绿）。

- [ ] **Step 5: 回归现有校验**

Run: `npm run check:markdown-architecture`
Expected: 通过，无新错误。

- [ ] **Step 6: 提交**

```bash
git add src/shared-ui/editor/markdown/core/interaction/markdownHeadingOutline.ts \
        tests/unit/editor/formats/markdown/outline/markdownHeadingOutlineModel.test.ts
git commit -m "feat(markdown): extract outline model with setext and inline-text support"
```

---

### Task 2：抽出共用的滚动定位函数

**Files:**
- Modify: `src/shared-ui/editor/markdown/core/interaction/markdownHeadingOutline.ts:139-145`
- Create: `tests/unit/editor/formats/markdown/outline/markdownOutlineNavigation.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `MarkdownOutlineHeading`。
- Produces:
  - `export function scrollMarkdownViewToHeading(view: EditorView, heading: MarkdownOutlineHeading): void`
  - `export function resolveActiveOutlineIndex(headings: readonly MarkdownOutlineHeading[], scrollTop: number, blockTop: (from: number) => number): number`

两个函数都是纯的、可测的：`resolveActiveOutlineIndex` 接收一个 `blockTop` 回调，而不是直接吃 `EditorView`，这样单测里不用构造真实的 CodeMirror 视图。

- [ ] **Step 1: 写失败的测试**

```ts
// tests/unit/editor/formats/markdown/outline/markdownOutlineNavigation.test.ts
import { describe, expect, it } from "vitest";
import { resolveActiveOutlineIndex } from "../../../../../../src/shared-ui/editor/markdown/core/interaction/markdownHeadingOutline";

const headings = [
  { from: 0, level: 1, title: "A", plainTitle: "A" },
  { from: 100, level: 2, title: "B", plainTitle: "B" },
  { from: 200, level: 2, title: "C", plainTitle: "C" },
];
const blockTop = (from: number) => from; // 位置即纵坐标，便于断言

describe("resolveActiveOutlineIndex", () => {
  it("returns the last heading scrolled past the activation marker", () => {
    expect(resolveActiveOutlineIndex(headings, 0, blockTop)).toBe(0);
    expect(resolveActiveOutlineIndex(headings, 90, blockTop)).toBe(1);
    expect(resolveActiveOutlineIndex(headings, 500, blockTop)).toBe(2);
  });

  it("returns -1 for an empty outline", () => {
    expect(resolveActiveOutlineIndex([], 0, blockTop)).toBe(-1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/editor/formats/markdown/outline/markdownOutlineNavigation.test.ts`
Expected: FAIL —— `resolveActiveOutlineIndex` 未导出。

- [ ] **Step 3: 实现**

把现有 `resolveActiveHeadingIndex`（`markdownHeadingOutline.ts:404-418`）改造成导出的 `resolveActiveOutlineIndex(headings, scrollTop, blockTop)`，内部保留 `ACTIVE_SCROLL_OFFSET_PX = 24` 的偏移。控制器里调用点改为 `resolveActiveOutlineIndex(this.headings, this.view.scrollDOM.scrollTop, (from) => this.view.lineBlockAt(from).top)`。

新增 `scrollMarkdownViewToHeading(view, heading)`，内部就是现有 `jumpToHeading` 的两行：`scrollCodeMirrorIntoView(view, heading.from, { y: "start", yMargin: 16 })`，但不调用 `view.focus()`（面板点击不应抢走编辑焦点）。`jumpToHeading` 改为调用它，再额外 `this.view.focus()`。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/editor/formats/markdown/outline/`
Expected: PASS（Task 1 与 Task 2 的用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add src/shared-ui/editor/markdown/core/interaction/markdownHeadingOutline.ts \
        tests/unit/editor/formats/markdown/outline/markdownOutlineNavigation.test.ts
git commit -m "refactor(markdown): expose outline scroll and active-index helpers"
```

---

### Task 3：建立编辑器状态订阅端口

**Files:**
- Create: `src/shared-ui/editor/markdown/core/interaction/markdownOutlineState.ts`
- Modify: `src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor.tsx`（新增 prop 与订阅 effect）
- Test: `tests/unit/editor/formats/markdown/outline/markdownOutlineState.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `collectMarkdownHeadingOutlineEntries`、`MarkdownOutlineHeading`。
- Produces:
  - `export type MarkdownOutlineSnapshot = Readonly<{ headings: MarkdownOutlineHeading[]; activeIndex: number; }>`
  - `export type MarkdownOutlineListener = (snapshot: MarkdownOutlineSnapshot) => void`
  - `export function createMarkdownOutlineStateTracker(view: EditorView, onSnapshot: MarkdownOutlineListener): { destroy(): void }` —— 内部用 `EditorView.updateListener` 与 `scrollDOM` 的 scroll 监听，仅在快照的 `headings` 指纹或 `activeIndex` 变化时回调。
  - `MarkdownCodeMirrorEditorProps` 新增：`onOutlineChange?: (snapshot: MarkdownOutlineSnapshot) => void;`

React 侧只能通过这个端口拿大纲数据，不去 `import` `EditorView` 内部结构。

- [ ] **Step 1: 写失败的测试**

```ts
// tests/unit/editor/formats/markdown/outline/markdownOutlineState.test.ts
import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { buildOutlineSnapshot } from "../../../../../../src/shared-ui/editor/markdown/core/interaction/markdownOutlineState";

describe("buildOutlineSnapshot", () => {
  it("reports headings and the active index for a given scroll position", () => {
    const state = EditorState.create({ doc: "# A\n\ntext\n\n## B\n" });
    const snapshot = buildOutlineSnapshot(state, 0, (from) => from);
    expect(snapshot.headings.map((h) => h.title)).toEqual(["A", "B"]);
    expect(snapshot.activeIndex).toBe(0);
  });

  it("is stable for identical inputs so React does not re-render", () => {
    const state = EditorState.create({ doc: "# A\n" });
    const first = buildOutlineSnapshot(state, 0, (from) => from);
    const second = buildOutlineSnapshot(state, 0, (from) => from);
    expect(first.headings).toBe(second.headings);
  });
});
```

第二条断言要求按 `EditorState` 实例做 WeakMap 缓存，避免每次滚动都重建标题数组。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/editor/formats/markdown/outline/markdownOutlineState.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`buildOutlineSnapshot(state, scrollTop, blockTop)` 用 `WeakMap<EditorState, MarkdownOutlineHeading[]>` 缓存解析结果，`activeIndex` 每次按传入的 `scrollTop` 现算。

`createMarkdownOutlineStateTracker` 在 `MarkdownCodeMirrorEditor` 的 `useLayoutEffect` 里、`view` 创建之后安装，`destroy` 挂到该 effect 的清理里。回调节流到每个 `requestAnimationFrame` 最多一次。

`MarkdownCodeMirrorEditor` 把 `onOutlineChange` 存进 `callbacksRef`（跟现有的 `onChange` 等一致），避免每次 render 重建订阅。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/editor/formats/markdown/outline/`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/shared-ui/editor/markdown/core/interaction/markdownOutlineState.ts \
        src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor.tsx \
        tests/unit/editor/formats/markdown/outline/markdownOutlineState.test.ts
git commit -m "feat(markdown): publish outline snapshots to the host"
```

---

### Task 4：常驻目录面板组件

**Files:**
- Create: `src/shared-ui/editor/markdown/MarkdownOutlinePanel.tsx`
- Create: `src/shared-ui/styles/editor/markdown-outline-panel.css`
- Test: `tests/component/editor/formats/markdown/outline/MarkdownOutlinePanel.test.tsx`

**Interfaces:**
- Consumes: Task 3 的 `MarkdownOutlineSnapshot` 与 `buildMarkdownOutlineTree`（Task 1）。
- Produces: `export function MarkdownOutlinePanel(props: { snapshot: MarkdownOutlineSnapshot | null; onJump: (index: number) => void; label: string; }): JSX.Element | null`

行为约定：
- `snapshot` 为 `null`、或 `headings.length < 2` 时返回 `null`（面板整个不出现，不占位）。
- 树形渲染，缩进按 `level` 相对最小层级计算，每级 12px，最多 4 级。
- 当前条目 `data-active="true"`，`aria-current="location"`。
- 条目是 `<button type="button">`，点击调用 `onJump(index)`。
- 超长标题 `text-overflow: ellipsis` 单行截断，`title` 属性放全文。

**样式落点**：`markdown-outline-panel.css` 需在样式入口里被引入。先确认 `src/shared-ui/styles/editor/markdown-editor.css` 是否由某个 `index.css` 汇总引入；若是，在该汇总处新增一行 `@import "./markdown-outline-panel.css";`。若 `check:renderer-style-architecture` 要求样式集中注册，按该脚本报错提示的位置注册。

- [ ] **Step 1: 写失败的测试**

```tsx
// tests/component/editor/formats/markdown/outline/MarkdownOutlinePanel.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownOutlinePanel } from "../../../../../../src/shared-ui/editor/markdown/MarkdownOutlinePanel";

const snapshot = {
  headings: [
    { from: 0, level: 1, title: "A", plainTitle: "A" },
    { from: 100, level: 2, title: "B", plainTitle: "B" },
  ],
  activeIndex: 1,
};

describe("MarkdownOutlinePanel", () => {
  it("renders nothing for fewer than two headings", () => {
    const { container } = render(
      <MarkdownOutlinePanel snapshot={{ headings: snapshot.headings.slice(0, 1), activeIndex: 0 }}
        onJump={() => {}} label="目录" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("marks the active entry and jumps by index", async () => {
    const onJump = vi.fn();
    render(<MarkdownOutlinePanel snapshot={snapshot} onJump={onJump} label="目录" />);
    const active = screen.getByRole("button", { name: "B" });
    expect(active.getAttribute("aria-current")).toBe("location");
    active.click();
    expect(onJump).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/component/editor/formats/markdown/outline/MarkdownOutlinePanel.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现组件**

`MarkdownOutlinePanel.tsx`：用 `useMemo(() => buildMarkdownOutlineTree(snapshot.headings), [snapshot.headings])` 建树，递归渲染。每个节点的 `index` 来自 Task 1 的树节点，直接用它的下标调用 `onJump`。

- [ ] **Step 4: 实现样式**

`markdown-outline-panel.css`：面板宽 `200px`，`position: sticky; top: 0;`，自身 `overflow-y: auto`，`max-height: 100%`。颜色全部走 `--po-text-muted` / `--po-text` / `--po-menu-bg` / `--po-border-subtle`。条目高 `26px`，圆角 `6px`，与现有 `.cm-md-heading-outline-item` 的视觉参数保持一致，避免两个形态看起来像两家产品。

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/component/editor/formats/markdown/outline/MarkdownOutlinePanel.test.tsx`
Expected: PASS。

- [ ] **Step 6: 校验样式架构**

Run: `npm run check:renderer-style-architecture && npm run check:interface-styles`
Expected: 通过。

- [ ] **Step 7: 提交**

```bash
git add src/shared-ui/editor/markdown/MarkdownOutlinePanel.tsx \
        src/shared-ui/styles/editor/markdown-outline-panel.css \
        tests/component/editor/formats/markdown/outline/MarkdownOutlinePanel.test.tsx
git commit -m "feat(markdown): add a persistent document outline panel"
```

---

### Task 5：接进 MarkdownViewer 并让面板在两种模式下都可用

**Files:**
- Modify: `src/shared-ui/editor/markdown/MarkdownViewer.tsx:17-78`
- Modify: `src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor.tsx`（新增 `onViewReady` prop）
- Modify: `src/shared-ui/editor/viewers/shared/TextEditorFrame.tsx`（若需要，暴露一个内容区插槽）
- Test: `tests/component/editor/formats/markdown/outline/MarkdownViewerOutline.test.tsx`

**Interfaces:**
- Consumes: Task 3 的 `onOutlineChange`、Task 4 的 `MarkdownOutlinePanel`。
- Produces: `MarkdownCodeMirrorEditorProps.onViewReady?: (view: EditorView) => void` —— 在 `viewRef.current = view` 之后同步调用一次；卸载时调用 `onViewReady?.(null as never)`？**不要**这么做，改为在父层用 ref 判空，避免类型逃逸。改为：`onViewReady?: (view: EditorView | null) => void`，卸载时传 `null`。

`MarkdownViewer` 内部状态：`const [outline, setOutline] = useState<MarkdownOutlineSnapshot | null>(null)` 与 `const viewRef = useRef<EditorView | null>(null)`。`renderLive` 与 `renderSource` 两个分支都传 `onOutlineChange={setOutline}` 与 `onViewReady={(view) => { viewRef.current = view; }}`。

布局：`MarkdownViewer` 外层包一个 `display: flex` 容器，左 `flex: 1 min-width: 0` 放 `TextEditorFrame`，右放 `MarkdownOutlinePanel`。

**这一任务的关键取舍**：源码模式也显示面板。现有实现在源码模式下清空 outline compartment（`MarkdownCodeMirrorEditor.tsx:229`），但 Task 3 的订阅端口独立于该 compartment，所以面板在两种模式下都能拿到数据。刻度轨仍只在实时预览模式显示。

- [ ] **Step 1: 写失败的测试**

```tsx
// tests/component/editor/formats/markdown/outline/MarkdownViewerOutline.test.tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
// 断言：MarkdownViewer 渲染后，容器内存在 .po-markdown-outline-panel
// 并在 onOutlineChange 被调用后出现两个条目。
```

测试里用一个假的 editor 组件替换真实 CodeMirror（通过传入可控的 `onOutlineChange` 触发），断言面板出现。真实的滚动联动由 Task 2 的单测覆盖。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/component/editor/formats/markdown/outline/MarkdownViewerOutline.test.tsx`
Expected: FAIL —— 面板未渲染。

- [ ] **Step 3: 实现布局与接线**

按上述 Interfaces 改两个文件。注意 `TextEditorFrame` 内部已有自己的工具栏与模式切换，面板必须挂在它**外面**，否则会被模式切换重挂。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/component/editor/formats/markdown/outline/`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/shared-ui/editor/markdown/MarkdownViewer.tsx \
        src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor.tsx \
        tests/component/editor/formats/markdown/outline/MarkdownViewerOutline.test.tsx
git commit -m "feat(markdown): show the outline panel beside the editor"
```

---

### Task 6：把实验开关降级为「显示刻度轨」开关

**Files:**
- Modify: `src/preferences.ts:105,202,452`
- Modify: `src/features/settings/main/ExperimentalSettingsView.tsx:40`
- Modify: `src/features/app-shell/DesktopDataWorkspaceSurface.tsx:162-164`
- Modify: `src/app/FileModeApp.tsx`（`FILE_MODE_EDITOR_PREFERENCES` 常量）
- Modify: `locales/renderer/*/settings.json`（全部语言）
- Modify: `src/shared-ui/editor/markdown/MarkdownViewer.tsx`
- Test: `tests/unit/settings/preferences/experimentalSettingsOutlineDefault.test.ts`

**Interfaces:**
- Produces: 面板默认常驻，**不受任何开关控制**；`enableMarkdownHeadingOutline` 的含义收窄为「显示右侧刻度轨」，默认改为 `true`。

这是产品决定，执行时按此实现；若产品另有意见，只改这里的一行默认值，不影响前五个任务。

**关键陷阱（先读）：** 本项目里「默认开启」有两种约定。`enableShareOnboarding`、`enablePayments` 用的是 `parsed.x !== false`（缺省即开）；`enableMarkdownHeadingOutline` 现在用的是 `parsed.x === true`（缺省即关）。**只改 `DEFAULT_EXPERIMENTAL_SETTINGS` 里的字面量是不够的** —— 老用户的 localStorage 里存着 `{"enableMarkdownHeadingOutline": false}` 或根本没有这个键，`=== true` 会把它判成 `false`，默认值永远读不到。下面 Step 1 必须同时改两处。

- [ ] **Step 1: 写失败的测试**

```ts
// tests/unit/settings/preferences/experimentalSettingsOutlineDefault.test.ts
import { describe, expect, it } from "vitest";
import { parseExperimentalSettings } from "../../../../src/preferences";

describe("markdown heading rail default", () => {
  it("defaults to on when nothing is persisted", () => {
    expect(parseExperimentalSettings(null).enableMarkdownHeadingOutline).toBe(true);
  });

  it("defaults to on for a legacy record that predates the key", () => {
    expect(parseExperimentalSettings("{}").enableMarkdownHeadingOutline).toBe(true);
  });

  it("still honours an explicit opt-out", () => {
    expect(parseExperimentalSettings(
      JSON.stringify({ enableMarkdownHeadingOutline: false }),
    ).enableMarkdownHeadingOutline).toBe(false);
  });

  it("honours an explicit opt-in", () => {
    expect(parseExperimentalSettings(
      JSON.stringify({ enableMarkdownHeadingOutline: true }),
    ).enableMarkdownHeadingOutline).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/settings/preferences/experimentalSettingsOutlineDefault.test.ts`
Expected: FAIL —— 前两条断言得到 `false`。

- [ ] **Step 3: 改默认值与解析**

两处都要改：

1. `src/preferences.ts:202`（`DEFAULT_EXPERIMENTAL_SETTINGS` 内）：
   `enableMarkdownHeadingOutline: false` → `enableMarkdownHeadingOutline: true`，并在上方补一行注释，与 `enablePayments` 的注释体例一致：
   ```ts
   /** The rail is quiet and opt-out. The outline panel itself is always on. */
   enableMarkdownHeadingOutline: true,
   ```
2. `src/preferences.ts:452`（`parseExperimentalSettings` 内）：
   ```ts
   enableMarkdownHeadingOutline: parsed.enableMarkdownHeadingOutline !== false,
   ```
   从 `=== true` 改为 `!== false`。这一步是让默认值真正生效的关键。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/settings/preferences/experimentalSettingsOutlineDefault.test.ts`
Expected: PASS（4 条全绿）。

- [ ] **Step 5: 改文案**

`locales/renderer/en/settings.json`：
```json
"experimental.markdownHeadingOutline.title": "Heading rail",
"experimental.markdownHeadingOutline.detail": "Show the slim heading rail in Markdown Live Preview. The outline panel is always available."
```
其余语言类比翻译，不要机翻后不校对。

- [ ] **Step 6: 确认面板不受开关影响**

`MarkdownViewer.tsx` 里 `MarkdownOutlinePanel` 的渲染条件只依赖 `outline` 快照，不读 `headingOutlineEnabled`。写一个断言测试覆盖这点：把 `headingOutlineEnabled` 设为 `false`，面板仍然出现。

- [ ] **Step 7: 跑本地化与边界校验**

Run: `npm run check:localization && node scripts/check-user-vocabulary.mjs`
Expected: 通过。

- [ ] **Step 8: 提交**

```bash
git add src/preferences.ts src/features/settings/main/ExperimentalSettingsView.tsx \
        src/features/app-shell/DesktopDataWorkspaceSurface.tsx src/app/FileModeApp.tsx \
        locales/renderer src/shared-ui/editor/markdown/MarkdownViewer.tsx
git commit -m "feat(markdown): promote the outline panel and default the heading rail on"
```

---

### Task 7：整体验证

- [ ] **Step 1: 跑受影响的检查**

```bash
npm run check:shared-ui
npm run check:boundaries
npx vitest run tests/unit/editor/formats/markdown tests/component/editor/formats/markdown
```

Expected: 全绿。

- [ ] **Step 2: 手工验收**

`npm run dev` 后，打开一个含 6 个以上标题的 `.md`：

1. 右侧出现目录面板，条目按层级缩进。
2. 点击第 4 条，编辑区滚到该标题且标题贴顶。
3. 手动滚动到文档中部，面板里对应条目高亮。
4. 切到源码模式，面板仍在，点击仍能跳转。
5. 打开一个只有 1 个标题的文件，面板不出现，编辑区没有留白。

- [ ] **Step 3: 提交并报告**

```bash
git add -A && git commit -m "chore(markdown): verify outline panel end to end" # 仅在确有文件变更时
```

报告内容：改动文件清单、`npm run check:shared-ui` 的实际输出、手工验收五条的逐条结果。
