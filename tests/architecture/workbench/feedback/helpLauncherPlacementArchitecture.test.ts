import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Where Help and its dialog sit in the App's wiring and styles. What the launcher
 * does on screen is the component test's; these are the source and style rules
 * no render can see.
 */
describe("Help launcher placement", () => {
  it("moves the launcher to the Project rail experiment while keeping the modal in the global overlay", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const dataShellCss = readFileSync("src/features/data-workspace/data-shell.css", "utf8");
    const dialogCss = readFileSync("src/styles/dialogs.css", "utf8");
    const launcherCss = readFileSync(
      "src/features/app-shell/desktop-help-launcher.css",
      "utf8",
    );

    expect(appSource).toMatch(
      /sidebarUtility=\{railOwnsProject[\s\S]*?\? undefined[\s\S]*?: feedbackLauncher\}/,
    );
    expect(appSource).toContain("const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);");
    expect(appSource).toContain("renderLeadingRail={railOwnsProject ? ({ expanded }) => renderProjectRail(");
    expect(appSource).toContain("expanded={expanded}");
    expect(readFileSync("src/app/ProjectWindow.tsx", "utf8")).toContain("leftSidebarCollapsed={sidebarCollapsed}");
    // Local right-sidebar content never shows over a Cloud workspace.
    expect(appSource).toMatch(/rightSidebarOpen=\{[^}]*\brightSidebarContentVisible\b[^}]*\}/);
    expect(appSource).toMatch(/const localRightSidebarActive = !cloudWorkspaceActive\b/);
    expect(appSource).toMatch(/const rightSidebarContentVisible = \w+ && localRightSidebarActive;/);
    expect(appSource).toContain("settingsOpen={settingsDialogOpen}");
    expect(appSource).toContain("{settingsDialogOpen && (");
    expect(appSource).toContain("<SettingsDialog");
    expect(appSource).not.toContain("settingsWorkspaceActive");
    expect(appSource).not.toContain("feedbackInNavigationToolbar");
    expect(appSource).toContain("settingsNavigationVisible={!railOwnsProject && sidebarFooterVisible}");
    expect(appSource).toContain("workspaceNavigationVisible={!railOwnsProject && sidebarFooterVisible}");
    expect(appSource).toMatch(
      // macOS carries Settings and Help in the app menu, so the footer and its
      // launcher render only where there is no application menu.
      /<ProjectSwitcherRail[\s\S]*?utilitySlot=\{sidebarFooterVisible \? <DesktopHelpLauncher/,
    );
    expect(launcherCss).toMatch(
      /\.desktop-feedback\s*\{[^}]*display:\s*flex[^}]*pointer-events:\s*auto/s,
    );
    expect(dataShellCss).not.toContain("desktop-sidebar-footer-actions-right");
    expect(dataShellCss).toMatch(
      /\.desktop-sidebar-top-navigation-utility\s*\{[^}]*margin-inline-start:\s*auto/s,
    );
    expect(launcherCss).not.toContain(".desktop-help-launcher-label");
    expect(dialogCss).toMatch(
      /\.desktop-dialog-backdrop\s*\{[^}]*position:\s*fixed[^}]*align-items:\s*center[^}]*justify-content:\s*center/s,
    );
    expect(launcherCss).toMatch(/\.desktop-feedback-dialog-backdrop\s*\{[^}]*pointer-events:\s*auto/s);
    expect(launcherCss).toMatch(/\.desktop-feedback-dialog\s*\{[^}]*width:\s*min\(400px,/s);
    expect(launcherCss).toMatch(
      /\.desktop-feedback-header\s*\{[^}]*align-items:\s*center/s,
    );
    expect(launcherCss).toMatch(
      /\.desktop-feedback-fields\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
    );
    expect(launcherCss).not.toContain("desktop-feedback-category");
    expect(launcherCss).toMatch(
      /\.desktop-feedback-required-marker\s*\{[^}]*color:\s*var\(--po-danger\)/s,
    );
    expect(launcherCss).toMatch(
      /\.desktop-feedback-contact-input\s*\{[^}]*border:\s*1px solid var\(--po-divider\)[^}]*border-radius:\s*6px[^}]*background:\s*var\(--po-input, var\(--po-panel-raised\)\)/s,
    );
    expect(launcherCss).toMatch(
      /\.desktop-feedback-composer:focus-within\s*\{[^}]*border-color:\s*var\(--po-border-strong\)[^}]*\}/s,
    );
    expect(launcherCss.match(/\.desktop-feedback-composer:focus-within\s*\{[^}]*\}/s)?.[0])
      .not.toContain("box-shadow");
    expect(launcherCss.match(/\.desktop-feedback-contact-input:focus\s*\{[^}]*\}/s)?.[0])
      .not.toContain("box-shadow");
    expect(launcherCss).not.toContain("desktop-feedback-composer-toolbar");
    expect(launcherCss).not.toContain("translateY(-1px)");
    expect(launcherCss.match(/\.desktop-feedback-footer\s*\{[^}]*\}/s)?.[0]).not.toContain(
      "border-block-start",
    );
    expect(launcherCss).not.toContain("desktop-feedback-popover");
    const launcherRule = launcherCss.match(/\.desktop-help-launcher\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(launcherRule).toContain("width: var(--desktop-sidebar-utility-control-size, var(--desktop-sidebar-control-size))");
    expect(launcherRule).toContain("height: var(--desktop-sidebar-utility-control-size, var(--desktop-sidebar-control-size))");
    expect(launcherRule).toContain("border: 0");
    expect(launcherRule).toContain("background: transparent");
    expect(launcherRule).toContain("color: var(--desktop-sidebar-utility-icon-color, var(--po-text-muted))");
    expect(launcherRule).toContain("padding: 0");
    expect(launcherRule).not.toContain("backdrop-filter");
    expect(launcherCss).toMatch(
      /\.desktop-help-launcher-icon-slot\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*place-items:\s*center/s,
    );
    expect(launcherCss).toMatch(
      /\.desktop-help-launcher:hover\s*\{[^}]*background:\s*var\(--po-hover\)[^}]*color:\s*var\(--po-text\)/s,
    );
    expect(launcherCss).toMatch(
      /\.desktop-feedback\[data-open="true"\] \.desktop-help-launcher\s*\{[^}]*background:\s*var\(--po-selected\)[^}]*color:\s*var\(--po-text\)/s,
    );
    expect(launcherCss).not.toMatch(
      /\.desktop-feedback\s*\{[^}]*position:\s*(?:absolute|fixed)/s,
    );
  });
});
