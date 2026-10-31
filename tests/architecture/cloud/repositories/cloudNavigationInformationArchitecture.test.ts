import { describe, expect, it } from "vitest";
import { HomeIcon } from "../../../../packages/shared-ui/src/icons/productIcons";
import {
  CLOUD_HUB_ENTRY_SECTION,
  CLOUD_PROJECT_SIDEBAR_ROUTES,
  normalizeCloudSection,
  getCloudRoute,
  getCloudSidebarActiveSection,
} from "../../../../src/features/cloud/routes/cloudRoutes";
import { McpLogoIcon } from "../../../../src/features/cloud/components/McpLogoIcon";

describe("Cloud navigation information architecture", () => {
  it("enters Cloud through Homepage", () => {
    expect(CLOUD_HUB_ENTRY_SECTION).toBe("contents");
  });

  it("keeps Homepage and Connections as separate product groups", () => {
    expect(CLOUD_PROJECT_SIDEBAR_ROUTES.map((route) => route.id)).toEqual([
      "contents",
      "mcp",
      "cli",
    ]);
    expect(getCloudRoute("contents").icon).toBe(HomeIcon);
    expect(getCloudRoute("share").navigationGroup).toBe("project");
    expect(getCloudRoute("share").showInSidebar).toBe(false);
    expect(getCloudRoute("mcp").icon).toBe(McpLogoIcon);
    expect(getCloudRoute("mcp").navigationGroup).toBe("connections");
    expect(getCloudRoute("cli").navigationGroup).toBe("connections");
    expect(getCloudRoute("git-sync").navigationGroup).toBe("connections");
    expect(getCloudRoute("git-sync").showInSidebar).toBe(false);
    expect(getCloudRoute("access").showInSidebar).toBe(false);
    expect(getCloudRoute("history").showInSidebar).toBe(false);
    expect(getCloudRoute("settings").showInSidebar).toBe(false);
  });

  it("keeps History and Settings as Homepage drill-downs", () => {
    expect(getCloudSidebarActiveSection("history")).toBe("contents");
    expect(getCloudSidebarActiveSection("settings")).toBe("contents");
    expect(getCloudRoute("history").surface).toBe("history");
    expect(getCloudRoute("settings").surface).toBe("landing");
  });

  it("sends a saved Automation section to Homepage now that the route is not registered", () => {
    expect(normalizeCloudSection("automation")).toBe("contents");
    expect(normalizeCloudSection("mcp")).toBe("mcp");
  });
});
