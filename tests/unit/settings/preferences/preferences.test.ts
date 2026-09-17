import { describe, expect, it } from "vitest";

import { parseLegacyTextSize } from "../../../../src/features/appearance/legacyTextSizeMigration";
import {
  DEFAULT_CREATE_NEW_MENU_SETTINGS,
  DEFAULT_EXPERIMENTAL_SETTINGS,
  parseAgentFileActivityIndicatorsEnabled,
  parseCreateNewMenuSettings,
  parseDarkThemePreset,
  parseDiffMarkers,
  parseExperimentalSettings,
  parseGitSidebarLayout,
  parseLoadingAnimationPreset,
  parseLocalAgentsSettings,
  parsePointerCursors,
  parseTitlebarActionsSettings,
  resolveVisibleCreateNewMenuItems,
} from "../../../../src/preferences";

describe("Git sidebar layout preferences", () => {
  it("defaults to cards and accepts only the two comparison layouts", () => {
    expect(parseGitSidebarLayout(null)).toBe("cards");
    expect(parseGitSidebarLayout("cards")).toBe("cards");
    expect(parseGitSidebarLayout("dividers")).toBe("dividers");
    expect(parseGitSidebarLayout("unknown")).toBe("cards");
  });
});

describe("create new menu preferences", () => {
  it("defaults to a complete v5 hierarchy with a first-class submenu node", () => {
    expect(parseCreateNewMenuSettings(null)).toEqual(DEFAULT_CREATE_NEW_MENU_SETTINGS);
    expect(DEFAULT_CREATE_NEW_MENU_SETTINGS).toEqual({
      version: 5,
      main: ["markdown", "csv", "html", "customFiles"],
      submenu: ["contextMap"],
      hidden: ["text", "json", "slides", "app", "puppyflow"],
    });
    expect(resolveVisibleCreateNewMenuItems(
      DEFAULT_CREATE_NEW_MENU_SETTINGS,
      DEFAULT_EXPERIMENTAL_SETTINGS,
    )).toEqual({
      main: ["markdown", "csv", "html", "customFiles"],
      submenu: ["contextMap"],
    });
  });

  it("migrates old enabled and placement fields into the three menu groups", () => {
    expect(parseCreateNewMenuSettings(JSON.stringify({
      version: 3,
      items: [
        { kind: "json", enabled: false },
        { kind: "text", enabled: true },
      ],
    }))).toEqual({
      version: 5,
      main: ["customFiles"],
      submenu: ["text"],
      hidden: ["json", "markdown", "contextMap", "csv", "html", "slides", "app", "puppyflow"],
    });
    expect(parseCreateNewMenuSettings(JSON.stringify({
      version: 2,
      items: [
        { kind: "markdown", enabled: true },
        { kind: "csv", enabled: true },
      ],
    }))).toEqual(DEFAULT_CREATE_NEW_MENU_SETTINGS);
    expect(parseCreateNewMenuSettings(JSON.stringify({
      version: 3,
      items: [
        { kind: "markdown", enabled: true },
        { kind: "csv", enabled: true },
      ],
    }))).toEqual(DEFAULT_CREATE_NEW_MENU_SETTINGS);
  });

  it("migrates v4 placements, deduplicates items, and moves disabled items to Not shown", () => {
    expect(parseCreateNewMenuSettings(JSON.stringify({
      version: 4,
      items: [
        { kind: "json", enabled: true, placement: "main" },
        { kind: "json", enabled: false, placement: "submenu" },
        { kind: "text", enabled: false, placement: "invalid" },
        { kind: "not-a-file-type", enabled: true, placement: "main" },
      ],
    }))).toEqual({
      version: 5,
      main: ["json", "customFiles"],
      submenu: [],
      hidden: ["text", "markdown", "contextMap", "csv", "html", "slides", "app", "puppyflow"],
    });
  });

  it("normalizes v5 hierarchy data without losing the submenu's position", () => {
    expect(parseCreateNewMenuSettings(JSON.stringify({
      version: 5,
      main: ["html", "customFiles", "markdown", "html", "invalid"],
      submenu: ["json", "markdown"],
      hidden: ["text", "json"],
    }))).toEqual({
      version: 5,
      main: ["html", "customFiles", "markdown"],
      submenu: ["json"],
      hidden: ["text", "contextMap", "csv", "slides", "app", "puppyflow"],
    });
  });

  it("recovers from malformed persisted values", () => {
    expect(parseCreateNewMenuSettings(JSON.stringify({
      items: [{ kind: "not-a-file-type" }],
    }))).toEqual(DEFAULT_CREATE_NEW_MENU_SETTINGS);
    expect(parseCreateNewMenuSettings(JSON.stringify({ items: [] }))).toEqual({
      version: 5,
      main: ["customFiles"],
      submenu: [],
      hidden: ["markdown", "contextMap", "text", "json", "csv", "html", "slides", "app", "puppyflow"],
    });
  });

  it("resolves available items while preserving the submenu node's main-menu position", () => {
    const settings = {
      version: 5,
      main: ["app", "customFiles", "contextMap"],
      submenu: ["csv", "puppyflow"],
      hidden: ["json", "text", "markdown", "html", "slides"],
    } satisfies Parameters<typeof resolveVisibleCreateNewMenuItems>[0];
    expect(resolveVisibleCreateNewMenuItems(settings, DEFAULT_EXPERIMENTAL_SETTINGS)).toEqual({
      main: ["app", "customFiles", "contextMap"],
      submenu: ["csv"],
    });
  });
});

describe("appearance preferences", () => {
  it("drops the retired standalone History header action", () => {
    expect(parseTitlebarActionsSettings(JSON.stringify({
      enabled: { changes: true, history: true, terminal: true },
      order: ["history", "terminal", "changes"],
    }))).toEqual({
      enabled: { changes: true, terminal: true },
      order: ["changes", "terminal"],
    });
  });

  it("keeps Agent file activity visibility opt-in", () => {
    expect(parseAgentFileActivityIndicatorsEnabled(null)).toBe(false);
    expect(parseAgentFileActivityIndicatorsEnabled("true")).toBe(true);
    expect(parseAgentFileActivityIndicatorsEnabled("invalid")).toBe(false);
  });



  it("accepts only curated appearance values", () => {
    expect(parseLegacyTextSize("large")).toBe("large");
    expect(parseLegacyTextSize("17px")).toBe("default");
    expect(parseDarkThemePreset("warm")).toBe("warm");
    expect(parseDarkThemePreset("custom")).toBe("default");
    expect(parseDiffMarkers("symbols")).toBe("symbols");
    expect(parseDiffMarkers("both")).toBe("color");
    expect(parseLoadingAnimationPreset("ikun")).toBe("ikun");
    expect(parseLoadingAnimationPreset("ymca")).toBe("ymca");
    expect(parseLoadingAnimationPreset("siu")).toBe("siu");
    expect(parseLoadingAnimationPreset("sparkles")).toBe("ikun");
  });

  it("keeps pointer cursors off unless explicitly enabled", () => {
    expect(parsePointerCursors("true")).toBe(true);
    expect(parsePointerCursors("false")).toBe(false);
    expect(parsePointerCursors(null)).toBe(false);
  });

});

describe("local Agent preferences", () => {
  it("keeps only bounded, unique hidden Terminal Agent ids", () => {
    expect(parseLocalAgentsSettings(null)).toEqual({
      hiddenTerminalAgentIds: [],
      chatHistoryDiscoveryEnabled: false,
    });
    expect(parseLocalAgentsSettings(JSON.stringify({
      hiddenTerminalAgentIds: ["codex", "claude", "codex", "../../bad", 7],
      chatHistoryDiscoveryEnabled: true,
    }))).toEqual({
      hiddenTerminalAgentIds: ["codex", "claude"],
      chatHistoryDiscoveryEnabled: true,
    });
    expect(parseLocalAgentsSettings(JSON.stringify({
      enabledAgentIds: ["codex"],
    }))).toEqual({ hiddenTerminalAgentIds: [], chatHistoryDiscoveryEnabled: false });
    expect(parseLocalAgentsSettings(JSON.stringify({
      hiddenTerminalAgentIds: ["workbuddy"],
    }))).toEqual({
      hiddenTerminalAgentIds: ["workbuddy-china", "workbuddy-international"],
      chatHistoryDiscoveryEnabled: false,
    });
    expect(parseLocalAgentsSettings("invalid")).toEqual({
      hiddenTerminalAgentIds: [],
      chatHistoryDiscoveryEnabled: false,
    });
  });
});

describe("experimental preferences", () => {
  it("keeps Built-in Agent hidden unless the user explicitly opts in", () => {
    expect(parseExperimentalSettings(null).enableBuiltInAgent).toBe(false);
    expect(parseExperimentalSettings("not-json").enableBuiltInAgent).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableBuiltInAgent: false })).enableBuiltInAgent).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableBuiltInAgent: true })).enableBuiltInAgent).toBe(true);
  });

  it.each([true, false])("ignores retired Agent Chat preferences set to %s without changing other experiments", (enabled) => {
    const settings = parseExperimentalSettings(JSON.stringify({
      enableAgentChat: enabled,
      enableAgentCompanion: enabled,
      enableMultiRootWorkspaces: true,
    }));
    expect(settings).toEqual({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableMultiRootWorkspaces: true,
    });
    expect(settings).not.toHaveProperty("enableAgentChat");
    expect(settings).not.toHaveProperty("enableAgentCompanion");
  });

  it("keeps PuppyOne Cloud off unless the user explicitly opts in", () => {
    expect(parseExperimentalSettings(null).enableCloudWorkspace).toBe(false);
    expect(parseExperimentalSettings("not-json").enableCloudWorkspace).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableCloudWorkspace: false })).enableCloudWorkspace).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableCloudWorkspace: true })).enableCloudWorkspace).toBe(true);
  });

  it("keeps multi-project workspaces off unless the user explicitly opts in", () => {
    expect(parseExperimentalSettings(null).enableMultiRootWorkspaces).toBe(false);
    expect(parseExperimentalSettings("not-json").enableMultiRootWorkspaces).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableMultiRootWorkspaces: false })).enableMultiRootWorkspaces)
      .toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableMultiRootWorkspaces: true })).enableMultiRootWorkspaces)
      .toBe(true);
  });

  it("keeps the Project switcher rail off unless the user explicitly opts in", () => {
    expect(parseExperimentalSettings(null).enableProjectSwitcherRail).toBe(false);
    expect(parseExperimentalSettings("not-json").enableProjectSwitcherRail).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableProjectSwitcherRail: false })).enableProjectSwitcherRail)
      .toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableProjectSwitcherRail: true })).enableProjectSwitcherRail)
      .toBe(true);
  });

  it("keeps Cloud Automation off unless the user explicitly opts in", () => {
    expect(parseExperimentalSettings(null).enableCloudAutomation).toBe(false);
    expect(parseExperimentalSettings("not-json").enableCloudAutomation).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableCloudAutomation: false })).enableCloudAutomation).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableCloudAutomation: true })).enableCloudAutomation).toBe(true);
  });

  it("keeps the first-project starting point off unless the user explicitly opts in", () => {
    expect(parseExperimentalSettings(null).enableFirstProjectStarter).toBe(false);
    expect(parseExperimentalSettings("not-json").enableFirstProjectStarter).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableFirstProjectStarter: false })).enableFirstProjectStarter).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableFirstProjectStarter: true })).enableFirstProjectStarter).toBe(true);
  });

  it("keeps the editor save status hidden unless the user explicitly opts in", () => {
    expect(parseExperimentalSettings(null).enableEditorSaveStatus).toBe(false);
    expect(parseExperimentalSettings("not-json").enableEditorSaveStatus).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableEditorSaveStatus: false })).enableEditorSaveStatus).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableEditorSaveStatus: true })).enableEditorSaveStatus).toBe(true);
  });

  it("ignores retired Context Map experiment values now that the feature is always available", () => {
    expect(parseExperimentalSettings(JSON.stringify({ enableContextMaps: false })))
      .not.toHaveProperty("enableContextMaps");
    expect(parseExperimentalSettings(JSON.stringify({ enableFolderRelationships: false })))
      .not.toHaveProperty("enableContextMaps");
  });

  it("ignores retired Minimal Mode experiment values", () => {
    expect(parseExperimentalSettings(JSON.stringify({ enableMinimalMode: true })))
      .not.toHaveProperty("enableMinimalMode");
  });

  it("keeps Markdown block drag handles off unless the user explicitly opts in", () => {
    expect(parseExperimentalSettings(null).enableMarkdownBlockDrag).toBe(false);
    expect(parseExperimentalSettings("not-json").enableMarkdownBlockDrag).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableMarkdownBlockDrag: false })).enableMarkdownBlockDrag).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableMarkdownBlockDrag: true })).enableMarkdownBlockDrag).toBe(true);
  });

  it("keeps the Markdown heading outline hidden unless the user explicitly opts in", () => {
    expect(parseExperimentalSettings(null).enableMarkdownHeadingOutline).toBe(false);
    expect(parseExperimentalSettings("not-json").enableMarkdownHeadingOutline).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableMarkdownHeadingOutline: false })).enableMarkdownHeadingOutline)
      .toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableMarkdownHeadingOutline: true })).enableMarkdownHeadingOutline)
      .toBe(true);
  });

  it("keeps the Asset Library homepage off unless the user explicitly opts in", () => {
    expect(parseExperimentalSettings(null).enableAssetLibraryHome).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableAssetLibraryHome: false })).enableAssetLibraryHome).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableAssetLibraryHome: true })).enableAssetLibraryHome).toBe(true);
  });

  it("keeps Viewer Plugins off unless the user explicitly opts in", () => {
    expect(parseExperimentalSettings(null).enableViewerPlugins).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableViewerPlugins: false })).enableViewerPlugins).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableViewerPlugins: true })).enableViewerPlugins).toBe(true);
  });

  it("ignores the retired built-in Office editing experiment", () => {
    expect(parseExperimentalSettings(JSON.stringify({ enableOfficeEditing: true })))
      .not.toHaveProperty("enableOfficeEditing");
  });
});
