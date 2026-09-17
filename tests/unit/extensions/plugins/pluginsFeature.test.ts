import { describe, expect, it } from "vitest";
import { DEFAULT_EXPERIMENTAL_SETTINGS } from "../../../../src/preferences";
import {
  DEFAULT_PLUGINS_SECTION,
  PLUGINS_SIDEBAR_ITEMS,
  isViewerPluginsEnabled,
} from "../../../../src/features/plugins";
import {
  getInvalidOfficialViewerCatalogIds,
  OFFICIAL_VIEWER_CATALOG,
} from "../../../../src/features/plugins/pluginCatalog";

describe("Viewer Plugins experiment", () => {
  it("is opt-in on the single local-workspace shell", () => {
    expect(isViewerPluginsEnabled({
      settings: DEFAULT_EXPERIMENTAL_SETTINGS,
    })).toBe(false);
    expect(isViewerPluginsEnabled({
      settings: { ...DEFAULT_EXPERIMENTAL_SETTINGS, enableViewerPlugins: true },
    })).toBe(true);
  });

  it("keeps every official catalog card backed by an active preset Viewer contract", () => {
    expect(OFFICIAL_VIEWER_CATALOG.length).toBeGreaterThan(0);
    expect(getInvalidOfficialViewerCatalogIds()).toEqual([]);
    expect(OFFICIAL_VIEWER_CATALOG.every((entry) => !("description" in entry))).toBe(true);
  });

  it("starts with local state and keeps acquisition secondary", () => {
    expect(DEFAULT_PLUGINS_SECTION).toBe("installed");
    expect(PLUGINS_SIDEBAR_ITEMS.map((item) => item.id)).toEqual([
      "installed",
      "discover",
      "included",
    ]);
  });
});
