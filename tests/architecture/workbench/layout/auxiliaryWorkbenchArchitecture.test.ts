import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Project-owned auxiliary workbench architecture", () => {
  it("owns shared geometry independently of Terminal and isolates vendor adapters", () => {
    const shared = source("src/features/app-shell/auxiliary-workbench/auxiliary-workbench.css");
    const terminal = source("src/features/desktop-terminal/ui/styles/terminal-surface.css");
    const entry = source("src/features/desktop-terminal/ui/desktop-terminal.css");
    expect(source("src/styles.css")).toContain('auxiliary-workbench/auxiliary-workbench.css" layer(features)');
    expect(shared).toContain(".desktop-terminal-panel {");
    expect(shared).toContain(".desktop-terminal-contribution-host[aria-hidden");
    expect(shared).not.toMatch(/\.xterm[\s.-]|\.desktop-terminal-session\s*\{/);
    expect(terminal).not.toMatch(/\.desktop-terminal-(panel|body|drop-preview|contribution-host)[\s[{]/);
    expect(terminal).toContain(".desktop-terminal-session:not(.is-ready) .desktop-terminal-xterm");
    expect(entry).toContain('@import "@xterm/xterm/css/xterm.css" layer(primitives)');
    expect(entry).toContain('@import "./styles/xterm-adapter.css" layer(features)');
  });

  it("keeps serializable topology independent from feature runtimes", () => {
    const model = source(
      "packages/shared-ui/src/workbench/auxiliary-workbench/auxiliaryWorkbenchModel.ts",
    );
    expect(model).toContain("type AuxiliaryWorkbenchItem");
    expect(model).toContain("type AuxiliaryWorkbenchGroup");
    expect(model).toContain("itemIds: readonly string[]");
    expect(model).toContain("assertAuxiliaryWorkbenchState");
    expect(model).not.toMatch(/React|electron|TerminalRuntime|AgentSessionController/);
    expect(model).not.toContain('kind: "terminal"');
    expect(model).not.toContain('kind: "agent-chat"');
  });

  it("composes one Right Sidebar surface and lazy Agent contribution", () => {
    const app = source("src/App.tsx");
    const lazyEntry = source("src/features/desktop-agent/lazy.ts");
    expect(app).toContain("lazy(loadAgentChatWorkbenchItem)");
    expect(app).toContain("contributions={auxiliaryWorkbenchContributions}");
    expect(app).toContain("createTerminalWorkbenchContribution(t, readAuxiliaryTerminalAppearance)");
    expect(app).toContain('className="desktop-right-sidebar-surface is-active"');
    expect(app).not.toContain("<RightAgentPanel");
    expect(app).not.toContain('key={focusedWorkspace?.path ?? workspace.path}');
    expect(lazyEntry).toContain('import("./workbench/AgentChatWorkbenchItem")');
    expect(lazyEntry).not.toContain("./renderer/");
  });

  it("preserves Item views across Tab reorder and keeps close feature-authoritative", () => {
    const panel = source("src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel.tsx");
    const closeContract = source("src/features/app-shell/auxiliary-workbench/types.ts");
    const closeCoordinator = source(
      "src/features/app-shell/auxiliary-workbench/useAuxiliaryWorkbenchCloseCoordinator.ts",
    );
    const hostOwner = source(
      "src/features/app-shell/auxiliary-workbench/layout/usePersistentWorkbenchItemHosts.ts",
    );
    const hostSlot = source(
      "src/features/app-shell/auxiliary-workbench/layout/AuxiliaryWorkbenchItemHostSlot.tsx",
    );
    expect(panel).toContain("createPortal(");
    expect(panel).toContain("useAuxiliaryWorkbenchCloseCoordinator");
    expect(panel).toContain("byKind.get(item.kind)?.close");
    expect(closeContract).toContain('kind: "close"');
    expect(closeContract).toContain('kind: "confirm"');
    expect(closeContract).toContain('kind: "blocked"');
    expect(closeContract).toContain("decide:");
    expect(closeContract).toContain("commit:");
    expect(closeCoordinator.indexOf("target.adapter.commit(target.context)"))
      .toBeLessThan(closeCoordinator.indexOf("onClosed(itemId)"));
    expect(hostOwner).toContain('document.createElement("div")');
    expect(hostSlot).toContain("slot.append(host)");
    expect(hostSlot).toContain("if (host.parentElement === slot) host.remove()");
  });

  it("separates presentation from command selection and leaves focus in the DOM", () => {
    const contract = source("src/features/app-shell/auxiliary-workbench/types.ts");
    const panel = source("src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel.tsx");
    expect(contract).toContain("sidebarVisible: boolean");
    expect(contract).toContain("presented: boolean");
    expect(contract).toContain("commandTarget: boolean");
    expect(contract).not.toContain("domFocused");
    expect(panel).toContain("presented && workbench.presentedItemIds.includes(item.id)");
    expect(panel).toContain("itemPresented && workbench.activeItemId === item.id");
  });

  it("keeps feature branding in the generic Item snapshot and Workbench chrome", () => {
    const contract = source("src/features/app-shell/auxiliary-workbench/types.ts");
    const status = source(
      "src/features/app-shell/auxiliary-workbench/layout/AuxiliaryWorkbenchStatus.tsx",
    );
    const workbenchIcon = source(
      "src/features/app-shell/auxiliary-workbench/layout/WorkbenchLauncherIcon.tsx",
    );
    const launcherIcon = source(
      "src/components/brand/AgentLauncherIcon.tsx",
    );
    expect(contract).toContain("iconKey: string | null");
    expect(status).toContain(
      "<WorkbenchLauncherIcon compact iconKey={item.snapshot.iconKey}",
    );
    expect(status).not.toContain("MessageSquare");
    expect(workbenchIcon).toContain('fallback="chat"');
    expect(workbenchIcon).not.toContain("chatIconLauncherIds");
    expect(launcherIcon).toContain("resolveAgentBrand({ id: launcherId, iconKey })");
    expect(launcherIcon).toContain("<AgentBrandImage brandId={brand.id}");
  });

  it("keeps Tab Bar chrome outside the content split-drop coordinate space", () => {
    const pane = source("src/features/app-shell/auxiliary-workbench/layout/WorkbenchGroupPane.tsx");
    const resolver = source(
      "src/features/app-shell/auxiliary-workbench/layout/interactions/workbenchContentDropTarget.ts",
    );
    expect(pane).toContain("{header}");
    expect(pane).toContain('className="desktop-terminal-tab-group-content"');
    expect(pane.indexOf("{header}")).toBeLessThan(
      pane.indexOf('className="desktop-terminal-tab-group-content"'),
    );
    expect(pane).toContain("data-terminal-content-drop-group-id={groupId}");
    expect(pane).toContain("{contentDropIntent && (");
    expect(resolver).toContain("[data-terminal-content-drop-group-id]");
    expect(resolver).not.toContain("data-terminal-group-pane-id");
  });

  it("pins every Terminal runtime to the Item root captured at creation", () => {
    const pool = source(
      "src/features/desktop-terminal/runtime/TerminalRuntimePool.ts",
    );
    expect(pool).toContain("private readonly project: AuxiliaryWorkbenchProject");
    expect(pool).toContain("workspacePath: this.project.context.rootPath");
    expect(pool).toContain("projectContext: this.project.context");
    expect(pool).not.toContain("focusedWorkspace");
  });
});

function source(relativePath: string) {
  return readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), "utf8");
}
