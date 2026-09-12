import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const splitStyles = source(
  "src/features/editor-workbench/layout/desktop-editor-split-view.css",
);
const paneChromeSource = source(
  "src/features/editor-workbench/layout/EditorPaneChrome.tsx",
);
const paneShellSource = source(
  "src/features/editor-workbench/layout/EditorPaneShell.tsx",
);
const paneHostSlotSource = source(
  "src/features/editor-workbench/layout/pane-host/EditorPaneHostSlot.tsx",
);

describe("editor pane chrome hit-target architecture", () => {
  it("keeps first-gesture hit testing independent from visual reveal state", () => {
    const shellRule = readCssBlock(splitStyles, ".desktop-editor-pane-handle-shell");
    const revealRule = readCssBlock(
      splitStyles,
      ".desktop-editor-pane[data-handle-hot] > .desktop-editor-pane-handle-shell",
    );
    const handleRule = readCssBlock(splitStyles, ".desktop-editor-pane-handle");

    expect(shellRule).toContain("pointer-events: none;");
    expect(revealRule).toContain("opacity: 1;");
    expect(revealRule).not.toContain("pointer-events:");
    expect(handleRule).toContain("width: 27px;");
    expect(handleRule).toContain("height: 13px;");
    expect(handleRule).toContain("pointer-events: auto;");
  });

  it("routes both the initial press and preview warmup through the stable button", () => {
    expect(paneChromeSource).toContain("onPointerEnter={() =>");
    expect(paneChromeSource).toContain("paneMove.prepare(paneRef.current, pane.id)");
    expect(paneChromeSource).toContain("onPointerDown={(event) =>");
    expect(paneChromeSource).toContain("paneMove.start(event, pane)");
    expect(paneChromeSource).toContain("onPointerUp={(event) =>");
    expect(paneChromeSource).toContain('paneMove.end(event) === "drag"');
    expect(paneChromeSource).toContain("suppressDerivedDragClick();");
    expect(paneChromeSource).toContain("onClick={() =>");
    expect(paneChromeSource).toContain("toggleMenu();");
    expect(paneChromeSource).not.toContain("event.detail === 0");
  });

  it("keeps a complete inside frame while limiting accent to press or drag", () => {
    const frameRule = readCssBlock(
      splitStyles,
      ".desktop-editor-pane-interaction-frame",
    );
    const paneContentRule = readCssBlock(splitStyles, ".desktop-editor-pane-content");

    expect(paneShellSource).toContain('data-pane-menu-open={actionsOpen ? "true" : undefined}');
    expect(paneShellSource).toContain(
      'className="desktop-editor-pane-interaction-frame"',
    );
    expect(splitStyles).toContain(".desktop-editor-pane[data-move-source]");
    expect(splitStyles).toContain(".desktop-editor-pane-handle:active)");
    expect(splitStyles).not.toContain(".desktop-editor-pane[data-pane-menu-open]");
    expect(splitStyles).not.toContain(".desktop-editor-pane::after");
    expect(frameRule).toContain("position: absolute;");
    expect(frameRule).toContain(
      "z-index: calc(var(--po-pane-resizer-z-index, 35) + 1);",
    );
    expect(frameRule).toContain("inset: 0;");
    expect(frameRule).toContain("pointer-events: none;");
    expect(frameRule).toContain(
      "linear-gradient(currentColor, currentColor) bottom / 100% 1px no-repeat",
    );
    expect(paneHostSlotSource).toContain(
      'data-touches-block-end={touchesBlockEnd ? "true" : undefined}',
    );
    expect(splitStyles).toContain(
      '.desktop-editor-pane-slot[data-touches-block-end="true"]',
    );
    expect(splitStyles).toContain("inset-block-end: 1px;");
    expect(paneContentRule).toContain("z-index: 0;");
    expect(paneContentRule).toContain("isolation: isolate;");
    expect(splitStyles).not.toContain("@keyframes desktop-editor-pane-handle-press");
  });

  it("renders edge drop intent as an edge-to-edge fill without decorative framing", () => {
    const previewRule = readCssBlock(splitStyles, ".desktop-editor-drop-preview");
    const leftRule = readCssBlock(splitStyles, '.desktop-editor-drop-preview[data-edge="left"]');
    const rightRule = readCssBlock(splitStyles, '.desktop-editor-drop-preview[data-edge="right"]');
    const topRule = readCssBlock(splitStyles, '.desktop-editor-drop-preview[data-edge="top"]');
    const bottomRule = readCssBlock(splitStyles, '.desktop-editor-drop-preview[data-edge="bottom"]');

    expect(previewRule).toContain("border: 0;");
    expect(previewRule).toContain("background: color-mix(in srgb, var(--po-accent) 13%, transparent);");
    expect(previewRule).not.toContain("box-shadow:");
    expect(leftRule).toContain("inset: 0 50% 0 0;");
    expect(rightRule).toContain("inset: 0 0 0 50%;");
    expect(topRule).toContain("inset: 0 0 50%;");
    expect(bottomRule).toContain("inset: 50% 0 0;");
  });
});

function source(relativePath: string) {
  return readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), "utf8");
}

function readCssBlock(styles: string, selector: string) {
  const exactStart = styles.indexOf(`\n${selector} {`);
  const start = exactStart >= 0 ? exactStart + 1 : styles.indexOf(selector);
  if (start < 0) return "";
  const open = styles.indexOf("{", start);
  if (open < 0) return "";
  const end = styles.indexOf("}", open);
  return end < 0 ? styles.slice(start) : styles.slice(start, end + 1);
}
