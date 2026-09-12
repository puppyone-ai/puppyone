import { describe, expect, it } from "vitest";
import { House } from "lucide-react";
import {
  CLOUD_HUB_ENTRY_SECTION,
  CLOUD_PROJECT_SIDEBAR_ROUTES,
  getAvailableCloudSection,
  getCloudRoute,
  getCloudSidebarActiveSection,
} from "../../../../src/features/cloud/routes/cloudRoutes";
import { McpLogoIcon } from "../../../../src/features/cloud/components/McpLogoIcon";

describe("Cloud navigation information architecture", () => {
  it("enters Cloud through Homepage", () => {
    expect(CLOUD_HUB_ENTRY_SECTION).toBe("contents");
  });

  it("keeps Homepage, Connections, and Automation as separate product groups", () => {
    expect(CLOUD_PROJECT_SIDEBAR_ROUTES.map((route) => route.id)).toEqual([
      "contents",
      "mcp",
      "cli",
      "automation",
    ]);
    expect(getCloudRoute("contents").icon).toBe(House);
    expect(getCloudRoute("mcp").icon).toBe(McpLogoIcon);
    expect(getCloudRoute("mcp").navigationGroup).toBe("connections");
    expect(getCloudRoute("cli").navigationGroup).toBe("connections");
    expect(getCloudRoute("git-sync").navigationGroup).toBe("connections");
    expect(getCloudRoute("git-sync").showInSidebar).toBe(false);
    expect(getCloudRoute("access").showInSidebar).toBe(false);
    expect(getCloudRoute("history").showInSidebar).toBe(false);
    expect(getCloudRoute("automation").navigationGroup).toBe("automation");
    expect(getCloudRoute("settings").showInSidebar).toBe(false);
  });

  it("keeps History and Settings as Homepage drill-downs", () => {
    expect(getCloudSidebarActiveSection("history")).toBe("contents");
    expect(getCloudSidebarActiveSection("settings")).toBe("contents");
    expect(getCloudRoute("history").surface).toBe("history");
    expect(getCloudRoute("settings").surface).toBe("landing");
  });

  it("falls back to Homepage when the Automation experiment is disabled", () => {
    expect(getAvailableCloudSection("automation", { automationEnabled: false })).toBe("contents");
    expect(getAvailableCloudSection("automation", { automationEnabled: true })).toBe("automation");
    expect(getAvailableCloudSection("mcp", { automationEnabled: false })).toBe("mcp");
  });
});
