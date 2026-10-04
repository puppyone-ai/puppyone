// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bootstrap = vi.hoisted(() => ({
  render: vi.fn(),
  localization: vi.fn(),
  capabilities: vi.fn(),
}));
vi.mock("react-dom/client", () => ({ default: { createRoot: () => ({ render: bootstrap.render }) } }));
vi.mock("@puppyone/shared-ui", () => ({
  flushActiveDocumentSessions: vi.fn(), retireEditorTasks: vi.fn(),
  holdEditorRuntimeAdmission: vi.fn(), reconcilePendingDocumentOperations: vi.fn(),
}));
vi.mock("@puppyone/localization/react", () => ({ LocalizationProvider: "LocalizationProvider" }));
vi.mock("../../../../src/App", () => ({ App: "App" }));
vi.mock("../../../../src/components/ScrollbarActivity", () => ({ ScrollbarActivity: "ScrollbarActivity" }));
vi.mock("../../../../src/components/ApplicationRenderBoundary", () => ({ ApplicationRenderBoundary: "ApplicationRenderBoundary" }));
vi.mock("../../../../src/components/DesktopTooltipLayer", () => ({ DesktopTooltipLayer: "DesktopTooltipLayer" }));
vi.mock("../../../../src/features/flags", () => ({ FeatureFlagsProvider: "FeatureFlagsProvider" }));
vi.mock("../../../../src/features/typography", () => ({ TypographyCatalogProvider: "TypographyCatalogProvider" }));
vi.mock("../../../../src/features/appearance/AuxiliaryAppearanceSmokeHarness", () => ({ AuxiliaryAppearanceSmokeHarness: "AuxiliaryAppearanceSmokeHarness" }));
vi.mock("../../../../src/features/desktop-terminal/visual-smoke", () => ({ TerminalLauncherVisualSmokeHarness: "TerminalLauncherVisualSmokeHarness", TerminalSplitVisualSmokeHarness: "TerminalSplitVisualSmokeHarness" }));
vi.mock("../../../../src/features/desktop-agent/visual-smoke", () => ({ AgentVisualSmokeHarness: "AgentVisualSmokeHarness", AgentRenderStabilitySmokeHarness: "AgentRenderStabilitySmokeHarness", AgentToolStabilitySmokeHarness: "AgentToolStabilitySmokeHarness" }));
vi.mock("../../../../src/performance/RendererPerformanceSmokeHarness", () => ({ RendererPerformanceSmokeHarness: "RendererPerformanceSmokeHarness" }));
vi.mock("../../../../src/performance/CsvEditorPerformanceSmokeHarness", () => ({ CsvEditorPerformanceSmokeHarness: "CsvEditorPerformanceSmokeHarness" }));
vi.mock("../../../../src/performance/MarkdownLineGeometrySmokeHarness", () => ({ MarkdownLineGeometrySmokeHarness: "MarkdownLineGeometrySmokeHarness" }));
vi.mock("../../../../src/features/appearance/MarkdownThemeInheritanceSmokeHarness", () => ({ MarkdownThemeInheritanceSmokeHarness: "MarkdownThemeInheritanceSmokeHarness" }));
vi.mock("../../../../src/features/appearance/AppearanceVisualSmokeHarness", () => ({ AppearanceVisualSmokeHarness: "AppearanceVisualSmokeHarness" }));
vi.mock("../../../../src/features/cloud/workbench/AccountCloudWorkbenchSmokeHarness", () => ({ AccountCloudWorkbenchSmokeHarness: "AccountCloudWorkbenchSmokeHarness" }));
vi.mock("../../../../src/features/cloud/workbench/NativeCloudWorkbenchSmokeHarness", () => ({ NativeCloudWorkbenchSmokeHarness: "NativeCloudWorkbenchSmokeHarness" }));
vi.mock("../../../../src/features/app-shell/WorkspaceMenuVisualSmokeHarness", () => ({ WorkspaceMenuVisualSmokeHarness: "WorkspaceMenuVisualSmokeHarness" }));
vi.mock("../../../../src/features/app-shell/HeaderCoachmarkVisualSmokeHarness", () => ({ HeaderCoachmarkVisualSmokeHarness: "HeaderCoachmarkVisualSmokeHarness" }));
vi.mock("../../../../src/localization", () => ({ bootstrapRendererLocalization: bootstrap.localization }));
vi.mock("../../../../src/platform/desktopPlatformClient", () => ({ readDesktopPlatformCapabilities: bootstrap.capabilities }));
vi.mock("../../../../src/lib/markdownFormatShortcutBridge", () => ({ startMarkdownFormatShortcutBridge: () => vi.fn() }));
vi.mock("../../../../src/lib/nativeTitleSuppression", () => ({ installNativeTitleSuppression: () => vi.fn() }));
vi.mock("../../../../src/platform/mermaid/desktopMermaidClient", () => ({ startDesktopMermaidClient: vi.fn() }));

const localization = { state: { locale: "en" }, catalog: {}, fallbackCatalog: {}, loadCatalog: vi.fn(), client: {} };
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="root"></div>';
  bootstrap.localization.mockResolvedValue(localization);
  bootstrap.capabilities.mockResolvedValue({ platform: "macos" });
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.restoreAllMocks();
});

function elementTypes(node: React.ReactNode): unknown {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return null;
  return [String(node.type), React.Children.toArray(node.props.children).map(elementTypes)];
}

async function renderHash(hash: string) {
  window.location.hash = hash;
  await import("../../../../src/main");
  await vi.waitFor(() => expect(bootstrap.render).toHaveBeenCalledOnce());
  return bootstrap.render.mock.calls[0][0] as React.ReactElement<{ children: React.ReactElement }>;
}

describe("renderer entry-point route characterization", () => {
  it.each([
    ["#auxiliary-appearance-smoke", "AuxiliaryAppearanceSmokeHarness"],
    ["#terminal-launcher-visual-smoke", "TerminalLauncherVisualSmokeHarness"],
    ["#terminal-split-visual-smoke", "TerminalSplitVisualSmokeHarness"],
    ["#agent-visual-smoke", "AgentVisualSmokeHarness"],
    ["#agent-render-stability-smoke", "AgentRenderStabilitySmokeHarness"],
    ["#agent-tool-stability-smoke", "AgentToolStabilitySmokeHarness"],
    ["#renderer-performance-smoke", "RendererPerformanceSmokeHarness"],
    ["#csv-editor-performance-smoke", "CsvEditorPerformanceSmokeHarness"],
    ["#markdown-line-geometry-smoke", "MarkdownLineGeometrySmokeHarness"],
    ["#markdown-theme-inheritance-smoke", "MarkdownThemeInheritanceSmokeHarness"],
    ["#appearance-visual-smoke", "AppearanceVisualSmokeHarness"],
    ["#account-cloud-workbench-smoke", "AccountCloudWorkbenchSmokeHarness"],
    ["#native-cloud-workbench-smoke", "NativeCloudWorkbenchSmokeHarness"],
    ["#workspace-menu-visual-smoke", "WorkspaceMenuVisualSmokeHarness"],
    ["#header-coachmark-visual-smoke", "HeaderCoachmarkVisualSmokeHarness"],
  ])("renders %s with the shared providers", async (hash, name) => {
    const tree = await renderHash(hash);
    expect(elementTypes(tree)).toEqual(["Symbol(react.strict_mode)", [["LocalizationProvider", [
      ["ApplicationRenderBoundary", [["ScrollbarActivity", []], [name, []], ["DesktopTooltipLayer", []]]],
    ]]]]);
    expect(tree.props.children.props).toMatchObject({
      initialState: localization.state, initialCatalog: localization.catalog,
      fallbackCatalog: localization.fallbackCatalog, loadCatalog: localization.loadCatalog, client: localization.client,
    });
    expect(document.documentElement.dataset.desktopPlatform).toBe("macos");
  });

  it.each(["", "#unknown", "#agent-visual-smoke-extra", "#toString"])("renders the application for %s", async (hash) => {
    const tree = await renderHash(hash);
    expect(elementTypes(tree)).toEqual(["Symbol(react.strict_mode)", [["LocalizationProvider", [
      ["ApplicationRenderBoundary", [["ScrollbarActivity", []],
        ["TypographyCatalogProvider", [["FeatureFlagsProvider", [["App", []]]]]], ["DesktopTooltipLayer", []]]],
    ]]]]);
  });

  it("clears stale platform metadata when capabilities are unavailable", async () => {
    document.documentElement.dataset.desktopPlatform = "windows";
    bootstrap.capabilities.mockResolvedValue(null);
    await renderHash("");
    expect(document.documentElement.dataset.desktopPlatform).toBeUndefined();
  });

  it("reports bootstrap rejection without rendering", async () => {
    const error = new Error("localization unavailable");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    bootstrap.localization.mockRejectedValue(error);
    await import("../../../../src/main");
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith("PuppyOne renderer localization bootstrap failed:", error));
    expect(bootstrap.render).not.toHaveBeenCalled();
  });
});
