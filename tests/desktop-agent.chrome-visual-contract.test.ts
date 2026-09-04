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
const tabs = source("src/features/desktop-agent/ui/AgentSessionTabs.tsx");
const tabsCss = source("src/features/desktop-agent/ui/styles/tabs.css");
const terminalLauncherCss = source("src/features/desktop-terminal/ui/terminal-launcher.css");
const terminalTabsCss = source("src/features/desktop-terminal/ui/session-header/terminal-session-header.css");

describe("Desktop Agent and Terminal chrome visual contract", () => {
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
    expect(launcherCss).toMatch(/\.desktop-agent-history-toolbar h2\s*\{[^}]*font-size:\s*var\(--po-type-header-content, 15px\)[^}]*line-height:\s*var\(--po-type-header-line-height, 20px\)/s);
    expect(launcherCss).toMatch(/\.desktop-agent-history-search input::placeholder\s*\{[^}]*color:\s*color-mix\(in srgb, var\(--agent-text-subtle\) 82%, transparent\)[^}]*opacity:\s*1/s);
    expect(launcherCss).toMatch(/\.desktop-agent-history-permission-content\s*\{[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*padding:\s*30px/s);
    expect(launcherCss).toMatch(/\.desktop-agent-history-permission-button\s*\{[^}]*background:\s*var\(--po-text\)[^}]*color:\s*var\(--po-canvas\)/s);
    expect(launcherCss).not.toMatch(/\.desktop-agent-history-permission-view\s*\{[^}]*(?:position:\s*(?:fixed|absolute)|box-shadow|border:|background:)/s);
    expect(launcherCss).toMatch(/\.desktop-agent-history-list\s*\{[^}]*overflow-y:\s*auto/s);
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

  it("matches Terminal tab typography and control geometry", () => {
    expect(terminalTabsCss).toContain("--desktop-terminal-tab-control-height: 28px;");
    expect(terminalTabsCss).toContain("--desktop-terminal-tab-width: 144px;");
    expect(terminalTabsCss).toMatch(
      /\.desktop-terminal-subheader\s*\{[^}]*height:\s*var\(--desktop-terminal-group-header-size, 38px\)/s,
    );
    expect(terminalTabsCss).toMatch(/\.desktop-terminal-tab-select\s*\{[^}]*font-size:\s*var\(--po-type-header-content, 15px\)[^}]*line-height:\s*var\(--po-type-header-line-height, 20px\)/s);

    expect(tabsCss).toContain("--desktop-agent-tab-control-height: 28px;");
    expect(tabsCss).toContain("--desktop-agent-tab-width: 144px;");
    expect(tabsCss).toContain("--desktop-agent-tabs-gap: 3px;");
    expect(tabsCss).toMatch(/\.desktop-agent-workspace\s*\{[^}]*grid-template-rows:\s*38px minmax\(0, 1fr\)[^}]*font-family:\s*var\(--po-font-sans\)[^}]*font-size:\s*var\(--po-type-header-content, 15px\)/s);
    expect(tabsCss).toMatch(/\.desktop-agent-tabs-subheader\s*\{[^}]*height:\s*38px[^}]*padding:\s*4px 6px 6px/s);
    expect(tabsCss).toMatch(/\.desktop-agent-tab-select\s*\{[^}]*grid-template-columns:\s*var\(--desktop-agent-tab-control-height\) minmax\(0, 1fr\)[^}]*font-size:\s*var\(--po-type-header-content, 15px\)[^}]*line-height:\s*var\(--po-type-header-line-height, 20px\)/s);
    expect(tabsCss).toMatch(/\.desktop-agent-tab \.desktop-agent-brand-mark\s*\{[^}]*width:\s*14px[^}]*height:\s*14px/s);
    expect(tabsCss).not.toMatch(/\.desktop-agent-tab\s*\{[^}]*height:\s*30px/s);
    expect(tabs).toContain('className="desktop-agent-tab-leading"');
    expect(tabs).toContain('size={14}');
  });
});
