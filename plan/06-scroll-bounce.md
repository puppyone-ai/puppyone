# Markdown 滚到文末图片时向上反弹：技术报告

**日期**：2026-11-05
**现象来源**：`/Users/herbert/[H LNote]/[随笔]/20230506 观《这么多年》.md`
**状态**：根因已用真实 Electron/Chromium 逐帧测量锁定，并做过对照实验验证修复方向

> 说明：调研全程只读该笔记目录，未修改其中任何文件。仓库内用于诊断的临时夹具与探针脚本已全部删除。

---

## 一、结论先行

这不是"滚动到底部时被强制拉回"的交互 bug，而是**同一篇文档的滚动高度在滚动过程中反复变大变小**。

Markdown 里的图片是**行内 widget**（不是块级 widget）。CodeMirror 只对当前视口附近的 widget 保留真实测量高度；一个图片行一旦离开视口，widget 被销毁，它在高度图里的高度就**退回估算值**——而图片 widget 没有声明估算高度，退回的估算值只有一行文字那么高（约 30px），正在加载占位时约 100px。而这张图真实渲染高度约 1090px。

于是读者往下滚时，文档总高度在几个值之间来回跳：

```
1469 → 1870 → 3850 → 2860 → 4840 → 5830 → 6820
```

其中 `3850 → 2860` 是**一帧之内少了 990px**。浏览器与 CodeMirror 都按"内容变矮了，滚动位置需要补偿"来修正 `scrollTop`，读者看到的正是"往上弹一下"。实测最大回退 **184px**，发生在鼠标滚轮正在向下滚动的时候。

对照实验：强制让图片盒子保持实测高度（`min-height: 1086px`），同样的滚轮手势下 `scrollHeight` 只出现 `[1469, 6820]` 两个值，**回退幅度为 0，反弹完全消失**。

---

## 二、复现方式（可重复）

用一个合成文档复刻这篇笔记的形状：12 段正文 + 5 张连续竖图。图片宽高比为 1080×1620，与笔记里那 5 张照片一致（实测像素尺寸）：

| 文件 | 尺寸 |
|---|---|
| `20230517200558.jpg` | 1080 × 1620 |
| `20230517200605.jpg` | 1080 × 1620 |
| `20230517200608.jpg` | 1620 × 1080 |
| `20230517200611.jpg` | 1080 × 1620 |
| `20230517200615.jpg` | 1080 × 1512 |

窗口 1100 × 760（滚动区可视高 728px）。逐帧采样 `scrollTop` / `scrollHeight` / 已挂载图片数，同时用 `requestAnimationFrame` 记录，滚轮以每次 −120 的小步长从顶部一路滚到底。

为了让图片像真实笔记那样经过"解码延迟"，另外做了一组给资源解析加 450ms 延迟的变体——真实笔记这里是 5 个 200KB~950KB 的 JPEG，经过 AssetBroker 异步读取，必然存在同样的窗口期。

---

## 三、证据

### 3.1 逐帧滚动采样（无额外延迟）

```
scrollHeight 取值序列：[1469, 1870, 3850, 2860, 5830, 4840, 6820]
单帧最大缩水：990px（frame 70）
```

高度时而在涨、时而在缩，说明有东西在被销毁后失去高度。

### 3.2 逐帧滚动采样（模拟真实解码延迟）

```
单帧最大缩水：990px（frame 61）
最大回退：184px（frame 89）
```

回退发生的那几帧：

| frame | scrollTop | scrollHeight | 已挂载图片 | 加载占位 |
|---|---|---|---|---|
| 87 | 2054 | 2860 | 1 | 4 |
| 88 | 2071 | 2860 | 1 | 4 |
| **89** | **1887** | **3850** | **2** | **0** |
| 90 | 1908 | 3850 | 2 | 0 |

滚轮在**向下**滚，`scrollTop` 却从 2071 掉到 1887。读者的观感就是"马上要看到最后一张图了，界面弹回去了"。

### 3.3 CodeMirror 高度图里的真实数值

直接读 `view.lineBlockAt(图片行)`，而不是读 DOM：

| 场景 | 图片行在高度图里的高度 |
|---|---|
| 顶部，widget 从未挂载 | **30px**（一行文字） |
| 滚动到图片区域，widget 已解码 | **1090px** |
| 回到顶部，widget 已销毁 | 1090px（保留） |
| 再次滚到底部，widget 重新挂载中 | 前 3 行掉回 **100px**，后 2 行 1090px |

`100px` 正好是加载占位 `.cm-md-image-placeholder.is-loading` 的高度（`min-height: clamp(54px, 10vw, 96px)` 取 96px，加行内空隙约 100px）。`30px` 是一行正文的行高。

**同一张图，在"未挂载 / 加载中 / 已解码"三种状态下报告三种完全不同的高度。**

### 3.4 对照实验（决定性）

只加一条 CSS，让图片盒子在下述测量中始终保留实测高度：

```css
.markdown-codemirror-editor .cm-md-image-widget { min-height: 1086px; }
```

同样的滚轮手势、同样的采样频率：

```
scrollHeight 取值序列：[1469, 6820]      ← 只增长一次，不再回缩
单帧最大缩水：0
最大回退：0
最终到达底部：true
```

**反弹消失。** 这说明"高度反复变化"就是原因本身，而不是某个滚动补偿逻辑写错了。

---

## 四、根因

### 4.1 图片是行内 widget，没有估算高度

`src/shared-ui/editor/markdown/features/image/imageFeature.ts:16-17`：

```ts
inlineWidgetKinds: ["image"],
blockWidgetKinds: [],
```

`src/shared-ui/editor/markdown/features/image/imagePlan.ts:29`：

```ts
layout: { lineBreaks: 0, estimatedHeight: 120 },
```

注意 `estimatedHeight: 120` 是**计划（plan）**字段，用来给块级 widget 估高。而 `ImagePreviewWidget` 自身**没有**声明 `estimatedHeight` 或 `lineBreaks` getter。

CodeMirror 的 `WidgetType.estimatedHeight` 默认返回 `-1`：

```js
// @codemirror/view
get estimatedHeight() { return -1 }
```

构建高度图时：

```js
let height = deco.widget ? deco.widget.estimatedHeight : 0;
let breaks = deco.widget ? deco.widget.lineBreaks : 0;
if (height < 0) height = this.oracle.lineHeight;   // ← 落到这里，只有一行高
```

所以图片行的"不知情高度"就是一行文字（30px）。

### 4.2 行内 widget 的真实高度不跨视口保留

这是 CodeMirror 的既定设计：只有块级 widget（`block: true`）在高度图里有独立条目；行内 widget 的高度属于"行装饰高度"，随行一起在离开视口、widget 被销毁后失效。

对照实验里"回到顶部后仍是 1090px"说明**只要 widget 还在 DOM 里**高度就被记住；一旦销毁，就失去。读者一路往下滚，图片不断从上方离开视口，高度就不断被丢弃，文档总高度随之缩水——而下方图片又重新挂载、重新测量、重新长高。

### 4.3 为什么偏偏在"最后一张图"最明显

这篇笔记是 5 张图**连续排列**，每张渲染高度约 1090px，而可视区只有 728px。**单张图就比可视区高**。这意味着读者滚到图片区域后，几乎每一步都有图片在上方离开视口、下方进入视口，高度抖动最剧烈。文字部分因为行高稳定，不会触发这个问题。

### 4.4 谁在执行"往上弹"

两个机制同时在场，但都由"高度变化"驱动，属于症状不是病根：

1. **CodeMirror 的滚动锚点**：`measure()` 里比较锚点行前后高度差，超过 1px 就补偿 `scroll.viewport.scrollTop += diff`。
2. **浏览器的滚动锚定（scroll anchoring）**：内容在视口上方变矮时自动调整。

因此**不要去改这两处**——对照实验证明，只要高度稳定，两者都不会产生可见跳变。

---

## 五、修复方案

### 5.1 推荐方案：让图片行在未挂载时也报告正确高度

分两步，都是最小改动：

**第一步：记住每张图的实测几何。**
新增一个模块级缓存，键用"文档路径 + 解析后的资源路径"（`resolveMarkdownMediaReference()` 的产物，稳定、不随 blob URL 失效）。图片解码完成、写入布局后，把渲染宽高与原始像素宽高一起记下。

**第二步：让 widget 用缓存值回答 `estimatedHeight`，并让加载占位占据同样的高度。**
`ImagePreviewWidget` 增加 `get estimatedHeight()`，命中缓存时返回上次实测高度；`toDOM()` 里若有缓存，先给 wrapper 设 `minHeight`，这样从"加载中"过渡到"已显示"不会再改变高度。

这样第一次滚动经过某张图时文档仍会增长一次（`1469 → 6820`，与对照实验一致），但**此后不再缩水，反弹消失**。第一次经过时的增长发生在读者下方，不影响阅读。

**可选增强（第二阶段）**：对即将进入视口的图片提前解析尺寸，让首次经过也不产生增长。这需要在 `visibleRanges` 变化时预取，复杂度高一档，建议先不做。

### 5.2 备选方案与取舍

| 方案 | 做法 | 取舍 |
|---|---|---|
| **A. 几何缓存（推荐）** | 缓存实测高度，`estimatedHeight` + 占位 `minHeight` | 改动局部，只碰 image feature；首次经过仍有一次性增长 |
| B. 改为块级 widget | `blockWidgetKinds: ["image"]`，装饰 `block: true` | 能彻底解决，但会改变块边界、拖拽手柄语义、`MarkdownMovableBlockRef` 归类，回归面大 |
| C. CSS 固定 `min-height` | 如上对照实验 | **不可发布**：硬编码尺寸，换个文档就错 |
| D. 加大 `viewportMargin` | 让 CodeMirror 多渲染几屏 | 只是把抖动推迟到更远处；长文档内存与布局成本上升 |

**建议走 A。** B 值得作为后续架构议题单独评估，不应和本次修复绑在一起。

### 5.3 不建议做的事

- **不要**用 CSS `overflow-anchor: none` 关掉浏览器滚动锚定。那会掩盖症状，并让"上方内容真正变化"（例如编辑上方文本）时的位置保持失效。
- **不要**在滚轮事件里锁死 `scrollTop`。会与用户的正常滚动对抗，且触摸板、键盘翻页、拖动滚动条都要各写一遍。
- **不要**给所有 widget 统一加缓存。视频、表格、代码块各有自己的估高逻辑，混在一起会让高度来源不可判断。

---

## 六、实施计划

> 面向执行者：任务顺序执行，每步都有可验证产出。遵循仓库 `AGENTS.md`，从当前 `qubits` 拉 `codex/<task-name>` 短分支，只 `git add` 明确路径。

### 全局约束

- 只改 `features/image/` 与对应样式/测试。不改 `blockDragGeometry.ts`、`markdownBlockBoundaries.ts`、`markdownBlockMove.ts`。
- 不改 `layoutEngine.ts` / `viewportLayout.ts` / `readingAnchor.ts`：本次不动滚动补偿层。
- 不新增用户文案，不涉及 `locales/renderer/**`。
- 缓存必须只存几何数字，**不得**存 blob URL、对象引用或任何跨文档身份（blob URL 会随 widget 一起被 revoke）。
- 断言用阈值 + 相对量，不写死 1090 这类像素值（会随主题、字号、面板宽度变化）。
- 改动后必须通过：`npm run check:markdown-architecture`、`npm run check:renderer-style-architecture`、`npm run smoke:markdown-block-drag`、新增的滚动稳定性门禁。

### 审查重点

1. **同一张图在两个面板里同时显示**——缓存键若只按资源路径，两个面板宽度不同，会互相污染高度。
2. **面板宽度改变后复访**——缓存里的高度是按旧宽度算的，缩窄后必须被重新测量覆盖，不能把旧值当真。
3. **图片加载失败**——不能把失败态的高度写进缓存，否则下次显示成空白大块。
4. **文档被清空/替换**——缓存不得让新文档里同名路径的图片用上旧高度。键里必须含文档路径。
5. **首次滚动到底**——允许一次增长，但**不允许**回退；这是本次修复的验收线。
6. **极长文档**——缓存不得无界增长，需要给它一个上限或按文档清理的时机。

---

### Task 1：复现门禁（先写失败测试）

**Files:**
- Create: `tests/fixtures/editor/formats/markdown/scroll-stability.html`
- Create: `tests/fixtures/editor/formats/markdown/scroll-stability.tsx`
- Create: `tests/integration/editor/formats/markdown/rendering/markdown-scroll-stability.smoke.mjs`
- Modify: `package.json`（新增 `smoke:markdown-scroll-stability`）

**Interfaces:**
- Produces（夹具方法，后续任务依赖）：
  - `window.scrollFixture.ready(): Promise<void>`
  - `window.scrollFixture.startSampling(): void` / `stopSampling(): Sample[]`
  - `window.scrollFixture.geometry(): { scrollTop; scrollHeight; clientHeight; maxScroll }`
  - `window.scrollFixture.lineHeights(): { line: number; inMap: number }[]`
  - `Sample = { frame; scrollTop; scrollHeight; clientHeight; images; placeholders }`

- [ ] **Step 1: 建夹具**

文档形状复刻本次现象：12 段短正文 + 5 张连续 1080×1620 图片。资源解析器支持 `?slow=1` 注入 450ms 延迟，用来模拟真实 JPEG 读取。

- [ ] **Step 2: 写失败场景**

```js
const scenarios = {
  async "wheeling to the end never scrolls back up"(page) {
    const samples = await page.wheelToEnd();
    let worst = 0;
    for (let index = 1; index < samples.length; index += 1) {
      worst = Math.min(worst, samples[index].scrollTop - samples[index - 1].scrollTop);
    }
    assert(worst >= -2, `scrollTop went back ${-worst}px while wheeling down`);
  },
  async "the document height only grows on a first pass"(page) {
    const samples = await page.wheelToEnd();
    const heights = samples.map(sample => Math.round(sample.scrollHeight));
    let worstDrop = 0;
    for (let index = 1; index < heights.length; index += 1) {
      worstDrop = Math.max(worstDrop, heights[index - 1] - heights[index]);
    }
    assert(worstDrop <= 8, `document height shrank ${worstDrop}px mid-scroll`);
  },
  async "an unmounted image line keeps its measured height"(page) {
    const measured = await page.call("lineHeights");
    await page.call("setScrollTop", 0); await sleep(600);
    const after = await page.call("lineHeights");
    const ratios = after.map((row, index) => row.inMap / measured[index].inMap);
    assert(Math.min(...ratios) >= 0.95, `line heights fell to ${Math.min(...ratios) * 100}% off screen`);
  },
};
```

- [ ] **Step 3: 跑一次，确认它失败**

Run: `npm run smoke:markdown-scroll-stability`
Expected: 前两条失败。典型信息为 `scrollTop went back 184px while wheeling down` 与 `document height shrank 990px mid-scroll`。**保存这次输出**，它是修复前的基线。

- [ ] **Step 4: 提交（红）**

```bash
git add tests/fixtures/editor/formats/markdown/scroll-stability.html \
        tests/fixtures/editor/formats/markdown/scroll-stability.tsx \
        tests/integration/editor/formats/markdown/rendering/markdown-scroll-stability.smoke.mjs \
        package.json
git commit -m "test(markdown): pin the scroll bounce at the end of image-heavy notes"
```

---

### Task 2：图片几何缓存

**Files:**
- Create: `src/shared-ui/editor/markdown/features/image/imageGeometryCache.ts`
- Test: `tests/unit/editor/formats/markdown/rendering/imageGeometryCache.test.ts`

**Interfaces:**
- Produces:
  - `export type MarkdownImageGeometry = Readonly<{ renderedHeight: number; aspectRatio: number }>`
  - `export function readMarkdownImageGeometry(documentPath: string, source: string): MarkdownImageGeometry | null`
  - `export function rememberMarkdownImageGeometry(documentPath: string, source: string, geometry: MarkdownImageGeometry): void`
  - `export function forgetMarkdownImageGeometry(documentPath: string): void`

实现要点：
- 键为 `${documentPath}\u0000${source}`，`source` 用 `resolveMarkdownMediaReference()` 的结果（稳定路径），**不是** blob URL。
- `aspectRatio` 存 `naturalHeight / naturalWidth`，供宽度变化时按比例重算。
- 条目数上限 500，超出按插入序淘汰最旧（`Map` 的迭代顺序即可）。
- 高度必须是有限正数，否则忽略写入；失败态不写。

- [ ] **Step 1: 写失败的测试**

```ts
it("keeps documents apart", () => {
  rememberMarkdownImageGeometry("a.md", "img/x.jpg", { renderedHeight: 1090, aspectRatio: 1.5 });
  expect(readMarkdownImageGeometry("b.md", "img/x.jpg")).toBeNull();
  expect(readMarkdownImageGeometry("a.md", "img/x.jpg")).toEqual({ renderedHeight: 1090, aspectRatio: 1.5 });
});

it("ignores non-positive heights", () => {
  rememberMarkdownImageGeometry("a.md", "img/x.jpg", { renderedHeight: 0, aspectRatio: 1 });
  expect(readMarkdownImageGeometry("a.md", "img/x.jpg")).toBeNull();
});

it("evicts the oldest entry past the cap", () => {
  for (let index = 0; index < 501; index += 1) {
    rememberMarkdownImageGeometry("a.md", `img/${index}.jpg`, { renderedHeight: 100 + index, aspectRatio: 1 });
  }
  expect(readMarkdownImageGeometry("a.md", "img/0.jpg")).toBeNull();
  expect(readMarkdownImageGeometry("a.md", "img/500.jpg")).not.toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/editor/formats/markdown/rendering/imageGeometryCache.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现缓存模块**

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 提交**

```bash
git add src/shared-ui/editor/markdown/features/image/imageGeometryCache.ts \
        tests/unit/editor/formats/markdown/rendering/imageGeometryCache.test.ts
git commit -m "feat(markdown): remember measured image geometry per document"
```

---

### Task 3：让图片 widget 报告缓存高度

**Files:**
- Modify: `src/shared-ui/editor/markdown/features/image/imagePreviewWidget.ts`
- Modify: `src/shared-ui/editor/markdown/features/image/imageFeature.ts`
- Test: `tests/component/editor/formats/markdown/rendering/markdownImageEstimatedHeight.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `readMarkdownImageGeometry` / `rememberMarkdownImageGeometry`。
- Produces: `ImagePreviewWidget.estimatedHeight: number`（无缓存时仍返回 `-1`，保持现有行为）。

实现要点：
- 构造参数增加两个只读字段：`geometryKey: { documentPath: string; source: string }` 与 `estimatedHeight: number`（构造时从缓存读一次，避免 getter 每帧查表）。
- `get estimatedHeight(): number { return this.estimatedHeightValue }`。
- `toDOM()` 里：若有估算高度，给 wrapper 设 `style.minHeight = \`${height}px\``，让加载占位占据同样的盒子；图片 `load` 之后在 `commitEditorLayout` 回调里测量真实高度并 `rememberMarkdownImageGeometry()`，同时清掉 `minHeight`。
- `error` 分支**不写**缓存。
- `eq()` 必须加入 `estimatedHeight`，否则缓存更新后 widget 不会被替换，高度永远是旧值。

- [ ] **Step 1: 写失败的组件测试**

```ts
it("reports a cached height before the image loads", () => {
  rememberMarkdownImageGeometry("note.md", "photo-1.svg", { renderedHeight: 1090, aspectRatio: 1.5 });
  const widget = buildImageWidget({ documentPath: "note.md", source: "photo-1.svg" });
  expect(widget.estimatedHeight).toBe(1090);
});

it("still declines to guess without a cache", () => {
  const widget = buildImageWidget({ documentPath: "note.md", source: "unknown.svg" });
  expect(widget.estimatedHeight).toBe(-1);
});

it("does not cache a failed load", async () => {
  await mountFailingImage({ documentPath: "note.md", source: "broken.svg" });
  expect(readMarkdownImageGeometry("note.md", "broken.svg")).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/component/editor/formats/markdown/rendering/markdownImageEstimatedHeight.test.ts`
Expected: FAIL，`estimatedHeight` 为 `-1` 或构造参数不存在。

- [ ] **Step 3: 实现 widget 改动**

- [ ] **Step 4: 跑组件测试与既有图片测试**

Run: `npx vitest run tests/component/editor/formats/markdown/rendering/ tests/component/editor/formats/markdown/embeds/`
Expected: 全绿。特别确认 `markdownSourceSnapshot.test.tsx`（widget 复用）与 `markdownMediaWorkspace.test.tsx`（`is-block` 判定）不受影响。

- [ ] **Step 5: 跑复现门禁，确认转绿**

Run: `npm run smoke:markdown-scroll-stability`
Expected: 三条场景全部通过。第一条的基线是 `went back 184px`，现在应 ≤ 2px。

- [ ] **Step 6: 提交（绿）**

```bash
git add src/shared-ui/editor/markdown/features/image/imagePreviewWidget.ts \
        src/shared-ui/editor/markdown/features/image/imageFeature.ts \
        tests/component/editor/formats/markdown/rendering/markdownImageEstimatedHeight.test.ts
git commit -m "fix(markdown): keep image lines at their measured height off screen"
```

---

### Task 4：宽度变化与失败态回归

**Files:**
- Modify: `tests/integration/editor/formats/markdown/rendering/markdown-scroll-stability.smoke.mjs`

**Interfaces:**
- Consumes: 前三个任务。

- [ ] **Step 1: 追加三条场景**

```js
async "a narrowed pane re-measures instead of keeping the old height"(page) {
  await page.wheelToEnd();
  const before = await page.call("lineHeights");
  page.window.setContentSize(520, 760); await sleep(500);
  const after = await page.call("lineHeights");
  // A narrower rail makes the image taller, never shorter.
  assert(after[0].inMap > before[0].inMap, "the image line kept a height from the wider pane");
},

async "a failed image does not reserve a tall box"(page) {
  await page.call("setDocument", "broken.md");
  await page.call("setScrollTop", 0); await sleep(600);
  const heights = await page.call("lineHeights");
  assert(heights.every(row => row.inMap < 200), `a failed image reserved ${heights[0]?.inMap}px`);
},

async "wheeling to the end twice stays smooth"(page) {
  await page.wheelToEnd();
  await page.call("setScrollTop", 0); await sleep(400);
  const second = await page.wheelToEnd();
  let worstDrop = 0;
  for (let index = 1; index < second.length; index += 1) {
    worstDrop = Math.max(worstDrop, Math.round(second[index - 1].scrollHeight - second[index].scrollHeight));
  }
  assert(worstDrop <= 8, `the second pass shrank ${worstDrop}px`);
},
```

- [ ] **Step 2: 跑全量**

Run: `npm run smoke:markdown-scroll-stability && npm run smoke:markdown-block-drag`
Expected: 两条都全绿。第二条是既有回归，确认拖拽手柄没有受影响。

- [ ] **Step 3: 提交**

```bash
git add tests/integration/editor/formats/markdown/rendering/markdown-scroll-stability.smoke.mjs
git commit -m "test(markdown): cover image height across resize and failed loads"
```

---

### Task 5：交付门禁

- [ ] **Step 1: 跑架构与本地化门禁**

Run: `npm run check:markdown-architecture && npm run check:renderer-style-architecture && npm run check:localization`
Expected: 全部退出码 0。

- [ ] **Step 2: 用真实笔记目视验证**

打开 `/Users/herbert/[H LNote]/[随笔]/20230506 观《这么多年》.md`（**只读**，不要修改），从顶部一路滚到最后一张图片，确认：滚到底部时不再回弹，最后一张图可以完整停留并读完。

- [ ] **Step 3: 汇报**

按 `AGENTS.md` 报告：活动分支、剩余工作树、执行的验证命令与结果。

---

## 七、风险与边界

| 风险 | 说明 | 缓解 |
|---|---|---|
| 缓存高度与实际不符 | 主题字号、面板宽度改变后旧值可能偏小或偏大 | 只在"未挂载"时使用；一旦挂载即重新测量并覆盖；Task 4 第一条场景专门锁这个 |
| 首次经过仍会增长 | 与对照实验一致（`1469 → 6820`），发生在读者下方 | 允许。若产品要求零增长，再评估"预取尺寸"增强 |
| 多面板同图不同宽 | 两个面板宽度不同，按路径共享缓存会互相污染 | 缓存只存 `aspectRatio` + 上次渲染高度；宽度变化触发重测。若实测仍有串扰，把面板宽度并入键 |
| 与既有拖拽/选中逻辑交互 | 图片行高度变化会影响块边界判定 | Task 4 Step 2 回归 `smoke:markdown-block-drag` |
| 长文档内存 | 缓存条目累积 | Task 2 已设 500 条上限 + 按文档清理入口 |

---

## 八、验收口径

修复成立需要同时满足：

1. 从顶部滚轮滚到文末，`scrollTop` 任何一帧都不回退超过 2px。
2. 滚动过程中 `scrollHeight` 不出现大于 8px 的缩水。
3. 图片行离开视口后，在高度图里的高度不低于实测值的 95%。
4. 面板缩窄后，图片行高度随之变大（重新测量生效）。
5. 图片加载失败时不预留高大盒子。
6. 第二次滚到底部的表现与第一次一致。
7. `smoke:markdown-block-drag` 全部通过（拖拽手柄无回归）。

---

## 九、附：为什么这不是"最后一张图"特有的问题

现象只在最后一张图上被注意到，是因为那是读者唯一必须停在最底部才能看完的位置。同一篇笔记里任意一段连续竖图，只要单张渲染高度超过可视区，都会触发同样的抖动——只是读者不会停在中间去察觉。

顺带一提：上一份计划 `05-image-block-handle.md` 修的是同一族缺陷的另一面。那一份处理"图片行的行盒里多出幽灵行"，这一份处理"图片行离开视口后高度丢失"。两者都指向同一件事：**图片行在 CodeMirror 里的几何量没有被稳定地表达出来**。完成这两项之后，可以考虑把"图片行几何"作为一个显式契约收进 image feature，避免第三处同类问题再从这里长出来。
