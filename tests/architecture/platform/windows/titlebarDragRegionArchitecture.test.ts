import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baseCss = readFileSync(new URL("../../../../src/styles/base.css", import.meta.url), "utf8");
const titlebarCss = readFileSync(new URL("../../../../src/styles/titlebar.css", import.meta.url), "utf8");
const windowChromeCss = readFileSync(new URL("../../../../src/styles/window-chrome.css", import.meta.url), "utf8");
const windowChromeComponent = readFileSync(
  new URL("../../../../src/components/DesktopWindowChrome.tsx", import.meta.url),
  "utf8",
);
const electronMain = readFileSync(new URL("../../../../electron/main.mjs", import.meta.url), "utf8");
const desktopShell = readFileSync(new URL("../../../../src/components/DesktopCloudShell.tsx", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../../../../src/styles/shell.css", import.meta.url), "utf8");
const desktopMenu = readFileSync(new URL("../../../../src/components/DesktopMenu.tsx", import.meta.url), "utf8");
const sharedWorkspaceCss = readFileSync(
  new URL("../../../../packages/shared-ui/src/styles/data-workspace.css", import.meta.url),
  "utf8",
);

describe("titlebar drag-region architecture", () => {
  it("keeps native hit testing in the dedicated window chrome contract", () => {
    expect(windowChromeCss).toContain('[data-window-drag-region="true"]');
    expect(windowChromeCss).toContain("-webkit-app-region: drag;");
    expect(windowChromeCss).toContain('[data-window-no-drag="true"]');
    expect(windowChromeCss).toContain("-webkit-app-region: no-drag;");
    expect(windowChromeCss).toContain('body:has([data-titlebar-context-menu="true"])');
    expect(windowChromeCss).toMatch(
      /body:has\(\[data-titlebar-context-menu="true"\]\)[\s\S]*\[data-window-drag-region="true"\][\s\S]*-webkit-app-region:\s*no-drag;/,
    );
    expect(titlebarCss).not.toContain("-webkit-app-region");
    expect(baseCss).not.toContain("-webkit-app-region");
  });

  it("renders chrome as a sibling of the workbench and keeps Shared UI process-neutral", () => {
    expect(desktopShell).toContain("<DesktopWindowChrome");
    expect(desktopShell.indexOf("<DesktopWindowChrome")).toBeLessThan(
      desktopShell.indexOf('className="desktop-shell-body"'),
    );
    expect(windowChromeComponent).toContain('data-window-drag-region="true"');
    expect(windowChromeComponent).toContain('className="desktop-titlebar-trailing"');
    expect(windowChromeComponent.indexOf('className="desktop-titlebar-actions"')).toBeLessThan(
      windowChromeComponent.indexOf('className="desktop-window-controls"'),
    );
    expect(desktopMenu).toContain('data-window-no-drag="true"');
    expect(sharedWorkspaceCss).not.toContain("-webkit-app-region");
    expect(sharedWorkspaceCss).not.toContain("data-window-drag-region");
  });

  it("keeps the Header full width and mounts the optional Project rail below it", () => {
    expect(desktopShell).toContain('data-leading-rail={leadingRail ? "true" : undefined}');
    expect(desktopShell).toContain('className="desktop-shell-workbench"');
    expect(desktopShell.indexOf("<DesktopWindowChrome")).toBeLessThan(
      desktopShell.indexOf('className="desktop-shell-leading-rail"'),
    );
    expect(desktopShell).toContain('className="desktop-shell-below-header"');
    expect(desktopShell).toContain('className="desktop-shell-workspace-column"');
    expect(shellCss).toMatch(/\.desktop-shell\s*\{[^}]*flex-direction:\s*column;/s);
    expect(shellCss).toMatch(/\.desktop-shell-workbench\s*\{[^}]*flex-direction:\s*column;/s);
    expect(shellCss).toMatch(/\.desktop-shell-below-header\s*\{[^}]*flex-direction:\s*row;/s);
    expect(titlebarCss).not.toContain('.desktop-shell[data-leading-rail="true"] .desktop-titlebar');
  });

  it("keeps the native fullscreen reveal bar free of application titles", () => {
    expect(electronMain).toContain('window.on("enter-full-screen"');
    expect(electronMain).toContain('window.setTitle("");');
    expect(electronMain).toContain('window.on("leave-full-screen"');
    expect(electronMain).toContain("window.setTitle(resolveWindowTitle(window));");
  });
});
