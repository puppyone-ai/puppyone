# 块级图片的拖拽手柄对齐 实施计划

> **面向执行者：** 用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 逐任务执行。步骤用 `- [ ]` 勾选跟踪。

**目标：** 实时预览里「整行只有一张图片」时，6 点拖拽手柄贴在图片可见左上角，看起来是这张图的控件；图片上下不再各多出一条看不见的空文本行。

**架构：** 不改拖拽交互、不改 Markdown 语法、不改 `blockDragGeometry` 的定位算法。根因是一个 CSS 盒模型问题：块级图片控件在 CodeMirror 的 `.cm-line`（行内格式化上下文）里用了 `display: flex`，浏览器因此把这一行拆成「空首行 + 图片 + 空尾行」三条行盒。手柄的锚点来自 `view.coordsAtPos()`，对一个被整体替换的图片行它退化成「行的第一条文字行」——也就是那条空首行。把 `.is-block` 的图片降到行内层级（`inline-flex`）后，空行消失，锚点自然落在图片顶部。已有的同类先例是 `.cm-md-html-run.is-block { display: inline-block; vertical-align: top; }`。

**技术栈：** TypeScript、CodeMirror 6、CSS、Electron 冒烟测试（真实 Chromium 测量）、Vitest。

**规格来源：** `plan/README.md` 第六节；用户提供的两张截图（源码模式 `# 健身营养` + `![](三大供能系统.jpg)`，预览模式手柄悬在图片上方一行）。

---

## 全局约束

- **只改块级图片的盒模型。** 行内图文混排（`displayMode: inline`）、表格内 `<img>`（走 html-run）、链接包裹的图片、视频/代码/表格/Mermaid/HTML 块控件都不在本计划范围内，行为必须保持不变。
- **不改定位算法。** `src/shared-ui/editor/markdown/addons/block-drag/blockDragGeometry.ts` 的 `readHandlePoint`、`handleAnchorCenterY` 不动。这次是让「行盒里没有多余的行」，不是改「手柄怎么找行」。
- **不改文档内容与 AST。** `MarkdownMovableBlockRef`、`markdownBlockBoundaries`、`markdownBlockMove` 不动。
- **没有新增用户文案。** 不涉及 `locales/renderer/**`，不跑 `check-user-vocabulary` 的新增项。
- 断言只写**阈值**，不写死像素：正文行高是 `1.75 × 字号`，字号由主题决定，测量值会随主题变化。
- 测试落在已有目录（`tests/fixtures/editor/formats/markdown/`、`tests/integration/editor/formats/markdown/rendering/`），不新建目录，符合 `scripts/check-test-layout.mjs`。
- 改动后必须通过：`npm run smoke:markdown-block-drag`、`npm run check:markdown-architecture`、`npm run check:renderer-style-architecture`。
- 遵循 `AGENTS.md`：从当前 `qubits` 拉 `codex/<task-name>` 短分支，只 `git add` 明确路径，不推送、不合并远程。

## 根因（已实测，不是推断）

用仓库真实样式表（`markdown-theme-tokens.generated.css` + `markdown-content.css` + `markdown-inline-widgets.css`）在 Electron/Chromium 里渲染一条「只有一个块级图片」的 `.cm-line`，正文 15px/1.75，图片 220px 高：

| 写法 | 行盒高 | 图片上方空隙 | 图片下方空隙 |
|---|---|---|---|
| 现状 `display: flex` | 276.25px | **26.25px（一整行）** | **26.25px（一整行）** |
| `display: inline-flex; vertical-align: top` | 223.75px | 0 | 0（仅剩 3.75px 行距） |

链路：

1. `.markdown-codemirror-editor .cm-md-image-widget.is-block { display: flex }`（`src/shared-ui/styles/editor/markdown-inline-widgets.css:22-27`）让图片成为一个块级盒子，而它处在 `.cm-line` 的行内上下文里，浏览器只能给它前后各插入一个空的行盒。
2. `ImagePreviewWidget.coordsAt()`（`imagePreviewWidget.ts:281`）→ `getInlineWidgetTextCoords()`（`shared/widgets/markdownWidgetMeasure.ts`）。该函数找不到可见文字时退化为 `getFallbackLineTextRect()`：`top = lineRect.top + paddingTop`，`bottom = top + lineHeight`。对图片行来说，这就是**第一条空行**的矩形。
3. `readHandlePoint()`（`blockDragGeometry.ts:89-107`）拿这个 anchor 算 `y`。图片行的 `block.type` 是 `BlockType.Text`，走文字分支 `(anchor.top + anchor.bottom) / 2`，手柄中心因此落在空首行的中线——图片顶上方约 13px，视觉上就是「一条空文本行的项目符号」。

截图里的两个现象是同一个根因：手柄「像另一行的 bullet」，以及图片上方那段说不清来源的留白。

## 审查重点

下面几类情况本计划的测试必须覆盖，按最可能咬人的顺序：

1. **块图是文档第一块 / 最后一块** —— 尾部空行移除后不能与滚动区留白打架，也不能让手柄落到可视区外。
2. **拖拽时的源块高亮框** —— `showSource()` 用 `lineBlockAt(block.from/to).top/bottom`，空行消失后高亮框必须收缩到图片本身，而不是留下 52.5px 的透明尾巴。
3. **图片加载占位态** —— `.cm-md-image-placeholder.is-loading` 自带 `min-height: clamp(54px,10vw,96px)`；占位态与加载完成态都不能出现空首行，且高度只能跳变一次。
4. **窄面板** —— `width: 100%` 的 inline-flex 在窄面板里不能溢出，手柄仍在图片左侧轨道上。
5. **RTL 文档** —— 手柄移到右轨时，纵向对齐同样成立。
6. **相邻段落的节奏** —— 块图前后的间距只能来自 line padding 语义（`--po-md-source-line-gap` + 段落 gap），不能因为去掉空行而变成负数或黏连。

---

### Task 1：让冒烟夹具渲染块级图片，并写下失败的几何场景

**Files:**
- Modify: `tests/fixtures/editor/formats/markdown/block-drag.tsx`
- Modify: `tests/integration/editor/formats/markdown/rendering/markdown-block-drag.smoke.mjs`

**Interfaces:**
- Produces（夹具新方法，后续任务都靠它们）：
  - `window.blockDragFixture.imageReady(): Promise<void>` —— 等到 `.cm-md-image-widget img:not([hidden])` 出现，最多 3s。
  - `window.blockDragFixture.blockImage(): { widget: Box; line: Box; display: string } | null` —— 第一个块级图片控件的外框、它所在的 `.cm-line` 外框、以及 `getComputedStyle(widget).display`。`Box` 即夹具已有的 `{ left, right, top, bottom }`。
- Produces（新文档）：`doc=image`。

- [ ] **Step 1: 给夹具加图片素材解析器与新文档**

在 `tests/fixtures/editor/formats/markdown/block-drag.tsx` 的 `const documents = {...}` 之前插入：

```tsx
const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="220"><rect width="480" height="220" rx="12" fill="#39BC66"/></svg>';
// AssetBroker revokes a blob URL with its widget, so each request needs its own.
// `pending.svg` never resolves, so the loading placeholder can be measured.
const imageResolver = (_sourcePath: string, href: string) => (
  href.includes("pending")
    ? new Promise<never>(() => {})
    : Promise.resolve(URL.createObjectURL(new Blob([imageSvg], { type: "image/svg+xml" })))
);
```

在 `documents` 里追加三个条目：

```tsx
  image: () => ["# 健身营养", "", "![三大供能系统](three-energy-systems.svg)", "", "ATP-CP 供能系统之后的说明段落。", ""].join("\n"),
  imagePending: () => ["# 占位", "", "![加载中](pending.svg)", "", "占位之后。", ""].join("\n"),
  imageRtl: () => ["שלום עולם", "", "![תמונה](three-energy-systems.svg)", "", "פסקה אחרונה.", ""].join("\n"),
```

在 `Harness()` 里的 `<MarkdownCodeMirrorEditor ... />` 上补两个 props（其余保持原样）：

```tsx
        <MarkdownCodeMirrorEditor value={initial} livePreview readOnly={false} blockDragEnabled={enabled}
          documentPath="image.md" markdownAssetUrlResolver={imageResolver} />
```

- [ ] **Step 2: 给夹具加测量方法**

在 `const fixture = { ... }` 里，`handle()` 之后追加：

```tsx
  async imageReady() {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      if (document.querySelector(".cm-md-image-widget img:not([hidden])")) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  },
  blockImage() {
    const widget = view().contentDOM.querySelector<HTMLElement>(".cm-md-image-widget");
    const line = widget?.closest<HTMLElement>(".cm-line");
    if (!widget || !line) return null;
    return { widget: box(widget)!, line: box(line)!, display: getComputedStyle(widget).display };
  },
```

- [ ] **Step 3: 写下失败的场景**

在 `tests/integration/editor/formats/markdown/rendering/markdown-block-drag.smoke.mjs` 里，`const rightToLeftScenarios = {` 之前插入：

```js
const imageScenarios = {
  async "a block image's handle sits on the image"(page) {
    await page.call("imageReady");
    const block = await page.call("blockImage");
    assert(block, "the fixture did not render a block image");
    const imageHeight = block.widget.bottom - block.widget.top;
    const lineHeight = block.line.bottom - block.line.top;
    // Only the line's own bottom padding may exceed the image.
    assert(lineHeight - imageHeight <= 8,
      `the image line wasted ${lineHeight - imageHeight}px around a ${imageHeight}px image`);
    const handle = await page.hoverUntilHandle(block.widget.left + 40, block.widget.top + 20);
    assert(handle, "no handle for a block image");
    assert(handle.y >= block.widget.top - 1,
      `handle y ${handle.y} floats above the image top ${block.widget.top}`);
    assert(handle.y <= block.widget.top + 26,
      `handle y ${handle.y} sits below the image's first row`);
    assert.equal(block.display, "inline-flex", "a block image must stay inline-level inside its line");
  },
};
```

在 `run()` 里，`await runAll("doc=frontmatter", frontmatterScenarios);` 之后追加：

```js
  await runAll("doc=image", imageScenarios);
```

- [ ] **Step 4: 跑一次，确认它因为正确的原因失败**

Run: `npm run smoke:markdown-block-drag`
Expected: `FAIL  a block image's handle sits on the image`，消息是 `the image line wasted 56.25px around a 220px image`（数值随主题字号浮动，关键是它明显大于 8）。其余 19 条既有场景仍应通过（若某条既有场景本身偶发失败，重跑一次确认是抖动而不是回归）。

- [ ] **Step 5: 提交（红）**

```bash
git add tests/fixtures/editor/formats/markdown/block-drag.tsx \
        tests/integration/editor/formats/markdown/rendering/markdown-block-drag.smoke.mjs
git commit -m "test(markdown): measure a block image's handle against the image"
```

---

### Task 2：把块级图片降到行内层级

**Files:**
- Modify: `src/shared-ui/styles/editor/markdown-inline-widgets.css:22-27`

**Interfaces:**
- Consumes: Task 1 的 `doc=image` 场景与 `blockImage()`。
- Produces: 无新接口。块级图片控件的计算样式 `display` 变为 `inline-flex`，外框仍是整条阅读栏宽。

- [ ] **Step 1: 改盒模型**

把现行规则（`markdown-inline-widgets.css` 第 22-27 行）：

```css
.markdown-codemirror-editor .cm-md-image-widget.is-block {
  display: flex;
  width: 100%;
  max-width: 100%;
  vertical-align: baseline;
}
```

改为：

```css
/* A block image still shares its source line with the line box around it. A
   block-level box here splits that line into an empty row above and below the
   image, which reads as a blank text line and gives the drag handle something
   invisible to sit on. Keep the same full-width flex formatting inline. */
.markdown-codemirror-editor .cm-md-image-widget.is-block {
  display: inline-flex;
  width: 100%;
  max-width: 100%;
  vertical-align: top;
}
```

`inline-flex` 保留 `width: 100%` 与内部 flex 布局（占位符的 `width: 100%` 仍生效），`vertical-align: top` 与已有的 `.cm-md-html-run.is-block` 先例一致，避免高盒子在基线下把行盒撑高。

- [ ] **Step 2: 跑 Task 1 的场景，确认转绿**

Run: `npm run smoke:markdown-block-drag`
Expected: `pass  a block image's handle sits on the image`，并且 `20/20 scenarios passed`。

- [ ] **Step 3: 跑样式与架构门禁**

Run: `npm run check:renderer-style-architecture && npm run check:markdown-architecture`
Expected: 两条都退出码 0，无输出或只有汇总行。

- [ ] **Step 4: 提交（绿）**

```bash
git add src/shared-ui/styles/editor/markdown-inline-widgets.css
git commit -m "fix(markdown): keep block images inline so the drag handle lands on the image"
```

---

### Task 3：相邻节奏、拖拽预览框、占位态、窄面板与 RTL 的回归

**Files:**
- Modify: `tests/integration/editor/formats/markdown/rendering/markdown-block-drag.smoke.mjs`

**Interfaces:**
- Consumes: Task 1 的 `imageReady()` / `blockImage()`；Task 2 的盒模型。
- Produces: `imageScenarios` 里的四条新场景（同一分组，逐步追加）。

- [ ] **Step 1: 追加四条场景**

在 Task 1 写好的 `imageScenarios` 对象里，第一条场景之后追加（保持同一个 `const imageScenarios = { ... }`）：

```js
  async "a block image keeps its neighbours' spacing"(page) {
    await page.call("imageReady");
    const block = await page.call("blockImage");
    const heading = await page.call("row", "健身营养");
    const paragraph = await page.call("row", "ATP-CP");
    // Line padding owns the rhythm; no phantom row may add to it.
    assert(block.widget.top - heading.bottom <= 8,
      `the gap above the image is ${block.widget.top - heading.bottom}px`);
    assert(paragraph.top - block.widget.bottom <= 8,
      `the gap below the image is ${paragraph.top - block.widget.bottom}px`);
    assert(paragraph.top >= block.widget.bottom, "the following paragraph overlaps the image");
  },

  async "dragging a block image marks the image only"(page) {
    await page.call("imageReady");
    const block = await page.call("blockImage");
    const handle = await page.hoverUntilHandle(block.widget.left + 40, block.widget.top + 20);
    await page.press(handle);
    await page.dragTo(handle.x + 40, handle.y + 40);
    const source = await page.call("source");
    assert(source, "no source mark during the drag");
    assert((source.bottom - source.top) - (block.widget.bottom - block.widget.top) <= 8,
      `the source mark is ${(source.bottom - source.top)}px for a ${block.widget.bottom - block.widget.top}px image`);
    page.send({ type: "keyDown", keyCode: "Escape" }); await sleep(40);
    await page.release(handle.x + 40, handle.y + 40);
  },

  async "a narrow pane still keeps the handle on the image"(page) {
    page.window.setContentSize(420, 800); await sleep(300);
    await page.call("imageReady");
    const block = await page.call("blockImage");
    assert(block.widget.right - block.widget.left <= 420, "the block image overflowed the narrow pane");
    const handle = await page.hoverUntilHandle(block.widget.left + 40, block.widget.top + 20);
    assert(handle, "no handle in a narrow pane");
    assert(handle.x < block.widget.left, "the handle should sit in the rail left of the image");
    assert(handle.y >= block.widget.top - 1, "the handle floated above the image in a narrow pane");
  },
```

- [ ] **Step 2: 追加占位态与 RTL 两个分组**

在 `const frontmatterScenarios = {` 之前插入：

```js
const imagePendingScenarios = {
  async "a loading placeholder adds no phantom row"(page) {
    await sleep(300);
    const block = await page.call("blockImage");
    assert(block, "the placeholder did not render");
    const height = block.line.bottom - block.line.top;
    const widgetHeight = block.widget.bottom - block.widget.top;
    assert(height - widgetHeight <= 8, `the loading line wasted ${height - widgetHeight}px`);
  },
};

const imageRtlScenarios = {
  async "a right-to-left block image keeps the handle on its image"(page) {
    await page.call("imageReady");
    const rail = await page.call("rail");
    const block = await page.call("blockImage");
    const handle = await page.hoverUntilHandle(rail.left + 100, block.widget.top + 20);
    assert(handle, "no handle for a right-to-left block image");
    assert(handle.x > rail.right, `handle ${handle.x} should sit past the right rail ${rail.right}`);
    assert(handle.y >= block.widget.top - 1, `handle y ${handle.y} floats above the image`);
  },
};
```

在 `run()` 里，Task 1 追加的那行之后继续追加：

```js
  await runAll("doc=imagePending", imagePendingScenarios);
  await runAll("doc=imageRtl", imageRtlScenarios);
```

- [ ] **Step 3: 跑全量冒烟**

Run: `npm run smoke:markdown-block-drag`
Expected: `25/25 scenarios passed`（19 条既有 + 1 + 3 + 1 + 1）。任何一条失败都先重跑一次确认不是抖动。

- [ ] **Step 4: 提交**

```bash
git add tests/integration/editor/formats/markdown/rendering/markdown-block-drag.smoke.mjs
git commit -m "test(markdown): cover block image rhythm, drag preview, and rtl"
```

---

### Task 4：跑完整门禁并目视确认

**Files:**
- 无代码改动。`plan/README.md` 的索引条目已随本计划一起写入，此项任务只负责验证。

**Interfaces:**
- Consumes: 前三项任务。
- Produces: 无。

- [ ] **Step 1: 确认索引已指向本计划**

Run: `grep -n "05-image-block-handle" plan/README.md`
Expected: 命中一行，位于「六、追加计划」小节内。若缺失，按该小节的标题补齐。

- [ ] **Step 2: 跑交付门禁**

Run: `npm run check:markdown-architecture && npm run check:renderer-style-architecture && npm run smoke:markdown-block-drag`
Expected: 三条都成功，冒烟输出 `25/25 scenarios passed`。

- [ ] **Step 3: 目视确认**

Run: `PUPPYONE_BLOCK_DRAG_SHOW=1 npm run smoke:markdown-block-drag`
在产出的 `widget-handle.png`、`handle-nested.png` 同目录里查看截图：块级图片顶部不再有多余空白，手柄距图片顶边不超过一行。

- [ ] **Step 4: 汇报交付状态**

按 `AGENTS.md` 要求报告：活动分支、剩余工作树、已执行的验证命令与结果、以及是否保留了后续工作。

---

## 交付后需要说明的取舍

去掉两条空行会同时改变两件事，评审时应当知情：

1. **图片上下的留白减少约 `2 × 1lh − 行距`**（默认主题、15px 正文下约 48.75px）。这是修复目标之一，但如果有人依赖原来那段空白，需要在主题 token 里显式补 `--po-md-block-gap`，而不是把 `display: flex` 加回来。
2. **拖拽源块高亮框变矮**，紧贴图片。这是正确的，因为高亮的语义是「这块内容」，而不是「这一行的行盒」。
