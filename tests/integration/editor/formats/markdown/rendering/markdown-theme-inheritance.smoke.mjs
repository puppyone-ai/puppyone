#!/usr/bin/env electron

import { app, BrowserWindow } from "electron";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const indexPath = path.join(repoRoot, "dist", "index.html");
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-markdown-theme-inheritance-"));
app.setPath("userData", path.join(tempRoot, "user-data"));
app.commandLine.appendSwitch("disable-gpu");

const windows = [];

async function runSmoke() {
  await fsp.access(indexPath);
  const followTheme = await runScenario("theme");
  assert(followTheme.before.editorContentFontMode === "follow-theme", "Follow-theme scenario started with a user font override.");
  assert(
    followTheme.after.fontFamily.includes("PuppyOne PT Serif")
      && followTheme.after.fontFamily.includes("Songti SC"),
    `Newspaper did not reach the mounted Markdown editor: ${followTheme.after.fontFamily}`,
  );
  assert(
    followTheme.after.hostFont.includes("PuppyOne PT Serif")
      && followTheme.after.hostFont.includes("Songti SC"),
    `Newspaper host font token was not projected: ${followTheme.after.hostFont}`,
  );
  assert(followTheme.preservedHost, "Changing Sub Theme remounted the Markdown editor.");
  assert(
    followTheme.after.fontFamily !== followTheme.before.fontFamily,
    "Mounted Markdown typography did not react to the Sub Theme change.",
  );
  assertMarkdownLinkCursors(followTheme.before);
  assertMarkdownLinkCursors(followTheme.after);
  assertMarkdownContentColors(followTheme.before);
  assertMarkdownContentColors(followTheme.after);
  assertMarkdownLinkDrag(followTheme.dragGesture);

  const explicitSystem = await runScenario("system");
  assert(
    explicitSystem.before.editorContentFontMode === "explicit"
      && explicitSystem.before.editorContentFont === "builtin:system-sans",
    "Explicit-font scenario did not publish its override identity.",
  );
  assert(
    !explicitSystem.after.fontFamily.includes("PuppyOne PT Serif")
      && explicitSystem.after.fontFamily.includes("system-ui"),
    `Explicit Markdown font did not retain precedence: ${explicitSystem.after.fontFamily}`,
  );
  assert(
    explicitSystem.after.hostFont.includes("PuppyOne PT Serif"),
    "Newspaper host token disappeared when a user override was active.",
  );
  assert(explicitSystem.preservedHost, "Explicit-font theme change remounted the Markdown editor.");
  assertMarkdownLinkCursors(explicitSystem.before);
  assertMarkdownLinkCursors(explicitSystem.after);
  assertMarkdownContentColors(explicitSystem.before);
  assertMarkdownContentColors(explicitSystem.after);
  assertMarkdownLinkDrag(explicitSystem.dragGesture);

  console.log(JSON.stringify({ followTheme, explicitSystem }, null, 2));
}

async function runScenario(font) {
  const window = new BrowserWindow({
    show: false,
    width: 900,
    height: 620,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windows.push(window);
  const url = pathToFileURL(indexPath);
  url.searchParams.set("font", font);
  url.hash = "markdown-theme-inheritance-smoke";
  await window.loadURL(url.toString());
  await waitForReady(window);

  const before = {
    ...await readSnapshot(window, true),
    linkHover: await readLinkHoverSnapshot(window),
    primaryClick: await readPrimaryClickSnapshot(window),
  };
  await window.webContents.executeJavaScript(
    "document.querySelector('[data-smoke-select-newspaper=true]').click()",
    true,
  );
  await waitForSubTheme(window, "default.newspaper");
  await window.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    true,
  );
  const after = {
    ...await readSnapshot(window, false),
    linkHover: await readLinkHoverSnapshot(window),
    primaryClick: await readPrimaryClickSnapshot(window),
  };
  const dragGesture = await readDragGestureSnapshot(window);
  window.hide();
  return {
    before,
    after,
    dragGesture,
    preservedHost: after.preservedHost,
  };
}

function assertMarkdownLinkDrag(snapshot) {
  assert(snapshot.afterMouseUp === snapshot.before, "Dragging from a Markdown link triggered navigation.");
  assert(
    snapshot.movementPx > 4,
    `Markdown drag smoke did not cross the click threshold: ${JSON.stringify(snapshot)}`,
  );
}

function assertMarkdownContentColors(snapshot) {
  assert(
    snapshot.quoteColor !== snapshot.contentColor,
    "Markdown quote text did not recede from body copy.",
  );
  assert(
    colorDistance(snapshot.quoteColor, snapshot.surfaceColor)
      < colorDistance(snapshot.contentColor, snapshot.surfaceColor),
    `Markdown quote text is not closer to its surface than body copy: ${JSON.stringify(snapshot)}`,
  );
  assert(
    snapshot.quoteLinkColor === snapshot.linkColor,
    "A navigable link inside a quote did not retain the canonical link color.",
  );
  assert(
    snapshot.quoteCodeColor === snapshot.linkColor,
    "Inline code inside a navigable link did not inherit the canonical link color.",
  );
}

function colorDistance(left, right) {
  const leftChannels = parseColor(left);
  const rightChannels = parseColor(right);
  return Math.sqrt(leftChannels.reduce((sum, value, index) => (
    sum + ((value - rightChannels[index]) ** 2)
  ), 0));
}

function parseColor(value) {
  const channels = String(value).match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
    throw new Error(`Unsupported computed color: ${String(value)}`);
  }
  return String(value).startsWith("color(srgb ")
    ? channels.map((channel) => channel * 255)
    : channels;
}

async function readSnapshot(window, captureHost) {
  const snapshot = await window.webContents.executeJavaScript(`(() => {
    try {
    const root = document.querySelector('[data-po-appearance-root=true]');
    const host = document.querySelector('.markdown-codemirror-editor[data-preview-state=ready]');
    const content = host?.querySelector('.cm-content');
    const link = host?.querySelector('[data-md-link-interaction=navigate]');
    const quote = host?.querySelector('.cm-md-blockquote');
    const quoteLink = quote?.querySelector('[data-md-link-interaction=navigate]');
    const quoteCode = quoteLink?.matches('.cm-md-inline-code, .cm-md-syntax-monospace')
      ? quoteLink
      : quoteLink?.querySelector('.cm-md-inline-code, .cm-md-syntax-monospace');
    if (!root || !host || !content || !link || !quote || !quoteLink || !quoteCode) {
      return {
        smokeError: 'Markdown appearance smoke is missing its production surface.',
        missing: {
          root: !root,
          host: !host,
          content: !content,
          link: !link,
          quote: !quote,
          quoteLink: !quoteLink,
          quoteCode: !quoteCode,
        },
        quoteMarkup: quote?.outerHTML ?? null,
      };
    }
    if (${captureHost ? "true" : "false"}) window.__PUPPYONE_MARKDOWN_THEME_HOST__ = host;
    const rootStyle = getComputedStyle(root);
    const hostStyle = getComputedStyle(host);
    return {
      subThemeId: root.dataset.subThemeId,
      editorContentFontMode: root.dataset.fontEditorContentMode,
      editorContentFont: root.dataset.fontEditorContent,
      hostFont: rootStyle.getPropertyValue('--po-host-md-content-font').trim(),
      fontFamily: getComputedStyle(content).fontFamily,
      contentColor: getComputedStyle(content).color,
      surfaceColor: hostStyle.backgroundColor,
      linkColor: getComputedStyle(link).color,
      quoteColor: getComputedStyle(quote).color,
      quoteLinkColor: getComputedStyle(quoteLink).color,
      quoteCodeColor: getComputedStyle(quoteCode).color,
      contentCursor: getComputedStyle(content).cursor,
      linkCursor: getComputedStyle(link).cursor,
      pointerCursorPreference: root.dataset.pointerCursors,
      preservedHost: window.__PUPPYONE_MARKDOWN_THEME_HOST__ === host,
    };
    } catch (error) {
      return {
        smokeError: String(error),
        stack: error instanceof Error ? error.stack : null,
      };
    }
  })()`, true);
  if (snapshot.smokeError) {
    throw new Error(`${snapshot.smokeError} ${JSON.stringify({
      missing: snapshot.missing,
      quoteMarkup: snapshot.quoteMarkup,
      stack: snapshot.stack,
    })}`);
  }
  return snapshot;
}

function assertMarkdownLinkCursors(snapshot) {
  assert(snapshot.pointerCursorPreference === "false", "Cursor smoke did not disable the Shell pointer preference.");
  assert(snapshot.contentCursor === "text", `Markdown body cursor is not text: ${snapshot.contentCursor}`);
  assert(snapshot.linkCursor === "pointer", `Available Markdown link cursor is not pointer: ${snapshot.linkCursor}`);
  assert(snapshot.linkHover.hovered, "Production pointer hit did not hover the Markdown link glyph.");
  assert(
    snapshot.linkHover.hoverDecorationColor !== snapshot.linkHover.idleDecorationColor,
    `Markdown link hover did not reveal its underline: ${JSON.stringify(snapshot.linkHover)}`,
  );
  assert(
    Math.abs(snapshot.linkHover.idleRect.width - snapshot.linkHover.hoverRect.width) < 0.1
      && Math.abs(snapshot.linkHover.idleRect.height - snapshot.linkHover.hoverRect.height) < 0.1,
    "Markdown link hover changed inline geometry.",
  );
  assert(
    snapshot.primaryClick.afterMouseDown === snapshot.primaryClick.before,
    "Markdown link navigated during mousedown instead of waiting for gesture completion.",
  );
  assert(
    snapshot.primaryClick.afterMouseUp > snapshot.primaryClick.before,
    "Plain primary click did not navigate to the same-document heading.",
  );
}

async function readLinkHoverSnapshot(window) {
  window.webContents.sendInputEvent({ type: "mouseMove", x: 1, y: 1 });
  await window.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(resolve))",
    true,
  );
  const idle = await window.webContents.executeJavaScript(`(() => {
    const link = document.querySelector('[data-md-link-interaction=navigate]');
    if (!link) throw new Error('Markdown cursor smoke link is unavailable.');
    const rect = link.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      decorationColor: getComputedStyle(link).textDecorationColor,
      rect: { width: rect.width, height: rect.height },
    };
  })()`, true);
  window.webContents.sendInputEvent({ type: "mouseMove", x: idle.x, y: idle.y });
  await window.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    true,
  );
  const hover = await window.webContents.executeJavaScript(`(() => {
    const link = document.querySelector('[data-md-link-interaction=navigate]');
    const rect = link.getBoundingClientRect();
    return {
      hovered: link.matches(':hover'),
      decorationColor: getComputedStyle(link).textDecorationColor,
      rect: { width: rect.width, height: rect.height },
    };
  })()`, true);
  window.webContents.sendInputEvent({ type: "mouseMove", x: 1, y: 1 });
  return {
    hovered: hover.hovered,
    idleDecorationColor: idle.decorationColor,
    hoverDecorationColor: hover.decorationColor,
    idleRect: idle.rect,
    hoverRect: hover.rect,
  };
}

async function readPrimaryClickSnapshot(window) {
  const start = await window.webContents.executeJavaScript(`(() => {
    const scroller = document.querySelector('.markdown-codemirror-editor .cm-scroller');
    const link = document.querySelector('[data-md-link-interaction=navigate]');
    if (!scroller || !link) throw new Error('Markdown click smoke surface is unavailable.');
    scroller.scrollTop = 0;
    const rect = link.getBoundingClientRect();
    return {
      before: scroller.scrollTop,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  })()`, true);
  window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, x: start.x, y: start.y });
  const afterMouseDown = await window.webContents.executeJavaScript(
    "document.querySelector('.markdown-codemirror-editor .cm-scroller').scrollTop",
    true,
  );
  window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, x: start.x, y: start.y });
  await window.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    true,
  );
  const afterMouseUp = await window.webContents.executeJavaScript(`(() => {
    const scroller = document.querySelector('.markdown-codemirror-editor .cm-scroller');
    const value = scroller.scrollTop;
    scroller.scrollTop = 0;
    return value;
  })()`, true);
  await moveSelectionOffMarkdownLinks(window);
  return { before: start.before, afterMouseDown, afterMouseUp };
}

async function moveSelectionOffMarkdownLinks(window) {
  const target = await window.webContents.executeJavaScript(`(() => {
    const line = [...document.querySelectorAll('.markdown-codemirror-editor .cm-line')]
      .find((candidate) => candidate.textContent?.includes('Cursor verification spacer'));
    if (!line) return null;
    const rect = line.getBoundingClientRect();
    return {
      x: Math.round(rect.left + Math.min(24, Math.max(4, rect.width / 2))),
      y: Math.round(rect.top + rect.height / 2),
    };
  })()`, true);
  assert(target, "Markdown interaction smoke could not reset selection off a link.");
  window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...target });
  window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...target });
  await window.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    true,
  );
}

async function readDragGestureSnapshot(window) {
  const start = await window.webContents.executeJavaScript(`(() => {
    const scroller = document.querySelector('.markdown-codemirror-editor .cm-scroller');
    const link = document.querySelector('[data-md-link-interaction=navigate]');
    if (!scroller || !link) {
      return {
        smokeError: 'Markdown drag smoke surface is unavailable.',
        scrollerAvailable: Boolean(scroller),
        linkAvailable: Boolean(link),
      };
    }
    scroller.scrollTop = 0;
    const rect = link.getBoundingClientRect();
    return {
      before: scroller.scrollTop,
      x: Math.round(rect.left + 4),
      y: Math.round(rect.top + rect.height / 2),
      endX: Math.round(rect.right + 24),
    };
  })()`, true);
  if (start.smokeError) throw new Error(`${start.smokeError} ${JSON.stringify(start)}`);
  window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, x: start.x, y: start.y });
  await window.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(resolve))",
    true,
  );
  for (let step = 1; step <= 8; step += 1) {
    window.webContents.sendInputEvent({
      type: "mouseMove",
      button: "left",
      x: Math.round(start.x + ((start.endX - start.x) * step) / 8),
      y: start.y,
    });
  }
  window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, x: start.endX, y: start.y });
  await window.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    true,
  );
  const snapshot = await window.webContents.executeJavaScript(`(() => {
    const scroller = document.querySelector('.markdown-codemirror-editor .cm-scroller');
    return {
      before: ${JSON.stringify(start.before)},
      afterMouseUp: scroller?.scrollTop ?? null,
      movementPx: ${JSON.stringify(start.endX - start.x)},
      scrollerAvailable: Boolean(scroller),
    };
  })()`, true);
  assert(snapshot.scrollerAvailable, "Markdown drag smoke lost its production scroller.");
  return snapshot;
}

async function waitForReady(window) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const ready = await window.webContents.executeJavaScript(
      "Boolean(document.querySelector('.markdown-codemirror-editor[data-preview-state=ready]'))",
      true,
    );
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Markdown theme inheritance smoke did not become ready within 20 seconds.");
}

async function waitForSubTheme(window, expected) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const actual = await window.webContents.executeJavaScript(
      "document.querySelector('[data-po-appearance-root=true]')?.dataset.subThemeId ?? null",
      true,
    );
    if (actual === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Markdown theme inheritance smoke did not switch to ${expected}.`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function finish(exitCode) {
  for (const window of windows) {
    if (!window.isDestroyed()) window.destroy();
  }
  await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  app.exit(exitCode);
}

app.whenReady().then(runSmoke).then(() => finish(0)).catch(async (error) => {
  console.error(error);
  await finish(1);
});
