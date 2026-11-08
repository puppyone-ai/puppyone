# 03 · HTML 看板 → Markdown 深链实施计划

> **面向执行者：** 用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 逐任务执行。步骤用 `- [ ]` 勾选跟踪。

**目标：** 工作区里的 HTML 看板点击「打开」按钮，应用切换到对应的 Markdown 文件（可选定位到某个标题）；HTML 里其他任何跳转都不被授予应用导航能力。

**架构：** HTML 页面跑在沙箱 iframe 里（`sandbox="allow-scripts allow-forms allow-modals allow-downloads allow-popups"`）。现有一条受控通道已经在用：`htmlPageViewportScript` 注入固定脚本，向父窗口发 `{type:'puppyone-html-viewport', channel, x, y}`，宿主用 `event.source === frame.contentWindow` 加随机 `channel` 双重校验。本计划**照搬这个范式**：注入第二段固定脚本，把「用户点击了一个指向工作区文档的链接」这一意图以同样的校验方式送到父窗口，再交给已有的 `DocumentNavigationPort` 去解析和打开。

**关键安全立场：** 页面里的脚本是**不可信内容**。它只能表达「我想打开这个相对路径」，不能指定绝对路径、URL scheme、或者直接调用宿主 API。宿主侧必须重新解析、校验扩展名、确认文件存在于当前工作区，然后才打开。

**技术栈：** TypeScript、React 18、`parse5`（已有的 HTML 投影依赖）、Vitest。

**规格来源：** `plan/README.md` 第二、三节。

---

## 全局约束

- **不放松任何现有沙箱属性。** `getHtmlPreviewPolicy` 的 `sandbox` 与 CSP 一行都不改。深链能力靠消息通道实现，不靠扩大页面权限。
- **不新增 `allow-same-origin`、`allow-top-navigation`。** 这两项会让沙箱页面与特权壳同源，是明确禁止的（见 `electron/main/security.mjs` 的 `shouldBlockEmbeddedFrameNavigation`）。
- 注入脚本必须是**固定字符串常量**，不拼接页面内容。通道标识用随机 UUID，与现有 `viewportChannel` 同源同生命周期。
- 打开的路径必须经过 `DocumentNavigationPort`，不得在 HTML 查看器里直接调 `dataPort.readFile` 或改 tab 状态。
- 所有用户可见文案走 `locales/renderer/<lang>/*.json`。
- 改动后必须通过：`npm run check:viewer-contract`、`npm run check:data-ui-boundaries`、`npm run check:markdown-architecture`、`npm run check:renderer-style-architecture`。
- 测试落在 `tests/unit/editor/formats/html/` 与 `tests/component/editor/formats/html/`。

## 审查重点

1. **HTML 里写绝对路径** —— `<a href="/etc/passwd">` 或 `href="../../outside.md"`，必须被拒绝，不得跳出工作区根。
2. **伪装成文档的路径** —— `href="a.md.exe"`、`href="a.md?x=1#y"`（query/fragment 要剥离后再判扩展名）。
3. **外部链接** —— `href="https://example.com"` 必须**不**被深链桥接管；它应当继续走现有的外链策略。
4. **`javascript:` 与 `data:`** —— 必须拒绝，且不得抛异常导致桥整体失效。
5. **页面自己的 JS 伪造消息** —— 恶意页面直接 `parent.postMessage({type:'puppyone-html-open-document', ...})`，因为 `channel` 是它拿不到的（脚本闭包里），伪造消息必须被静默丢弃。
6. **同一个 HTML 文件里多个按钮** —— 各自指向不同的 `.md`，都要正确打开，不能只认第一个。
7. **锚点** —— `href="topics/foo.md#证据"` 要打开文件并尽量滚到该标题；标题不存在时打开文件但不报错。

---

### Task 1：消息协议的定义与解码

**Files:**
- Modify: `src/shared-ui/editor/viewers/html/htmlBridgeProtocol.ts`
- Test: `tests/unit/editor/formats/html/htmlOpenDocumentProtocol.test.ts`

**Interfaces:**
- Produces:
  - `export type HtmlOpenDocumentMessage = Readonly<{ type: "puppyone-html-open-document"; channel: string; target: string; }>`
  - `export function decodeHtmlOpenDocumentMessage(value: unknown, expectedChannel: string): HtmlOpenDocumentMessage | null`

解码规则（写死，测试锁定）：
- `value` 非对象 → `null`。
- `type !== "puppyone-html-open-document"` → `null`。
- `channel` 必须严格等于 `expectedChannel`（字符串比较，长度上限 64）→ 否则 `null`。这是防伪造的核心。
- `target` 必须是字符串，长度 `1..2048`，不含控制字符（`\u0000-\u001f\u007f`），不含反斜杠。
- 满足以上全部才返回冻结对象。

**注意**：这个文件已存在（当前导出 `HtmlBridgeMessage` 相关类型与 `decodeHtmlBridgeMessage`）。新增导出，不改动已有函数，避免影响视觉编辑链路。

- [ ] **Step 1: 写失败的测试**

```ts
// tests/unit/editor/formats/html/htmlOpenDocumentProtocol.test.ts
import { describe, expect, it } from "vitest";
import { decodeHtmlOpenDocumentMessage } from "../../../../../src/shared-ui/editor/viewers/html/htmlBridgeProtocol";

const channel = "11111111-2222-3333-4444-555555555555";
const message = (overrides: Record<string, unknown> = {}) => ({
  type: "puppyone-html-open-document",
  channel,
  target: "topics/foo.md",
  ...overrides,
});

describe("decodeHtmlOpenDocumentMessage", () => {
  it("accepts a well-formed message with the expected channel", () => {
    expect(decodeHtmlOpenDocumentMessage(message(), channel)).toEqual({
      type: "puppyone-html-open-document",
      channel,
      target: "topics/foo.md",
    });
  });

  it("rejects a forged message with the wrong channel", () => {
    expect(decodeHtmlOpenDocumentMessage(message({ channel: "guess" }), channel)).toBeNull();
  });

  it("rejects a missing channel", () => {
    expect(decodeHtmlOpenDocumentMessage({ ...message(), channel: undefined }, channel)).toBeNull();
  });

  it("rejects control characters and backslashes in the target", () => {
    expect(decodeHtmlOpenDocumentMessage(message({ target: "a\u0000.md" }), channel)).toBeNull();
    expect(decodeHtmlOpenDocumentMessage(message({ target: "..\\a.md" }), channel)).toBeNull();
  });

  it("rejects an empty or oversized target", () => {
    expect(decodeHtmlOpenDocumentMessage(message({ target: "" }), channel)).toBeNull();
    expect(decodeHtmlOpenDocumentMessage(message({ target: "a".repeat(2049) }), channel)).toBeNull();
  });

  it("rejects unrelated message types", () => {
    expect(decodeHtmlOpenDocumentMessage({ type: "viewport", x: 1, y: 2 }, channel)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/editor/formats/html/htmlOpenDocumentProtocol.test.ts`
Expected: FAIL —— `decodeHtmlOpenDocumentMessage` 未导出。

- [ ] **Step 3: 实现**

按上述规则实现，与同文件已有的 `decodeHtmlBridgeMessage` 保持同样的「逐字段校验后返回冻结对象」风格。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/editor/formats/html/htmlOpenDocumentProtocol.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/shared-ui/editor/viewers/html/htmlBridgeProtocol.ts \
        tests/unit/editor/formats/html/htmlOpenDocumentProtocol.test.ts
git commit -m "feat(html): define the open-document bridge message"
```

---

### Task 2：注入侧的固定脚本

**Files:**
- Modify: `src/shared-ui/editor/viewers/html/htmlPageViewport.ts`
- Test: `tests/unit/editor/formats/html/htmlOpenDocumentScript.test.ts`

**Interfaces:**
- Produces: `export function htmlOpenDocumentScript(channel: string): string`

脚本行为（全部是固定代码，页面内容无法注入）：
1. 捕获阶段监听 `click`。
2. 从 `event.target` 向上找最近的 `<a href>` 或 `[data-puppyone-open]`。
3. 取值优先级：`data-puppyone-open` 属性值 > `anchor.getAttribute("href")`（**用 `getAttribute` 取原始值**，不用 `.href`，因为后者会被 `<base>` 解析成绝对 URL）。
4. 过滤：为空、以 `#` 开头、匹配 `/^[a-z][a-z0-9+.-]*:/i`（协议）、或以 `//` 开头 —— 一律放行给浏览器默认行为（不 `preventDefault`），不发送消息。
5. 其余认为是工作区内相对路径：`event.preventDefault(); event.stopPropagation();` 然后 `parent.postMessage({ type: 'puppyone-html-open-document', channel, target }, '*')`。
6. 用 `try/catch` 包住整个处理，任何异常都不得中断页面本身的交互。

脚本形式与 `htmlPageViewportScript` 一致：返回 `<script>(()=>{...})();</script>` 字符串。

- [ ] **Step 1: 写失败的测试**

```ts
// tests/unit/editor/formats/html/htmlOpenDocumentScript.test.ts
import { describe, expect, it, vi } from "vitest";
import { htmlOpenDocumentScript } from "../../../../../src/shared-ui/editor/viewers/html/htmlPageViewport";

function runScript(channel: string, html: string) {
  const posted: unknown[] = [];
  const parent = { postMessage: (value: unknown) => posted.push(value) };
  const body = html;
  document.body.innerHTML = body;
  // 用 Function 构造隔离执行，注入 fake window.parent
  const source = htmlOpenDocumentScript(channel)
    .replace(/^<script>/, "").replace(/<\/script>$/, "");
  new Function("parent", "window", source)(parent, window);
  return posted;
}

describe("htmlOpenDocumentScript", () => {
  it("posts a workspace-relative document target on click", () => {
    const channel = "chan-1";
    const posted = runScript(channel, `<a id="open" href="topics/foo.md">Open</a>`);
    document.getElementById("open")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(posted).toEqual([{ type: "puppyone-html-open-document", channel, target: "topics/foo.md" }]);
  });

  it("prefers the data attribute over href", () => {
    const channel = "chan-2";
    const posted = runScript(channel,
      `<a id="open" href="ignored.md" data-puppyone-open="real.md">Open</a>`);
    document.getElementById("open")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect((posted[0] as { target: string }).target).toBe("real.md");
  });

  it("ignores external, fragment and protocol URLs", () => {
    const channel = "chan-3";
    const posted = runScript(channel, `
      <a id="ext" href="https://example.com">ext</a>
      <a id="frag" href="#section">frag</a>
      <a id="js" href="javascript:alert(1)">js</a>
    `);
    for (const id of ["ext", "frag", "js"]) {
      document.getElementById(id)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    expect(posted).toEqual([]);
  });

  it("is inert when the click lands outside any link", () => {
    const channel = "chan-4";
    const posted = runScript(channel, `<p id="text">plain</p>`);
    document.getElementById("text")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(posted).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/editor/formats/html/htmlOpenDocumentScript.test.ts`
Expected: FAIL —— 函数未导出。

- [ ] **Step 3: 实现**

在 `htmlPageViewport.ts` 里新增导出函数，沿用该文件已有的 `String.raw` 风格。`channel` 通过 `JSON.stringify(channel)` 嵌入，和 `htmlPageViewportScript` 完全一致的做法。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/editor/formats/html/htmlOpenDocumentScript.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/shared-ui/editor/viewers/html/htmlPageViewport.ts \
        tests/unit/editor/formats/html/htmlOpenDocumentScript.test.ts
git commit -m "feat(html): inject a link-intent bridge into the preview frame"
```

---

### Task 3：宿主侧的接收与目标校验

**Files:**
- Create: `src/shared-ui/editor/viewers/html/htmlOpenDocumentIntent.ts`
- Test: `tests/unit/editor/formats/html/htmlOpenDocumentIntent.test.ts`

**Interfaces:**
- Produces:
  - `export type HtmlDocumentOpenIntent = Readonly<{ target: string; anchor: string | null; }> | null`
  - `export function parseHtmlDocumentOpenTarget(raw: string): HtmlDocumentOpenIntent`

这是**纯函数**，把桥送来的原始字符串收敛成两种结果：可交给导航端口的 `{ target, anchor }`，或 `null`（拒绝）。

规则（写死，测试锁定）：
1. `trim()` 后为空 → `null`。
2. 含 `#` 时按**第一个** `#` 切分，前半为 `target`，后半为 `anchor`（保留原文，不做解码）。
3. `target` 为空字符串时（例如 `"#证据"`）→ `null`（纯锚点不是跨文档跳转）。
4. `target` 以 `?` 结尾或含 `?` → 丢弃 query 部分（`?` 之后到 `#` 之前）。注意顺序：先切 `#`，再切 `?`。
5. 拒绝：以 `/` 开头（工作区绝对路径在这个上下文里不可信）、以 `//` 开头、匹配 `/^[a-z][a-z0-9+.-]*:/i`、含 `..` 段。
6. 拒绝扩展名不在 `md / markdown / mdx / txt / html` 之列的目标（大小写不敏感）。**只放行文档**，不放行图片、可执行文件、压缩包。
7. 通过则返回冻结对象。

第 5 条要特别注意：`..` 段检测是按 `/` 切分后逐段比较，而不是字符串 `includes("..")`，否则 `a..b.md` 会被误杀。

- [ ] **Step 1: 写失败的测试**

```ts
// tests/unit/editor/formats/html/htmlOpenDocumentIntent.test.ts
import { describe, expect, it } from "vitest";
import { parseHtmlDocumentOpenTarget } from "../../../../../src/shared-ui/editor/viewers/html/htmlOpenDocumentIntent";

describe("parseHtmlDocumentOpenTarget", () => {
  it("accepts a plain workspace-relative document", () => {
    expect(parseHtmlDocumentOpenTarget("topics/foo.md")).toEqual({ target: "topics/foo.md", anchor: null });
  });

  it("splits a heading anchor", () => {
    expect(parseHtmlDocumentOpenTarget("topics/foo.md#证据")).toEqual({
      target: "topics/foo.md", anchor: "证据",
    });
  });

  it("drops the query string", () => {
    expect(parseHtmlDocumentOpenTarget("topics/foo.md?plain=1#a")).toEqual({
      target: "topics/foo.md", anchor: "a",
    });
  });

  it("rejects absolute, protocol and traversal targets", () => {
    expect(parseHtmlDocumentOpenTarget("/etc/passwd.md")).toBeNull();
    expect(parseHtmlDocumentOpenTarget("//evil.example/a.md")).toBeNull();
    expect(parseHtmlDocumentOpenTarget("javascript:alert(1)")).toBeNull();
    expect(parseHtmlDocumentOpenTarget("../../outside.md")).toBeNull();
    expect(parseHtmlDocumentOpenTarget("a/../../b.md")).toBeNull();
  });

  it("rejects non-document extensions", () => {
    expect(parseHtmlDocumentOpenTarget("a.exe")).toBeNull();
    expect(parseHtmlDocumentOpenTarget("a.png")).toBeNull();
    expect(parseHtmlDocumentOpenTarget("a")).toBeNull();
  });

  it("does not mistake a doubled dot inside a name for traversal", () => {
    expect(parseHtmlDocumentOpenTarget("a..b.md")).toEqual({ target: "a..b.md", anchor: null });
  });

  it("rejects a fragment-only target", () => {
    expect(parseHtmlDocumentOpenTarget("#only-anchor")).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/editor/formats/html/htmlOpenDocumentIntent.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

纯函数，按七条规则顺序实现。`anchor` 为空字符串时归一为 `null`。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/editor/formats/html/htmlOpenDocumentIntent.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/shared-ui/editor/viewers/html/htmlOpenDocumentIntent.ts \
        tests/unit/editor/formats/html/htmlOpenDocumentIntent.test.ts
git commit -m "feat(html): validate document open intents from the frame"
```

---

### Task 4：在预览里接线

**Files:**
- Modify: `src/shared-ui/editor/viewers/html/HtmlPreviewFrame.tsx`
- Modify: `src/shared-ui/editor/viewers/html/HtmlViewer.tsx`
- Test: `tests/component/editor/formats/html/htmlPreviewOpenDocument.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `decodeHtmlOpenDocumentMessage`、Task 2 的 `htmlOpenDocumentScript`、Task 3 的 `parseHtmlDocumentOpenTarget`；已有的 `DocumentNavigationPort`。
- Produces:
  - `HtmlPreviewFrame` 新增 prop：`onOpenDocument?: (intent: { target: string; anchor: string | null }) => void;`
  - `HtmlViewer` 从 `context.documentNavigation` 取端口，构造 `onOpenDocument`。

接线步骤：
1. `buildHtmlPreviewDocument(rawHtml, baseHref, policy, viewportChannel)` 增加第 5 个参数 `documentChannel?: string`，把 `htmlOpenDocumentScript(documentChannel)` 与 `htmlPageViewportScript` 一起 push 进 `<body>`。两者独立，都有一个就注入一个。
2. `HtmlPreviewFrame` 里新增 `const [documentChannel] = useState(() => crypto.randomUUID())`，与现有 `viewportChannel` 并列。
3. 新增一个 `useEffect` 监听 `window` 的 `message`：先校验 `event.source === frame.current?.contentWindow`，再 `decodeHtmlOpenDocumentMessage(event.data, documentChannel)`，拿到消息后调 `parseHtmlDocumentOpenTarget`，通过则 `onOpenDocument?.(intent)`。
4. `HtmlViewer` 里：**注意 `HtmlViewerProps` 目前是 `Pick<PresetViewerRenderContext, ...>` 的白名单**（`HtmlViewer.tsx:20-21`），没有 `documentNavigation`。必须先把 `"documentNavigation"` 加进这个 `Pick` 列表，否则拿不到端口：

```tsx
type HtmlViewerProps = Pick<PresetViewerRenderContext, "document" | "content" | "fileUrl" | "fileUrlLoading"
  | "fileUrlError" | "loading" | "error" | "htmlTrustMode" | "canEdit" | "hideSourceView"
  | "documentNavigation">;
```

然后：

```tsx
const navigation = props.documentNavigation ?? null;
const onOpenDocument = useCallback((intent: { target: string; anchor: string | null }) => {
  if (!navigation || !props.document.path) return;
  const reference = navigation.resolveReference(props.document.path, intent.target);
  if (!reference || !navigation.canOpenReference(reference)) return;
  void navigation.openReference(reference);
}, [navigation, props.document.path]);
```
注意 `resolveReference` 的第二个参数是 `rawValue`，它内部会走 `parseDocumentReferenceIntent`；传 `intent.target`（已剥离锚点和 query 的相对路径）即可。

**为什么锚点暂时不用于滚动：** `DocumentNavigationPort` 当前只承载「打开哪个文档」，没有「打开后滚到哪个标题」的表达。Task 6 单独处理。本任务先保证文件被正确打开，锚点原样传下去但不消费。

- [ ] **Step 1: 写失败的测试**

```tsx
// tests/component/editor/formats/html/htmlPreviewOpenDocument.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { HtmlPreviewFrame } from "../../../../../../src/shared-ui/editor/viewers/html/HtmlPreviewFrame";
// 渲染 HtmlPreviewFrame（content 为一段含 <a href="topics/foo.md"> 的 HTML），
// 通过 iframe.contentWindow.postMessage 模拟桥消息，断言 onOpenDocument 被调用一次且参数正确。
// 另用伪造 channel 再发一次，断言未被调用。
```

测试里的 `contentWindow` 在 jsdom 中可用；若不可用，退化为直接调用导出的 `decodeHtmlOpenDocumentMessage` 并把宿主 effect 的逻辑抽成可测函数 `handleOpenDocumentMessage(event, frame, channel)`，对其做单测。**优先采用后者的抽函数方式**，避免依赖 jsdom 的 iframe 消息路由。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/component/editor/formats/html/htmlPreviewOpenDocument.test.tsx`
Expected: FAIL —— prop 与处理器不存在。

- [ ] **Step 3: 实现接线**

按上述四步实现。**不要**改动 `getHtmlPreviewPolicy` 的任何返回值。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/component/editor/formats/html/ tests/unit/editor/formats/html/`
Expected: PASS。

- [ ] **Step 5: 校验 viewer 契约**

Run: `npm run check:viewer-contract`
Expected: 通过。若因新增 prop 报错，按脚本提示登记到对应的契约声明处。

- [ ] **Step 6: 提交**

```bash
git add src/shared-ui/editor/viewers/html/HtmlPreviewFrame.tsx \
        src/shared-ui/editor/viewers/html/HtmlViewer.tsx \
        tests/component/editor/formats/html/htmlPreviewOpenDocument.test.tsx
git commit -m "feat(html): open workspace documents from a preview click"
```

---

### Task 5：让 `<base target="_self">` 不再把文档跳转吞进 iframe

**Files:**
- Modify: `src/shared-ui/editor/viewers/html/HtmlPreviewFrame.tsx`（`buildHtmlPreviewDocument` 内）
- Test: `tests/unit/editor/formats/html/htmlPreviewBaseTarget.test.ts`

**背景：** 现在是 `linkTarget: "_self"`，意味着所有链接都在 iframe 内部导航。对 `.md` 相对链接，这会让 iframe 尝试加载一个 Markdown 文件（通常失败或显示源码），用户体验是「点了没反应」。Task 2 的桥会在 `click` 上 `preventDefault`，理论上够用，但**键盘回车激活、`target` 属性、以及页面自己的脚本调用 `location.href` 都不走 click 事件**。

因此增加一层：在注入的样式/脚本之外，让 `buildHtmlPreviewDocument` 对 `<a>` 标签做一次静态标记 —— 凡是 `href` 不以协议或 `#` 开头、且扩展名是文档类型的锚点，加 `data-puppyone-open` 属性（值取原始 href）。这样它们既被 Task 2 的桥识别（优先级高于 href），也不会因为 `<base>` 解析而出错。

**这是本计划唯一触及 HTML 文档结构的一步**，必须保持「只加属性、不删节点、不改文本」的最小改动原则。

- [ ] **Step 1: 写失败的测试**

```ts
// tests/unit/editor/formats/html/htmlPreviewBaseTarget.test.ts
import { describe, expect, it } from "vitest";
import { markPreviewDocumentLinks } from "../../../../../src/shared-ui/editor/viewers/html/HtmlPreviewFrame";

describe("markPreviewDocumentLinks", () => {
  it("marks workspace-relative document links", () => {
    const out = markPreviewDocumentLinks(`<a href="topics/foo.md">Open</a>`);
    expect(out).toContain('data-puppyone-open="topics/foo.md"');
  });

  it("leaves external links untouched", () => {
    const out = markPreviewDocumentLinks(`<a href="https://example.com">ext</a>`);
    expect(out).not.toContain("data-puppyone-open");
  });

  it("leaves fragment links untouched", () => {
    const out = markPreviewDocumentLinks(`<a href="#s">jump</a>`);
    expect(out).not.toContain("data-puppyone-open");
  });

  it("does not mark non-document files", () => {
    const out = markPreviewDocumentLinks(`<a href="a.png">img</a>`);
    expect(out).not.toContain("data-puppyone-open");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/editor/formats/html/htmlPreviewBaseTarget.test.ts`
Expected: FAIL —— `markPreviewDocumentLinks` 未导出。

- [ ] **Step 3: 实现**

把「是否是可深链文档目标」的判断抽成 `isOpenableDocumentTarget(raw: string): boolean`，与 Task 3 的 `parseHtmlDocumentOpenTarget` 共用规则（Task 3 里已经实现了这套判断，这里直接 import 复用，**不要**复制第二份）。`markPreviewDocumentLinks(html: string): string` 用 `parse5` 遍历（与同文件已有做法一致），给匹配的 `<a>` 加属性后 `serialize`。

**注意**：`buildHtmlPreviewDocument` 已经做了一次 parse5 解析，为了不在热路径上解析两遍，实际实现应把标记逻辑合并进那次遍历，`markPreviewDocumentLinks` 只作为可测的独立入口被单测调用，生产路径复用同一份判断函数。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/editor/formats/html/`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/shared-ui/editor/viewers/html/HtmlPreviewFrame.tsx \
        tests/unit/editor/formats/html/htmlPreviewBaseTarget.test.ts
git commit -m "feat(html): mark workspace document links in the preview projection"
```

---

### Task 6：打开后定位到标题（可选增强）

**Files:**
- Modify: `src/shared-ui/editor/navigation/documentNavigation.ts`
- Modify: `src/shared-ui/data/DataWorkspace.tsx`
- Modify: `src/shared-ui/editor/markdown/MarkdownViewer.tsx`
- Modify: `src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor.tsx`（新增 `revealHeadingAnchor` prop）
- Test: `tests/unit/editor/formats/markdown/links/documentNavigationAnchor.test.ts`

**Interfaces:**
- `DocumentWorkspaceReference` 新增字段：`anchor: string | null`（从 `parseDocumentReferenceIntent` 的 target 里拆出 `#` 之后的部分）。
- `DocumentNavigationOptions` 新增：`openWorkspaceCandidateAt?: (path: string, anchor: string | null) => void | Promise<void>`；未提供时回落到 `openWorkspaceCandidates([path])`。
- `MarkdownCodeMirrorEditor` 新增：`revealAnchor?: string | null;` —— 当它变化时，在该文档的标题里找 `plainTitle === revealAnchor` 或归一化后相等的第一个，`scrollMarkdownViewToHeading` 过去。

**这一任务可以不做。** 若时间紧张，跳过它，功能仍然成立：点击打开文件，只是不滚到标题。计划把它单列就是为了让你能明确地砍掉。

- [ ] **Step 1: 写失败的测试**

覆盖两点：(a) `resolveReference("a.md", "b.md#证据")` 返回的引用带 `anchor: "证据"`；(b) 未提供 `openWorkspaceCandidateAt` 时 `openReference` 仍调用 `openWorkspaceCandidates`。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/editor/formats/markdown/links/documentNavigationAnchor.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

按上述接口实现。`revealAnchor` 的匹配要做归一化：去掉首尾空白、把连续空白折叠成一个空格，再比较。找不到就静默跳过。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/editor/formats/markdown/links/`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/shared-ui/editor/navigation/documentNavigation.ts \
        src/shared-ui/data/DataWorkspace.tsx \
        src/shared-ui/editor/markdown/MarkdownViewer.tsx \
        src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor.tsx \
        tests/unit/editor/formats/markdown/links/documentNavigationAnchor.test.ts
git commit -m "feat(navigation): reveal a heading anchor after opening a document"
```

---

### Task 7：安全回归与整体验证

- [ ] **Step 1: 写安全回归测试**

新增 `tests/architecture/editor/htmlPreviewNavigationBoundary.test.ts`，断言三件事，用源码文本断言即可：

1. `getHtmlPreviewPolicy` 返回的 `sandbox` 字符串中**不包含** `allow-same-origin` 与 `allow-top-navigation`。
2. `htmlOpenDocumentScript` 与 `htmlPageViewportScript` 的产物中**不包含**页面传入的任何变量插值（除 `channel`）。
3. `HtmlPreviewFrame.tsx` 中不存在 `dataTransfer`、`clipboard`、`ipcRenderer` 等宿主能力引用。

- [ ] **Step 2: 运行安全测试**

Run: `npx vitest run tests/architecture/editor/htmlPreviewNavigationBoundary.test.ts`
Expected: PASS。若第 1 条失败，说明有人放松了沙箱，必须先回退。

- [ ] **Step 3: 跑全量相关检查**

```bash
npm run check:viewer-contract
npm run check:data-ui-boundaries
npm run check:markdown-architecture
npm run check:localization
npx vitest run tests/unit/editor/formats/html tests/component/editor/formats/html
```

Expected: 全绿。

- [ ] **Step 4: 手工验收**

准备一个工作区：

```
board/kanban.html      ← 含几个 <a href="../topics/foo.md"> 的卡片
topics/foo.md          ← 至少 3 个标题
topics/bar.md
outside.txt
```

`npm run dev` 后依次验证：

1. 打开 `board/kanban.html`，点第一张卡片的「Open」→ 切到 `topics/foo.md`。
2. 点第二张卡片 → 切到 `topics/bar.md`（验证不是只认第一个）。
3. 在 HTML 里加一个 `<a href="https://example.com">`，点击 → 走外链策略，不改变当前文档。
4. 在 HTML 里加 `<a href="../../outside.md">`，点击 → 无反应，控制台无报错。
5. 在 HTML 里加一段 `<script>parent.postMessage({type:'puppyone-html-open-document',channel:'guess',target:'topics/foo.md'},'*')</script>`，点击页面 → 不触发任何跳转（channel 不匹配被丢弃）。
6. 若实现了 Task 6：点 `<a href="topics/foo.md#标题二">` → 打开文件并滚到「标题二」。

- [ ] **Step 5: 提交并报告**

```bash
git add tests/architecture/editor/htmlPreviewNavigationBoundary.test.ts
git commit -m "test(html): pin the preview navigation boundary"
```

报告内容：改动文件清单、安全回归测试的实际输出、手工验收六条的逐条结果、以及 Task 6 是否执行。
