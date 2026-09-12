import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const launcher = source("src/features/desktop-agent/ui/AgentRuntimeLauncher.tsx");
const launcherCss = source("src/features/desktop-agent/ui/styles/launcher.css");
const terminalLauncherCss = source("src/features/app-shell/auxiliary-workbench/auxiliary-workbench-launcher.css");
const terminalTabsCss = source("src/features/app-shell/auxiliary-workbench/layout/auxiliary-workbench-header.css");

describe("Desktop Agent and Terminal chrome visual contract", () => {
  it("shows launcher content immediately while retaining tab and busy-state motion", () => {
    expect(terminalLauncherCss).not.toContain("desktop-terminal-launcher-tool-enter");
    expect(launcherCss).not.toContain("desktop-agent-runtime-launcher-option-enter");
    expect(terminalLauncherCss).toContain("animation: desktop-terminal-launcher-scan");
    expect(launcherCss).toContain("animation: desktop-agent-runtime-launcher-spin");
    expect(terminalTabsCss).toContain("@starting-style");
    expect(terminalTabsCss).toContain("opacity 120ms ease");
  });

  it("keeps the in-chat runtime chooser compact and free of global history navigation", () => {
    expect(launcherCss).toMatch(/place-items:\s*safe center/);
    expect(launcherCss).toMatch(/padding:\s*32px 0/);
    expect(launcherCss).toMatch(/width:\s*min\(100%, 252px\)/);
    expect(launcherCss).toMatch(/gap:\s*8px/);
    expect(launcherCss).toMatch(/padding:\s*18px/);
    expect(launcherCss).toMatch(/inset-inline-start:\s*22px/);
    expect(launcherCss).toMatch(/font-weight:\s*500/);
    expect(launcherCss).toMatch(/min-height:\s*var\(--po-control-size-large\)/);
    expect(launcherCss).toMatch(/gap:\s*9px/);
    expect(launcherCss).toMatch(/padding:\s*5px 8px/);

    expect(launcherCss).toMatch(/\.desktop-agent-runtime-launcher-group\s*\{[^}]*border:\s*1px solid var\(--agent-border-subtle\)[^}]*border-radius:\s*0/s);
    expect(launcherCss).toMatch(/\.desktop-agent-runtime-launcher-option \.desktop-agent-brand-mark\s*\{[^}]*width:\s*18px[^}]*height:\s*18px[^}]*border-radius:\s*4px/s);
    expect(launcherCss).toMatch(/\.desktop-agent-runtime-launcher-heading h2\s*\{[^}]*font-size:\s*var\(--agent-font-size-meta\)[^}]*line-height:\s*var\(--agent-meta-line-height\)/s);
    expect(launcherCss).toMatch(/\.desktop-agent-runtime-launcher-option > span:nth-child\(2\)\s*\{[^}]*font-size:\s*var\(--agent-font-size\)[^}]*line-height:\s*var\(--agent-control-line-height\)/s);
    expect(launcherCss).not.toMatch(/font-size:\s*[0-9]+px/);
    expect(launcherCss).not.toMatch(/\.desktop-agent-runtime-launcher-option\s*\{[^}]*min-height:\s*38px/s);
    expect(launcher).toContain('aria-describedby="desktop-agent-runtime-launcher-description"');
    expect(launcher).toContain('className="desktop-agent-runtime-launcher-description"');
    expect(launcher).not.toContain('className="desktop-agent-runtime-launcher-history"');
    expect(launcher).not.toContain("historyOpen");
    expect(launcherCss).toMatch(/\.desktop-agent-runtime-launcher\.is-history\s*\{[^}]*place-items:\s*stretch[^}]*padding:\s*0/s);
    expect(launcherCss).toMatch(/\.desktop-agent-history-view\s*\{[^}]*width:\s*100%[^}]*grid-template-rows:[^}]*var\(--desktop-chrome-height, 38px\)[^}]*overflow:\s*hidden[^}]*background:\s*var\(--agent-canvas\)/s);
    expect(launcherCss).toMatch(/\.desktop-agent-history-toolbar\s*\{[^}]*width:\s*100%[^}]*padding-inline:[^}]*var\(--desktop-sidebar-row-left-gap, 12px\)[^}]*var\(--desktop-sidebar-row-right-gap, 12px\)/s);
    expect(launcherCss).not.toContain(".desktop-agent-history-toolbar h2");
    expect(launcherCss).toMatch(/\.desktop-agent-history-search-slot\s*\{[^}]*justify-items:\s*end/s);
    expect(launcherCss).toMatch(/\.desktop-agent-history-search\s*\{[^}]*height:\s*var\(--po-control-size-compact\)[^}]*margin:\s*0/s);
    expect(launcherCss).toMatch(/\.desktop-agent-history-search input::placeholder\s*\{[^}]*color:\s*var\(--agent-launcher-placeholder-text\)[^}]*opacity:\s*1/s);
    expect(launcherCss).toMatch(/\.desktop-agent-history-permission-content\s*\{[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*padding:\s*30px/s);
    expect(launcherCss).toMatch(/\.desktop-agent-history-permission-button\s*\{[^}]*background:\s*var\(--po-text\)[^}]*color:\s*var\(--po-canvas\)/s);
    expect(launcherCss).not.toMatch(/\.desktop-agent-history-permission-view\s*\{[^}]*(?:position:\s*(?:fixed|absolute)|box-shadow|border:|background:)/s);
    expect(launcherCss).toMatch(/\.desktop-agent-history-list\s*\{[^}]*overflow-y:\s*auto/s);
    expect(launcherCss).toMatch(/\.desktop-agent-history-title\s*\{[^}]*display:\s*block[^}]*text-overflow:\s*ellipsis/s);
    expect(launcherCss).toMatch(/\.desktop-agent-history-option\s*\{[^}]*height:\s*var\(--desktop-sidebar-row-height, var\(--po-control-size\)\)[^}]*border:\s*0[^}]*font-size:\s*var\(--agent-font-size\)[^}]*font-weight:\s*var\(--desktop-sidebar-font-weight,[^}]*line-height:\s*var\(--agent-control-line-height\)/s);
    expect(launcherCss).toMatch(/\.desktop-agent-history-option \.desktop-agent-brand-mark\s*\{[^}]*width:\s*14px[^}]*height:\s*14px[^}]*color:\s*var\(--agent-text-subtle\)/s);
    expect(launcherCss).toMatch(/\.desktop-agent-history-option:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--po-hover\)[^}]*color:\s*var\(--agent-text\)[^}]*\}/s);
    expect(launcherCss).not.toMatch(/\.desktop-agent-history-option:hover:not\(:disabled\)\s*\{[^}]*(?:border|box-shadow):/s);
    expect(launcherCss).toMatch(/\.desktop-agent-history-time\s*\{[^}]*color:\s*var\(--agent-text-subtle\)[^}]*font-family:\s*inherit[^}]*font-size:\s*var\(--agent-font-size-meta\)[^}]*font-weight:\s*var\(--po-text-weight-regular, 400\)/s);
    expect(launcherCss).not.toMatch(/\.desktop-agent-history-time\s*\{[^}]*font-variant-numeric:/s);
  });

  it("uses separate start and continue groups with Terminal inside the start group", () => {
    expect(terminalLauncherCss).toMatch(/place-items:\s*safe center/);
    expect(terminalLauncherCss).toMatch(/padding:\s*32px 0/);
    expect(terminalLauncherCss).toMatch(/width:\s*min\(100%, 252px\)/);
    expect(terminalLauncherCss).toMatch(/\.desktop-terminal-launcher-content\s*\{[^}]*gap:\s*28px/s);
    expect(terminalLauncherCss).toMatch(/\.desktop-terminal-launcher-group\s*\{[^}]*padding:\s*18px[^}]*border:\s*1px solid var\(--po-border\)[^}]*border-radius:\s*0/s);
    expect(terminalLauncherCss).toMatch(/\.desktop-terminal-launcher-tools\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*gap:\s*1px/s);
    expect(terminalLauncherCss).toMatch(/\.desktop-terminal-launcher-tool,\s*\.desktop-terminal-launcher-shell,\s*\.desktop-terminal-launcher-history\s*\{[^}]*min-height:\s*var\(--po-control-size-large\)[^}]*gap:\s*9px[^}]*padding:\s*5px 8px/s);
    expect(terminalLauncherCss).toMatch(/\.desktop-terminal-launcher-heading h2\s*\{[^}]*font-size:\s*var\(--po-type-right-sidebar-meta, 13px\)[^}]*line-height:\s*var\(--po-type-right-sidebar-meta-line-height, 19px\)/s);
    expect(terminalLauncherCss).toMatch(/\.desktop-terminal-launcher-tool > span:last-child,[^}]*\{[^}]*font-size:\s*var\(--po-type-right-sidebar-content, 14px\)[^}]*line-height:\s*var\(--po-type-right-sidebar-control-line-height, 19px\)/s);
    expect(terminalLauncherCss).toMatch(/\.desktop-terminal-launcher-divider\s*\{[^}]*height:\s*1px/s);
    expect(terminalLauncherCss).not.toContain(".desktop-terminal-launcher-rail");
    expect(terminalLauncherCss).not.toContain("::-webkit-scrollbar");
    expect(terminalLauncherCss).not.toMatch(/scrollbar-(?:width|color)\s*:/);
  });

  it("uses shared tab typography and control geometry for Agent and Terminal", () => {
    expect(terminalTabsCss).toContain("--desktop-terminal-tab-control-height: 28px;");
    expect(terminalTabsCss).toContain("--desktop-terminal-tab-width: 144px;");
    expect(terminalTabsCss).toMatch(
      /\.desktop-terminal-subheader\s*\{[^}]*height:\s*var\(--desktop-terminal-group-header-size, 38px\)/s,
    );
    expect(terminalTabsCss).toMatch(/\.desktop-terminal-tab-select\s*\{[^}]*font-size:\s*var\(--po-type-header-content, 15px\)[^}]*line-height:\s*var\(--po-type-header-line-height, 20px\)/s);

  });
});
