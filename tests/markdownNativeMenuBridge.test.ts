import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("native Markdown menu bridge", () => {
  it("exposes a narrow command listener and routes it through the renderer bridge", () => {
    const preload = source("electron/preload.cjs");
    const bridge = source("src/lib/markdownFormatShortcutBridge.ts");
    const main = source("electron/main.mjs");
    const desktopTypes = source("src/types/electron.d.ts");

    expect(preload).toContain('ipcRenderer.on("editor:markdown-command"');
    expect(preload).toContain("isMarkdownEditorCommand");
    expect(preload).toContain('"strong", "emphasis", "underline", "strike", "highlight"');
    expect(preload).toContain("isMarkdownFormatCommand(type)");
    expect(bridge).toContain("onMarkdownEditorCommand");
    expect(bridge).toContain("MARKDOWN_EDITOR_COMMAND_EVENT");
    expect(desktopTypes).toContain('import("@puppyone/shared-ui").MarkdownFormatCommand');
    expect(main).toContain("dispatchMarkdownEditorCommand");
    expect(main).toContain("isMarkdownEditorActive");
    const focusBlock = main.slice(
      main.indexOf('window.on("focus"'),
      main.indexOf('window.on("blur"'),
    );
    const closedBlock = main.slice(
      main.indexOf('window.on("closed"'),
      main.indexOf("return window;"),
    );
    expect(focusBlock).toContain("nativeMenuService.refresh()");
    expect(closedBlock).toContain("nativeMenuService.refresh()");
  });
});
